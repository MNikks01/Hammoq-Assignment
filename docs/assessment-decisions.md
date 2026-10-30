# Assessment decisions

## A. Three important engineering decisions

### 1. Authorization at the database query boundary

**Problem.** A task manager's most damaging bug is one user reading or changing another user's data (IDOR). Checking ownership in a separate step ("load the task, then compare `task.userId`") is easy to forget on one endpoint and creates a time-of-check/time-of-use gap.

**Approach.** Ownership is part of every query. The user id comes only from the verified access token (`req.auth.userId`) and is written into each filter: `findOne({ _id, userId })`, `findOneAndUpdate({ _id, userId, version })`, `deleteOne({ _id, userId })`, `find({ userId, … })`, and the dashboard aggregation `$match: { userId }`. A miss returns **404 rather than 403**, so the API never confirms that someone else's id exists. Request schemas are `.strict()`, so a client cannot send `userId` at all, and the field is `immutable` in the model.

**Why.** Authorization becomes structural instead of procedural: there is no code path that fetches a task without its owner. It also makes every query tenant-prefixed, which is what the indexes need (decision 3) and what a future shard key needs.

**Alternatives.** A middleware that loads and checks the resource (an extra query and easy to bypass); MongoDB views or field-level security per user (heavy for this scope); a policy engine such as CASL (useful once roles and shared tasks exist, but premature here).

**Trade-offs.** "Not found" and "forbidden" are deliberately indistinguishable. Shared or team tasks would need an explicit access model (a membership collection or `memberIds` in the filter) instead of a single owner.

**Evidence.** `tests/integration/security.test.ts` (cross-user read, update, status, delete, list, search and dashboard; mass assignment of `userId`) and the Playwright test "a second user cannot see or access the first user's tasks".

### 2. Cookie sessions: short-lived stateless access tokens + rotating refresh tokens

**Problem.** The SPA needs sessions that survive reloads, cannot be stolen by XSS, resist CSRF, can be revoked, and do not put a database lookup on every request (which matters for the 10k RPS goal).

**Approach.** A 15-minute HS256 JWT in an HttpOnly `SameSite=Lax` cookie, verified without any database access. A random 256-bit refresh token in an HttpOnly `SameSite=Strict` cookie scoped to `/api/v1/auth`, stored only as a SHA-256 hash, **rotated on every use** with an atomic claim. Replaying a rotated token revokes its whole family (with a 10 s grace window for two tabs refreshing at once). A signed double-submit CSRF token is required on every state-changing request, and the client refreshes transparently with a single-flight `/auth/refresh` on a 401.

**Why.** Tokens are not readable by page scripts, revocation exists where it matters (refresh, logout, password change, theft detection), and the hot path is CPU-only, so API instances scale horizontally without a shared session store.

**Alternatives.** Server-side sessions in Redis (instant revocation, but a Redis hop per request and Redis becomes critical), JWTs in localStorage (XSS-stealable), or a third-party IdP (the right call for a product, but out of scope and it hides the engineering being assessed).

**Trade-offs.** An access token stays valid for up to 15 minutes after revocation (see §C). The design needs CSRF protection, which bearer tokens would not.

**Evidence.** `tests/integration/auth.test.ts` covers cookie attributes, rotation, grace-window replay, theft replay revoking the family, expiry, logout revocation, password change revoking other sessions, and expired, tampered and wrong-key JWTs. `tests/unit/security-primitives.test.ts` covers `alg=none` and CSRF signatures. `src/lib/api.test.ts` covers the refresh-and-retry logic.

### 3. Tenant-prefixed indexes chosen from measured query plans, with a scoped Redis cache

**Problem.** List, filter, sort and dashboard queries have to stay fast as data grows, without indexing every combination (each index costs write throughput and RAM) and without caching data that changes constantly.

**Approach.** Six task indexes, each starting with `userId`, with the API's stable sort key (`<field>, _id`) built into the index so pagination never sorts in memory. The set was **validated with `explain("executionStats")`** on a seeded dataset (`npm run db:explain`), and one index was added because of the evidence: priority sorting was a blocking SORT of 2,976 documents (57 ms) for the heaviest user, and the new `user_priority` index reduced it to 20 keys and 0 ms. Dashboard status counts are covered queries (0 documents fetched). Only the dashboard summary is cached, per user, with **generation-based invalidation** (`INCR` on every write), TTL jitter, single-flight, a 150 ms Redis budget and a fallback to MongoDB.

**Why.** Measured plans beat guesses. Caching only the endpoint that fans out to four queries keeps the cache simple to reason about: no cross-user keys, and no stale reads after the user's own writes.

**Alternatives.** Caching task lists (many key combinations and complex invalidation, for data already served in single-digit milliseconds), compound indexes for every filter (write amplification), Atlas Search (a better search engine, but new infrastructure for a requirement that did not need it), and delete-on-write invalidation (racy without locks).

**Trade-offs.** Filtering by priority or tag without the matching sort scans one user's index range. Offset pagination and `countDocuments` still cost O(user's tasks), which the next iteration addresses with cursors. The cache can be up to 60 s stale for purely time-based changes (a task becoming overdue).

