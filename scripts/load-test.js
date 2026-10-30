/**
 * k6 load tests for the Task Manager API.
 *
 *   k6 run -e SCENARIO=smoke scripts/load-test.js                     # safe local smoke test
 *   k6 run -e SCENARIO=read -e RATE=1000 -e DURATION=60s scripts/load-test.js
 *   k6 run -e SCENARIO=staged -e STAGES=100,500,1000,2500,5000,10000 -e STAGE_DURATION=60s scripts/load-test.js
 *
 * Scenarios (open-model arrival-rate executors, so RATE is requests/iterations per second,
 * not virtual users):
 *   smoke      1 VU, a few iterations of every endpoint; asserts correctness
 *   health     GET /health/live                 (process + HTTP stack ceiling)
 *   unauth     GET /api/v1/tasks without cookie (auth rejection path, expects 401)
 *   read       GET /api/v1/tasks list pages      (read-heavy, per-user index scans)
 *   dashboard  GET /api/v1/dashboard/summary     (cache-warm with Redis; run the API with
 *                                                 DASHBOARD_CACHE_TTL_SECONDS=0 for cache-cold)
 *   write      create -> update -> complete -> delete (4 requests per iteration)
 *   mixed      80% reads / 20% writes by request
 *   ratelimit  one user far above RATE_LIMIT_MAX; expects 429s (verifies limiter, not capacity)
 *   staged     mixed workload stepped through STAGES req/s
 *   spike      mixed workload: baseline -> 5x spike -> baseline
 *
 * Environment:
 *   BASE_URL (default http://localhost:4000) or BASE_URLS (comma-separated instances), USERS (accounts to log in, default 50),
 *   RATE, DURATION, STAGES, STAGE_DURATION, MAX_VUS.
 *
 * Prerequisites: `npm run seed -- --loadtest 200` and an API started with load-test rate
 * limits (see docs/scalability.md) — otherwise the per-user and auth limiters (correctly)
 * reject the generated traffic. Never point this at shared or production infrastructure
 * without permission.
 */
import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
// Several instances (e.g. http://h:4001,http://h:4002) emulate a round-robin load balancer:
// each VU sticks to one instance. Sessions work on any instance (stateless JWT).
const BASES = (__ENV.BASE_URLS || BASE).split(',');
const base = () => BASES[(exec.vu.idInTest || 0) % BASES.length];
const SCENARIO = __ENV.SCENARIO || 'smoke';
const USERS = Number(__ENV.USERS || 50);
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '60s';
const MAX_VUS = Number(__ENV.MAX_VUS || 2000);
const STAGE_DURATION = __ENV.STAGE_DURATION || '60s';
const STAGES = (__ENV.STAGES || '100,500,1000,2500,5000,10000').split(',').map(Number);
const PASSWORD = 'LoadTestPassword1';

const unexpected = new Counter('unexpected_status');
const readLatency = new Trend('read_latency', true);
const writeLatency = new Trend('write_latency', true);

// 4xx statuses that a scenario expects are not "failures".
const expected = {
  unauth: http.expectedStatuses(401),
  ratelimit: http.expectedStatuses(200, 429),
};
http.setResponseCallback(expected[SCENARIO] || http.expectedStatuses({ min: 200, max: 399 }));

function arrival(rate, extra = {}) {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: Math.min(MAX_VUS, Math.max(10, Math.ceil(rate / 10))),
    maxVUs: MAX_VUS,
    ...extra,
  };
}

const readThresholds = { 'http_req_duration{kind:read}': ['p(95)<200', 'p(99)<500'] };
const writeThresholds = { 'http_req_duration{kind:write}': ['p(95)<300', 'p(99)<800'] };

