# Scalability and performance

**Bottom line:** the architecture is designed to reach **10,000 requests/second** by scaling stateless API instances horizontally in front of a right-sized MongoDB replica set and Redis. **That target was not demonstrated.** The measurements below come from one laptop with a single API process and show per-instance capacity, behaviour at saturation, and resilience. The capacity model turns them into an infrastructure estimate, and the last section is the procedure to validate it on real infrastructure.

## 1. Target workload definition

"10,000 RPS" only means something with a workload attached. The design target is:

| Dimension | Definition |
| --- | --- |
| Rate | 10,000 HTTP requests/s **sustained** for 30 min, bursts to 15,000 for 60 s |
| Mix | 85 % reads, 15 % writes: list 50 %, dashboard 25 %, single task 10 %, create 5 %, update/status 8 %, delete 2 % |
| Users | ~100,000 daily active users, ~10,000 concurrently active; 1–3,000 tasks per user (skewed) |
| Concurrency | At ~10 ms mean latency, Little's law gives ~100 requests in flight across the fleet (≫ that at the p99) |
| Success criteria | < 0.1 % non-4xx errors; reads p95 < 200 ms and p99 < 500 ms; writes p95 < 300 ms and p99 < 800 ms; auth endpoints are rate limited and excluded (Argon2 is intentionally slow) |
| Excluded | Static assets (CDN), health checks, login storms |