**Evidence.** The `explain` table in `docs/architecture.md#indexes`; k6 dashboard p95 of 1.1 ms (warm) vs 4.9 ms (cold); a Redis kill under load with 0 % errors; `tests/unit/dashboard-cache.test.ts` (generation semantics, single-flight, bypass, key validation); `tests/integration/dashboard.test.ts` (real Redis invalidation after create, status and delete; per-user isolation).

## B. Three deliberately unimplemented features

### 1. Real-time collaboration (shared tasks and live updates)
- **What it would do:** share tasks or projects with teammates, see their edits live, and show presence.
- **Why not:** it changes the authorization model from one owner to memberships with roles, and it needs a push channel (WebSockets or SSE) that is stateful per connection. That pushes back against the stateless scaling design and needs pub/sub fan-out across instances.
- **Work required:** `projects` and `memberships` collections; membership-aware query filters (decision 1 extends naturally to `{ projectId, … }` plus a membership check); a WebSocket gateway with sticky connections or a Redis/NATS pub-sub; change events from MongoDB change streams; conflict handling beyond the current `version` compare-and-set; load tests for connection counts.
- **Why other work came first:** a correct, secure single-user product with verified isolation and a credible scaling path is worth more to the assessment than a partially working collaboration layer. The optimistic-concurrency `version` field already prevents silent lost updates across tabs and devices.

### 2. Email flows: password reset, email verification and due-date reminders
- **What it would do:** recover accounts, prove email ownership, and notify users before tasks are due.
- **Why not:** it needs an email provider, domain authentication (SPF, DKIM, DMARC) and a background job runner. Building it against a fake provider would demonstrate little, and a half-secure reset flow is worse than none.
- **Work required:** single-use reset tokens stored hashed with a ≤ 30-minute expiry and an identical response for known and unknown emails; a revoke-all-sessions-on-reset step (already available); a verification state on users; a queue (BullMQ on the existing Redis) for reminders with idempotency keys so retries do not double-send; provider webhooks for bounces; rate limits per address.
- **Why other work came first:** core authentication (hashing, rotation, CSRF, reuse detection, password change) is complete and tested; this would add infrastructure rather than demonstrate different engineering. It is also why registration reveals whether an email is taken (documented and rate limited).

### 3. Advanced search (substring, fuzzy, relevance-ranked) via MongoDB Atlas Search
- **What it would do:** find "rep" in "report", tolerate typos, and rank results by relevance with highlighting.
- **Why not:** the MongoDB text index already gives tenant-scoped, word-based search with weighted title matches and fits the measured workload. Atlas Search (or OpenSearch) adds a separate indexing pipeline, eventual consistency between writes and search results, and a deployment dependency that does not exist locally.
- **Work required:** an Atlas Search index with `userId` as a filter facet; `$search` queries with a mandatory `userId` filter (the same isolation rule); index-lag handling in the UI after writes; relevance tests; a cost review.
- **Why other work came first:** search correctness and isolation were higher priority than ranking quality, and the current approach is index-backed and verified (243 keys examined for 20 results for a common term).

## C. Implementation limitation

**What it is.** Access tokens are verified statelessly, so revocation is not immediate for tokens that were already issued. After a user changes their password, or a stolen refresh token is detected and its family revoked, any access token already issued to another device keeps working for up to `ACCESS_TOKEN_TTL` (15 minutes). The browser that logs out is unaffected, because its cookie is cleared.

**Why it exists.** It is the deliberate trade-off in decision 2: no session lookup on the request hot path, so API instances stay stateless and cheap to scale toward the RPS target.

**Practical impact.** An attacker who has already stolen an *access* token (which is HttpOnly, so this needs something beyond ordinary XSS) keeps access to that one account for at most 15 minutes after the victim reacts. Refresh is blocked, so the access cannot be extended.

**What I would build with one more day.** A **revocation epoch per user in Redis, checked on each request with a local cache**:
1. Add `sessionVersion` to users and include it as a claim (`sv`) in access tokens.
2. On password change, theft detection or "sign out everywhere", increment `sessionVersion` in MongoDB and write `tm:sv:<userId>` to Redis (TTL = access TTL).
3. In `authenticate`, compare the token's `sv` with the cached value: an in-process LRU with a 5–10 s TTL in front of one Redis GET, falling back to MongoDB if Redis is down. This keeps the hot path at about zero added latency for most requests while bounding revocation delay to seconds.
4. Add a "Sign out of all devices" button in Settings and a per-session list (the sessions collection already stores the user agent and creation time).

**How I would verify it.** Integration tests: issue two sessions, change the password on one, and assert the other session's still-valid access token gets 401 within the cache TTL; repeat with Redis stopped (MongoDB fallback). Re-run the k6 `read` and `mixed` scenarios and compare p95/p99 and throughput with the numbers in `docs/scalability.md`; the acceptance criterion is < 5 % throughput regression. Add a `auth_revocation_checks_total{source=lru|redis|mongo}` metric to confirm the cache hit ratio under load.