const SCENARIOS = {
  smoke: {
    scenarios: { smoke: { executor: 'per-vu-iterations', vus: 1, iterations: 3 } },
    thresholds: { checks: ['rate==1'] },
  },
  health: {
    scenarios: { health: arrival(RATE) },
    thresholds: { http_req_duration: ['p(95)<50', 'p(99)<100'] },
  },
  unauth: { scenarios: { unauth: arrival(RATE) }, thresholds: { http_req_duration: ['p(95)<50'] } },
  read: { scenarios: { read: arrival(RATE) }, thresholds: readThresholds },
  dashboard: { scenarios: { dashboard: arrival(RATE) }, thresholds: readThresholds },
  write: { scenarios: { write: arrival(RATE) }, thresholds: writeThresholds },
  mixed: { scenarios: { mixed: arrival(RATE) }, thresholds: { ...readThresholds, ...writeThresholds } },
  ratelimit: { scenarios: { ratelimit: arrival(RATE, { duration: '20s' }) }, thresholds: {} },
  staged: {
    scenarios: {
      staged: {
        executor: 'ramping-arrival-rate',
        startRate: STAGES[0],
        timeUnit: '1s',
        preAllocatedVUs: 50,
        maxVUs: MAX_VUS,
        // 10s ramp into each step, then hold it for STAGE_DURATION.
        stages: STAGES.flatMap((r) => [
          { target: r, duration: '10s' },
          { target: r, duration: STAGE_DURATION },
        ]),
      },
    },
    thresholds: { ...readThresholds, ...writeThresholds },
  },
  spike: {
    scenarios: {
      spike: {
        executor: 'ramping-arrival-rate',
        startRate: RATE,
        timeUnit: '1s',
        preAllocatedVUs: 50,
        maxVUs: MAX_VUS,
        stages: [
          { target: RATE, duration: '30s' },
          { target: RATE * 5, duration: '5s' },
          { target: RATE * 5, duration: '30s' },
          { target: RATE, duration: '5s' },
          { target: RATE, duration: '30s' },
        ],
      },
    },
    thresholds: {},
  },
};

if (!SCENARIOS[SCENARIO]) fail(`Unknown SCENARIO "${SCENARIO}"`);

export const options = {
  ...SCENARIOS[SCENARIO],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count<1'],
    ...SCENARIOS[SCENARIO].thresholds,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
  noConnectionReuse: false,
};

const email = (i) => `loadtest-${String(i).padStart(5, '0')}@example.test`;