**Why read-heavy and write-heavy 10k RPS differ:** reads scale out almost linearly. API instances are stateless, Redis absorbs dashboard reads, and MongoDB can add secondaries for reads that tolerate staleness. Writes cannot be spread that way: every write goes to the **one primary**, updates 7 B-trees (data, `_id` and 6 secondary indexes, plus the text index's term entries) and the journal, and is replicated to the oplog of each secondary. 10,000 writes/s of these documents would need a large primary with fast storage, or sharding. 1,500 writes/s (this mix) fits a single replica set.

## 2. Measured results (local)

**Environment:** MacBook Air M2, 8 cores, 8 GB RAM, macOS. The k6 load generator, MongoDB 8.3 (standalone), Redis 8 and the API (Node 24, `NODE_ENV=production`, built bundle, logging at `info` to a file) **all shared the machine**. Dataset: `npm run seed -- --loadtest 200` (200 users, 36,249 tasks, skewed 5–2,976 per user); k6 logged in 50 users and spread requests across them. Executor: `constant-arrival-rate` (open model) for 30 s per step. Rate limits were raised for the test (§5). Raw k6 summaries are written to `load-results/` (gitignored).

| Scenario | Target | Achieved | p50 | p95 | p99 | Errors | Dropped iterations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| health (`/health/live`) | 2,000/s | 2,000 | 0.1 ms | 0.2 ms | 4.1 ms | 0 % | 0 |
| health | 5,000/s | 4,998 | 0.1 | 0.2 | 11.1 | 0 % | 0 |
| health | 10,000/s | 9,999 | 0.1 | 0.7 | 12.6 | 0 % | 0 |
| unauthenticated rejection (401) | 6,000/s | 6,006 | 0.1 | 0.6 | 20.1 | 0 % | 0 |
| task list (8 query shapes incl. search, overdue, priority) | 1,000/s | 957 | 1.3 | 4.7 | 24.4 | 0 % | 0 |
| task list | 2,000/s | 1,358 | 1,262 | 1,864 | 2,318 | 0.84 % | 16,381 |
| task list (repeat run, memory pressure) | 1,000/s | 954 | 1.3 | 57.1 | 215.7 | 0 % | 243 |
| dashboard, warm cache | 1,500/s | 1,445 | 0.5 | 1.1 | 13.1 | 0 % | 0 |
| dashboard, **cache disabled** | 1,000/s | 953 | 1.1 | 4.9 | 25.3 | 0 % | 0 |
| write cycle (POST, PATCH, PATCH status, DELETE) | 100 iter/s | 388 req/s | 1.6 | 3.0 | 19.0 | 0 % | 5 |
| mixed 80/20 | 800/s | 829 | 1.2 | 15.8 | 46.4 | 0 % | 101 |
| mixed 80/20, **Redis killed at t+20 s** | 500/s | 568 | 1.5 | 3.8 | 19.8 | **0 %** | 0 |
| rate limiter at real limits (300/min/user, one user, 50/s) | 50/s | — | — | — | — | 302 × 200, then 702 × 429 | — |

("Achieved" includes the small number of setup login requests. Dropped iterations are arrivals k6 could not start because VUs were busy, which is the open-model signal of saturation.)

**What the numbers say**

1. **One API process handles ~950–1,350 authenticated list reads/s, and the Node event loop is the first bottleneck.** At 1,500 req/s the mean event-loop lag was 21 ms with the process at ~0.8 core, MongoDB at ~1.1 cores, and only 2 pooled connections checked out on average. The database was not the limit at this scale; per-request JavaScript work (JWT verification, Zod parsing, Mongoose hydration of lean results, JSON serialization, pino logging) was.
2. **Past saturation the open model shows queueing.** At 2,000/s offered, latency climbed to seconds and the generator dropped iterations. The in-flight cap (2,000) was not reached because latency, not concurrency, grew first. In production the in-flight cap and deadlines would be set lower (§6) so instances shed load early instead of queueing.
3. **The dashboard cache cuts p95 from 4.9 ms to 1.1 ms** and removes 4 MongoDB queries per hit. At this dataset size the uncached dashboard is already fast, so the cache mainly protects MongoDB CPU at high fan-in rather than being required for latency.
4. **The write path is cheap:** about 390 writes/s at p95 3 ms on a standalone mongod. Each write is a single round trip (atomic update pipeline) plus a fire-and-forget cache invalidation.
5. **Redis outage under load: zero failed requests.** Readiness reported `degraded` (still 200), rate limiting switched to the per-instance fallback (14,154 fallback increments recorded), and the dashboard cache bypassed to MongoDB.
6. **Multi-instance runs on this laptop were invalid.** Four API processes plus MongoDB plus k6 on 8 GB pushed the machine into heavy swap (9.4 GB swap used, ~70 MB free). Throughput collapsed and requests failed with 503 `SERVICE_UNAVAILABLE` after the 2 s pool wait (`waitQueueTimeoutMS`). That is the intended fail-fast behaviour, but the numbers say nothing about horizontal scaling and are excluded. **No claim of linear scaling is made from local data.**

## 3. Capacity model for 10,000 RPS (estimate, to be validated)

**Database operations per request** (from the code):

| Endpoint | Share | Mongo ops | Redis ops | Notes |
| --- | --- | --- | --- | --- |
| list | 50 % | 2 (find + countDocuments) | 1–2 (rate limit, + search limit) | count is a COUNT_SCAN over one user's keys |
| dashboard | 25 % | 4 on a miss, 0 on a hit | 2 GETs + 1 limit | assume a 90 % hit rate → 0.4 |
| get task | 10 % | 1 | 1 | |
| writes | 15 % | ~1.1 (update, occasional `exists`) | 1 limit + 1 MULTI (invalidate) | |

→ **MongoDB: ≈ 10,000 × (0.5×2 + 0.25×0.4 + 0.1×1 + 0.15×1.1) ≈ 13,700 ops/s**, of which ~1,650/s are writes. **Redis: ≈ 22,000 ops/s**, which is trivial for one Redis node (≫ 100k ops/s), but every op adds ~0.2–0.5 ms of network RTT.

**API tier:** measured ~800 mixed req/s per Node process at p95 16 ms on a laptop core. Planning at 60 % of measured saturation for headroom and GC: ~600 req/s per vCPU → **10,000 / 600 ≈ 17 vCPUs**, i.e. **~18 single-vCPU tasks, or 5 × 4-vCPU hosts running 4 processes each**, plus N+1 for zone loss and deployments (**~20–24 vCPUs total**). Memory per process ≈ 150–300 MB RSS (observed 240–285 MB under load) → 512 MB limit per process.

**Connection pools:** per process, concurrency ≈ arrival rate × DB time ≈ 600 × 3 ms ≈ 2 active connections at the mean (2 observed). Set `MONGODB_MAX_POOL_SIZE=20` (headroom for p99 and bursts) → 24 processes × 20 = **480 connections**, well within an Atlas M40/M50 limit. Keep `waitQueueTimeoutMS` at 2 s so saturation fails fast.

**MongoDB sizing:** a 3-node replica set (primary + 2 secondaries across zones, `w: majority`). ~14k simple indexed ops/s and ~1.7k writes/s with ~0.4 KB documents fits an 8 vCPU / 32 GB class instance (Atlas M50) **if the working set fits in RAM**:

- 10,000,000 tasks × ~0.45 KB ≈ 4.5 GB data; indexes ≈ 3–4 GB (7 B-trees + text). The hot set (recently active users) is smaller. WiredTiger cache at 50 % of 32 GB ≈ 15 GB covers it.
- Write I/O: ~1.7k writes/s × ~8 index entries plus the journal is about 15–25k small I/Os/s at peak before checkpoint coalescing. Use provisioned-IOPS or NVMe-class storage.
- Network: 10k responses/s × ~5 KB (20-task page) ≈ 50 MB/s from API to clients; DB to API traffic is similar.

**Growth:** ~1 KB of index + data per task, so 100 M tasks ≈ 90–100 GB, beyond RAM for one instance. **Sharding becomes justified when** the working set no longer fits the largest practical instance, or sustained writes approach ~70 % of the primary's measured ceiling. The shard key would be **`{ userId: "hashed" }`** or `{ userId: 1, _id: 1 }`: every query already includes `userId`, so all reads and writes stay single-shard and targeted, and hashing spreads tenants evenly. A single very large tenant would be the hot-spot risk, which is mitigated by `{ userId, _id }` range chunks. No sharding is added now; nothing measured requires it.

## 4. Bottlenecks identified and remedies

| Bottleneck (evidence) | Remedy (in order of value) |
| --- | --- |
| **Event loop CPU per request** (lag 21 ms at 1.5k req/s on one process) | Horizontal scale (implemented: stateless). Then profile with `--cpu-prof`: skip Mongoose for hot reads (native driver + `toTaskDto`), cache JWT verification per token for its lifetime, sample `info` request logs at high RPS |
| **`countDocuments` on every list page** (doubles list DB ops; scans all of a user's keys) | Cursor pagination (`(updatedAt, _id) < cursor`, no total) for infinite scroll; or cache totals per user+filter under the same generation scheme |
| Deep offset pages (`SKIP` examines `page × limit` keys) | Same: cursor pagination; `page ≤ 1000` already bounds the damage |
| Text search (243 keys for 20 results for a common word) | Bounded by the per-user prefix; Atlas Search if relevance, fuzzy or substring search becomes a requirement |
| Writes are primary-bound | Batching is not semantically valid for interactive edits; if writes ever dominate, shard by `userId` |
| Login (Argon2 ≈ 20–40 ms CPU each) | Intentional. Rate limited and excluded from the 10k budget; isolate auth to its own instances if login storms ever starve CRUD |

## 5. Load-test procedure

**Local (safe):**

```bash
npm run seed -- --loadtest 200
npm run build -w @taskmanager/api
# production mode with load-test limits; the normal limits correctly reject generated traffic
cd apps/api && NODE_ENV=production WEB_ORIGIN=https://tasks.example.test \
  RATE_LIMIT_MAX=10000000 AUTH_RATE_LIMIT_MAX=100000 LOGIN_ACCOUNT_RATE_LIMIT_MAX=100000 \
  SEARCH_RATE_LIMIT_MAX=10000000 METRICS_TOKEN=local-metrics-token-12345 \
  MONGODB_URI=mongodb://127.0.0.1:27017/taskmanager REDIS_URL=redis://127.0.0.1:6379 \
  ACCESS_TOKEN_SECRET=… COOKIE_SECRET=… node dist/server.js > /tmp/api.log &
cd ../.. && k6 run -e SCENARIO=smoke scripts/load-test.js
k6 run -e SCENARIO=read -e RATE=500 -e DURATION=60s scripts/load-test.js
# cache-cold: restart the API with DASHBOARD_CACHE_TTL_SECONDS=0, then SCENARIO=dashboard
# dependency degradation: run SCENARIO=mixed and stop Redis mid-run
# multiple instances: BASE_URLS=http://h:4001,http://h:4002 (each VU sticks to one instance)
```

**Production-like validation of the 10k target** (dedicated, isolated environment, never shared infrastructure without approval):

1. **Environment:** the target topology from §3 (e.g. 6 × c7g.xlarge running 4 API processes each behind an ALB, Atlas M50 3-node, ElastiCache r7g.large), seeded with ≥ 100k synthetic users (`seed --loadtest 100000`, run in batches) so the data does not fit in caches trivially.
2. **Load generators:** 3–4 separate c7g.2xlarge k6 hosts in the same region (or k6 Cloud). Confirm k6 CPU stays < 70 % and that `dropped_iterations` stays 0 below saturation, so the generator is not the bottleneck.
3. **Warm-up:** 5 min at 1,000 req/s (JIT, pools, WiredTiger cache, Redis keys).
4. **Steps:** `SCENARIO=staged STAGES=1000,2500,5000,7500,10000 STAGE_DURATION=5m`, with 10 s ramps. Stop at the first step that breaks a threshold, then bisect.
5. **Soak:** 10,000 req/s `mixed` for 30 min. Check that memory, event-loop lag, pool checkout and replication lag stay flat.
6. **Spike:** `SCENARIO=spike RATE=3000` (3k → 15k → 3k). Expect 503 `OVERLOADED` shedding during the spike, no 5xx cascade, and recovery within 60 s.
7. **Faults under load:** kill one API task (the LB drains it, and errors stay < 0.1 %); fail over the Mongo primary (writes pause for ≤ ~10 s of retryable writes); stop Redis (0 % errors, `degraded`).
8. **Record for each step:** achieved req/s, p50/p95/p99 per tag (`kind:read|write`), status distribution, dropped iterations, API CPU and RSS, `nodejs_eventloop_lag_p99_seconds`, `mongodb_command_duration_seconds`, `mongodb_pool_connections_checked_out`, Atlas CPU, IOPS, cache-hit and replication lag, Redis latency and hit ratio, and network throughput.
9. **Pass criteria:** §1. Report the first saturated resource honestly if 10k is not met.

## 6. Backpressure and resilience settings

| Mechanism | Setting | Behaviour |
| --- | --- | --- |
| In-flight cap per instance | `MAX_IN_FLIGHT` (2000 default; **set ~200 per vCPU in production**) | Immediate 503 `OVERLOADED` + `Retry-After: 1`; the LB retries on another instance |
| Request deadline | `REQUEST_TIMEOUT_MS` = 10 s | 503 `TIMEOUT`; handler results after the deadline are discarded |
| Query deadline | `maxTimeMS` = `DB_QUERY_TIMEOUT_MS` (5 s) on every query | The server aborts work for abandoned requests |
| Pool wait | `waitQueueTimeoutMS` = 2 s | 503 instead of an unbounded queue |
| No offline buffering | Mongoose `bufferCommands=false`; ioredis `enableOfflineQueue=false` | Outages surface immediately; no memory growth |
| Redis call budget | `commandTimeout` = 150 ms | Cache bypass and the rate-limit fallback keep requests flowing |
| Retries | Driver `retryWrites`/`retryReads` (single automatic retry on failover); client retries only GETs on network/5xx, at most 2, with jittered backoff; mutations never retry automatically | No retry storms; no double-applied writes (the only non-idempotent write, create, is never auto-retried) |
| Startup | Server listens immediately; MongoDB connects with exponential backoff + jitter | Liveness OK, readiness 503 until connected |
| Shutdown | SIGTERM → readiness 503 → `server.close()` drains → close Mongo and Redis → exit; forced exit after `SHUTDOWN_TIMEOUT_MS` | Verified locally: "shutting down: draining" → "shutdown complete" |
| HTTP server | `keepAliveTimeout` 65 s (> ALB 60 s idle), `headersTimeout` 66 s, `requestTimeout` 30 s | Avoids LB keep-alive races and slowloris |

A circuit breaker was not added. For MongoDB the driver's server selection and pool timeouts already fail fast, and there is no fallback data source. For Redis, the readiness check plus timeouts act as the breaker.

## 7. Failure modes

| Event | What happens |
| --- | --- |
| Redis unavailable | Requests succeed. Limits become per-instance (looser by the instance count), the dashboard is computed live, readiness reports `degraded`, and `RedisDegraded` alerts. *Measured: 0 % errors.* |
| MongoDB unavailable | Data requests get 503 `SERVICE_UNAVAILABLE` + `Retry-After: 5` (fast, no buffering), readiness fails so the LB stops routing, liveness stays OK so pods are not restart-looped, and reconnection is automatic. *Verified locally.* |
| One API instance crashes | Its in-flight requests fail and the LB health check removes it. Sessions are unaffected (stateless). |
| Rolling deployment | Each old task gets SIGTERM, readiness fails, it drains up to 20 s and exits; new tasks receive traffic only once ready. |
| Traffic above capacity | Instances shed with 503 + `Retry-After` at the in-flight cap or the deadline; autoscaling on CPU or request count adds instances. |
| Request exceeds deadline | 503 `TIMEOUT`; the DB query is aborted by `maxTimeMS`. |
| Stale cache entry | At most 60 s ± 10 % stale for time-driven changes (overdue); never stale after the user's own writes (generation bump). |
| Pool saturated | Callers wait ≤ 2 s, then get 503; `MongoPoolCheckoutFailures` alerts. |
| Primary failover | Retryable writes and reads retry once transparently; requests during the election (~5–12 s) may see 503. |