Other limitations (offset pagination, word-based search, undated tasks sorting first, no email flows, images and CI not executed here) are listed in the README.

## Verification summary

Commands run at submission on macOS (Apple M2, Node 24, MongoDB 8.3, Redis 8):

| Check | Result |
| --- | --- |
| `npm run typecheck` (3 workspaces, strict) | pass |
| `npm run lint` · `npm run format:check` | pass |
| `npm run test:unit` | 52 passed (contracts 13, API 25, web 14) |
| `npm run test:integration` (real MongoDB + Redis) | 51 passed |
| `npm run test:e2e` (Playwright, Chromium desktop + Pixel 7) | 4 passed: lifecycle (journeys 1–9), cross-user isolation (10), axe WCAG A/AA, mobile nav |
| `npm run build` | pass (API bundle; SPA ≈ 170 KB gzip JS total) |
| `npm audit --omit=dev` | 0 vulnerabilities (after upgrading zod 3 → 4 and react-router 6 → 7) |
| `k6 … SCENARIO=smoke` | 24/24 checks, 0 failed requests |
| k6 load scenarios | see `docs/scalability.md` §2 (single instance; 10k RPS **not** demonstrated) |
| Docker image builds, `docker compose up` | **not run** (no Docker daemon available); `docker compose config` validates |
| GitHub Actions workflow | written, not executed (no remote repository) |

## D. Video script (≈ 4–5 minutes)

> **[0:00 — Intro, app on screen: dashboard as the demo user]**
> Hi, I'm presenting Taskflow, a task manager I built in TypeScript end to end: React and Vite on the front, Express 5 on the back, MongoDB as the source of truth and Redis for rate limiting and one cache. I'll show it working, then explain three engineering decisions, three features I chose not to build, and the main limitation I'd fix next.

> **[0:20 — Demo: Tasks page]**
> Here's the task list. I can filter by status and priority, search, and sort. Notice the URL updates, so a filtered view survives a refresh. I'll create a task with a due date and tags… edit it… and tick it complete. The checkbox is optimistic and rolls back if the server rejects it. Deleting asks for confirmation. The dashboard counts come from the database, and they update right after I change something.

> **[1:10 — Decision 1: authorization in the query (show `task.service.ts`)]**
> The first decision is where authorization lives. I don't load a task and then check its owner. The owner is part of every query: find, update and delete all filter on `_id` *and* the user id from the verified token. If it isn't yours, the query simply doesn't match and you get a 404, so the API never even confirms the id exists. The schemas are strict, so you can't send a `userId` in the body. I test this with a second user in both the integration suite and Playwright.

> **[1:50 — Decision 2: sessions (show cookies in devtools, then `auth.service.ts` refresh)]**
> Second, sessions. The access token is a 15-minute JWT in an HttpOnly cookie, so page scripts can't read it, and verifying it doesn't touch the database. That matters for scaling. The refresh token is random, stored only as a hash, and rotated on every use. If an old refresh token is ever replayed, I treat it as theft and revoke the whole session family. Every write also needs a signed CSRF token.

> **[2:30 — Decision 3: indexes from evidence + scoped cache (show `npm run db:explain` output)]**
> Third, indexes. Every index starts with the user id, and the sort key including `_id` is in the index, so pages never sort in memory. I validated this with explain plans: list queries read about 20 keys for 20 results. Explain also showed priority sorting as a blocking sort of almost three thousand documents, so I added one index for it, and it went from 57 milliseconds to zero. I cache only the dashboard, per user, with a generation counter so a stale value can never be served after your own write. In a load test I killed Redis mid-run and no request failed.

> **[3:15 — Not built]**
> Three things I deliberately left out. Real-time collaboration, because shared tasks change the authorization model and live updates add stateful connections that cut against my stateless scaling. Email flows like password reset and reminders, because they need a provider and a job queue, and a half-secure reset flow is worse than none. And fuzzy search with Atlas Search, because MongoDB's text index already gives me tenant-scoped, index-backed search that fits the requirements.

> **[3:50 — Limitation]**
> The main limitation is revocation latency. Because access tokens are checked statelessly, an access token that's already been issued stays valid for up to 15 minutes after a password change. With another day, I'd add a per-user session version cached in Redis with a short in-process cache, so revocation takes seconds while the hot path stays fast, and I'd prove it with an integration test and a before/after load test.

> **[4:20 — Honest numbers + close]**
> On performance: on my laptop one API process handles about a thousand authenticated list requests a second at single-digit-millisecond p95, and the health path reaches ten thousand. I did *not* demonstrate ten thousand real requests per second; that needs multiple instances on real infrastructure. The scalability doc has the capacity model and the exact test plan. Thanks for watching.

**Suggested demo prep:** `npm run seed`, sign in as `demo@taskmanager.dev`. Have `apps/api/src/modules/tasks/task.service.ts`, `apps/api/src/modules/auth/auth.service.ts` and `npm run db:explain` output ready in a terminal.