function login(i) {
  const csrfRes = http.get(`${base()}/api/v1/auth/csrf`);
  const csrf = csrfRes.json('data.csrfToken');
  const res = http.post(
    `${base()}/api/v1/auth/login`,
    JSON.stringify({ email: email(i), password: PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      cookies: { tm_csrf: csrf },
    },
  );
  if (res.status !== 200) fail(`login for ${email(i)} failed with ${res.status}: ${res.body}`);
  return { at: res.cookies.tm_at[0].value, csrf };
}

export function setup() {
  if (SCENARIO === 'health' || SCENARIO === 'unauth') return { sessions: [] };
  const n = SCENARIO === 'ratelimit' ? 1 : USERS;
  // Distinct users spread load across the per-user key ranges, like real traffic.
  return { sessions: Array.from({ length: n }, (_, i) => login(i)) };
}

function session(data) {
  const s = data.sessions[exec.scenario.iterationInTest % data.sessions.length];
  return {
    cookies: { tm_at: s.at, tm_csrf: s.csrf },
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': s.csrf },
  };
}

function ok(res, name, status = 200) {
  const passed = check(res, { [`${name} ${status}`]: (r) => r.status === status });
  if (!passed) unexpected.add(1, { name, status: String(res.status) });
  return passed;
}

const LIST_QUERIES = [
  'limit=20',
  'limit=20&page=2',
  'limit=20&status=todo',
  'limit=20&status=in_progress',
  'limit=20&sortBy=dueDate&sortOrder=asc',
  'limit=20&sortBy=priority&sortOrder=desc',
  'limit=20&overdue=true',
  'limit=10&search=report',
];

function readList(p) {
  const q = LIST_QUERIES[Math.floor(Math.random() * LIST_QUERIES.length)];
  const res = http.get(`${base()}/api/v1/tasks?${q}`, { ...p, tags: { kind: 'read', name: 'GET /tasks' } });
  readLatency.add(res.timings.duration);
  ok(res, 'list');
  return res;
}

function readDashboard(p) {
  const res = http.get(`${base()}/api/v1/dashboard/summary`, {
    ...p,
    tags: { kind: 'read', name: 'GET /dashboard/summary' },
  });
  readLatency.add(res.timings.duration);
  ok(res, 'dashboard');
}

function writeCycle(p) {
  const tag = (name) => ({ ...p, tags: { kind: 'write', name } });
  const created = http.post(
    `${base()}/api/v1/tasks`,
    JSON.stringify({
      title: `k6 task ${exec.vu.idInTest}-${exec.vu.iterationInScenario}`,
      priority: 'medium',
      tags: ['k6'],
    }),
    tag('POST /tasks'),
  );
  writeLatency.add(created.timings.duration);
  if (!ok(created, 'create', 201)) return;
  const id = created.json('data.id');
  const upd = http.patch(
    `${base()}/api/v1/tasks/${id}`,
    JSON.stringify({ version: 0, priority: 'high' }),
    tag('PATCH /tasks/:id'),
  );
  writeLatency.add(upd.timings.duration);
  ok(upd, 'update');
  const st = http.patch(
    `${base()}/api/v1/tasks/${id}/status`,
    JSON.stringify({ status: 'completed' }),
    tag('PATCH /tasks/:id/status'),
  );
  writeLatency.add(st.timings.duration);
  ok(st, 'status');
  const del = http.del(`${base()}/api/v1/tasks/${id}`, null, tag('DELETE /tasks/:id'));
  writeLatency.add(del.timings.duration);
  ok(del, 'delete', 204);
}

function mixedRequest(p) {
  const r = Math.random();
  if (r < 0.55) return readList(p);
  if (r < 0.8) return readDashboard(p);
  // Writes: one request per iteration so RATE stays "requests per second".
  if (r < 0.9) {
    const res = http.post(`${base()}/api/v1/tasks`, JSON.stringify({ title: 'k6 mixed', tags: ['k6'] }), {
      ...p,
      tags: { kind: 'write', name: 'POST /tasks' },
    });
    writeLatency.add(res.timings.duration);
    return ok(res, 'create', 201);
  }
  const list = http.get(`${base()}/api/v1/tasks?limit=5&tag=k6`, {
    ...p,
    tags: { kind: 'read', name: 'GET /tasks' },
  });
  const first = list.json('data.0');
  if (!first) return;
  const res = http.patch(
    `${base()}/api/v1/tasks/${first.id}/status`,
    JSON.stringify({ status: 'completed' }),
    {
      ...p,
      tags: { kind: 'write', name: 'PATCH /tasks/:id/status' },
    },
  );
  writeLatency.add(res.timings.duration);
  ok(res, 'status');
}

export default function (data) {
  switch (SCENARIO) {
    case 'health':
      return ok(http.get(`${base()}/health/live`), 'live');
    case 'unauth':
      return ok(http.get(`${base()}/api/v1/tasks`), 'unauth', 401);
    case 'read':
      return readList(session(data));
    case 'dashboard':
      return readDashboard(session(data));
    case 'write':
      return writeCycle(session(data));
    case 'ratelimit': {
      const res = http.get(`${base()}/api/v1/tasks?limit=1`, session(data));
      check(res, { 'ok or limited': (r) => r.status === 200 || r.status === 429 });
      return;
    }
    case 'smoke': {
      check(http.get(`${base()}/health/ready`), { 'ready 200': (r) => r.status === 200 });
      check(http.get(`${base()}/api/v1/tasks`, { responseCallback: http.expectedStatuses(401) }), {
        'unauthenticated 401': (r) => r.status === 401,
      });
      const p = session(data);
      readList(p);
      readDashboard(p);
      writeCycle(p);
      return;
    }
    default:
      return mixedRequest(session(data));
  }
}

/** Clean up tasks created by load tests so repeated runs start from the same dataset. */
export function teardown(data) {
  if (!data.sessions || data.sessions.length === 0) return;
  for (const s of data.sessions) {
    const p = { cookies: { tm_at: s.at, tm_csrf: s.csrf }, headers: { 'x-csrf-token': s.csrf } };
    for (let i = 0; i < 50; i++) {
      const list = http.get(`${base()}/api/v1/tasks?limit=100&tag=k6`, p);
      const items = list.status === 200 ? list.json('data') : [];
      if (!items || items.length === 0) break;
      for (const t of items) http.del(`${base()}/api/v1/tasks/${t.id}`, null, p);
    }
  }
}
