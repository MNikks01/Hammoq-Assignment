# Taskflow: Assessment Submission

**Candidate:** Nikhil · **Role:** MERN Stack Developer, Hammoq Infosystems Pvt. Ltd.
**Repository:** https://github.com/MNikks01/Hammoq-Assignment
**Stack:** TypeScript end to end: React 18 + Vite (web), Express 5 (API), MongoDB (data), Redis (rate limiting and dashboard cache)

This document answers the three written parts of the assessment:

1. The three most important decisions I made (also covered on camera in the video)
2. Three features I deliberately did not implement, and why
3. One limitation I would fix with one more day

How to run the app is in [`docs/running.md`](running.md). In short, run `docker compose up --build -d`, then `docker compose run --rm api node dist/seed.js`. Open http://localhost:8080 and sign in as `demo@taskmanager.dev` / `DemoPassword2026`.

---

## 1. The three most important decisions

### Decision 1: Authorization is built into every database query

**The problem.** The most damaging bug in a multi-user task manager is one user reading or changing another user's tasks. The security term is *IDOR* (insecure direct object reference). The common pattern loads the task and then checks `task.userId === currentUser`. That check is easy to forget on a single endpoint, and one missed check is a data leak.

**What I did.**
- The user id is never taken from the request. It comes only from the verified access token.
- Every query includes the owner as a filter, not just the task id:
  - read: `findOne({ _id, userId })`
  - update: `findOneAndUpdate({ _id, userId, version })`
  - delete: `deleteOne({ _id, userId })`
  - lists, search and the dashboard: `{ userId, … }`
- If the task belongs to someone else, the query matches nothing and the API returns **404 Not Found**, not 403 Forbidden. The API never even confirms that another user's task id exists.
- Request schemas are strict, so a client cannot send a `userId` field to reassign a task. The field is also immutable in the database model.

**Why this matters.**
- Authorization becomes part of the structure instead of a step to remember. No code path fetches a task without its owner.
- The same "user id first" shape is what the database indexes need (Decision 3). It is also the natural shard key if the data ever has to be split across servers.

**Alternatives I considered.**
- A middleware that loads the resource and checks the owner: costs an extra query and is easy to bypass.
- A policy library such as CASL: useful once roles and shared tasks exist, but premature for single-owner tasks.

**Trade-off.** "Not found" and "forbidden" look the same on purpose. Shared or team tasks would need an explicit membership model.

**How I proved it.**
- Integration tests create a second user and attempt cross-user read, update, status change, delete, list, search and dashboard access. Every attempt gets 404 or excludes the data.
- A test tries to inject `userId` in the request body.
- A Playwright end-to-end test checks in a real browser that a second user cannot see or open the first user's tasks.

### Decision 2: Secure cookie sessions with short access tokens and rotating refresh tokens

**The problem.** The browser app needs a login that:
- survives page reloads
- cannot be stolen by malicious scripts (XSS)
- resists cross-site request forgery (CSRF)
- can be revoked
- does not add a database lookup to every request, which matters for scaling

**What I did.**
- **Access token:** a 15-minute signed JWT stored in an **HttpOnly** cookie, so page JavaScript cannot read it. The API verifies it with CPU only, with no database call.
- **Refresh token:** a random 256-bit value in a separate HttpOnly, `SameSite=Strict` cookie. It is sent only to the `/api/v1/auth` path.
  - The database stores only its **SHA-256 hash**, never the raw token.
  - It is **rotated on every use**: each refresh issues a new token and retires the old one atomically.
- **Theft detection:** if an already-used refresh token is presented again, the API treats it as stolen and **revokes the whole session family**. A 10-second grace window keeps two open tabs that refresh at the same moment from logging the user out.
- **CSRF protection:** every write (create, update, delete) requires a signed CSRF token in a header. That token must match a cookie.
- **Client:** when a request gets 401, the app refreshes the session once and retries. Parallel requests share a single refresh call, so the user never sees an unexpected logout.
- **Passwords:** hashed with argon2id. Login has per-IP and per-account rate limits.

**Why this matters.** Tokens cannot be read by scripts. Revocation exists where it matters: logout, password change and theft detection. Most importantly, the request hot path needs no shared session store, so API servers can be added horizontally without coordination.

**Alternatives I considered.**
- Server-side sessions in Redis: instant revocation, but every request needs a Redis call, and Redis becomes a single point of failure.
- JWT in localStorage: simple, but any XSS bug can steal it.
- A third-party identity provider (Auth0 and similar): right for a real product, but it would hide the engineering this assessment evaluates.

**Trade-off.** An already-issued access token stays valid for up to 15 minutes after revocation. This is the limitation in section 3.

**How I proved it.** Integration tests cover:
- cookie flags
- rotation
- replay inside the grace window
- theft replay revoking the family
- expiry
- logout
- password change revoking other sessions
- tampered tokens, wrong-key tokens and `alg=none` tokens

### Decision 3: Database indexes chosen from measured query plans, plus one carefully scoped cache

**The problem.** Lists, filters, sorting, pagination and the dashboard must stay fast as data grows. Indexing every combination is not free: every index slows down writes and uses memory. Caching everything creates stale-data bugs.

**What I did.**
- **Six indexes, each starting with `userId`.** Every query touches only one user's slice of data.
- **Sort keys live inside the index**, with `_id` as a tie-breaker, so pages are read pre-sorted and never sorted in memory.
- **Measured, not guessed.** I wrote `npm run db:explain`, which runs every production query through MongoDB's query planner on seeded data:
  - A normal list page reads **20 index keys for 20 results**.
  - Sorting by priority was a blocking in-memory sort of **2,976 documents (57 ms)**. I added one index for it, and that query now reads 20 keys in about **0 ms**.
  - Dashboard status counts are answered from the index alone, with 0 documents fetched.
- **Only the dashboard is cached.** It runs four aggregation queries, so it gains the most from caching.
  - The cache is per user, in Redis.
  - It uses **generation-based invalidation**: every write bumps a counter, and the cache key includes that counter. A user can never see a stale dashboard after their own change.
  - It also has TTL jitter (to avoid cache stampedes), single-flight (one rebuild at a time), and a 150 ms Redis time budget.
  - If Redis is slow or down, the API falls back to MongoDB automatically.

**Why this matters.** Measured query plans beat guesses. One well-understood cache is safer than many clever ones. Task lists are already served in single-digit milliseconds, so caching them would add risk for little gain.

**How I proved it.**
- Explain-plan output is recorded in `docs/architecture.md`.
- Load tests with k6: dashboard p95 latency was **1.1 ms warm versus 4.9 ms cold**.
- I **killed Redis in the middle of a load test**: 0% of requests failed.
- Unit and integration tests cover cache invalidation and per-user isolation.

---

## 2. Three features I deliberately did not implement

### 2.1 Real-time collaboration (shared tasks and live updates)

**What it would be.** Sharing tasks or projects with teammates, seeing their edits appear live, and showing who is online.

**Why I left it out.**
- It changes the security model from "one owner per task" to memberships with roles. Every query and every test in Decision 1 would need redesigning.
- Live updates need WebSockets or Server-Sent Events. These are long-lived, stateful connections. That works against the stateless design that lets the API scale horizontally, and it needs a pub/sub layer to fan out messages across servers.

**What it would take.** Project and membership collections, membership-aware query filters, a WebSocket gateway with Redis pub/sub, MongoDB change streams as the event source, conflict handling, and load tests for connection counts.

**Why other work came first.** A correct, secure, well-tested single-user product shows more than a half-working collaboration layer. Simultaneous edits from two tabs or devices are already safe: every update carries a `version` number. A stale edit gets a clear conflict response instead of silently overwriting newer data.

### 2.2 Email flows: password reset, email verification and due-date reminders

**What it would be.** Recovering a forgotten password, confirming that the user owns their email address, and reminding users before tasks are due.

**Why I left it out.**
- It needs a real email provider and domain authentication (SPF, DKIM, DMARC). Reminders also need a background job queue.
- Building it against a fake provider would demonstrate little.
- Password reset is security-critical. **A half-secure reset flow is worse than none**, because it becomes the easiest way to take over an account.

**What it would take.** Single-use reset tokens, stored hashed and expiring within 30 minutes. The same response for known and unknown emails, so attackers cannot discover accounts. Revoking all sessions after a reset (this already exists). A BullMQ job queue on the existing Redis, with idempotency keys so retries never send duplicate emails. Bounce handling and per-address rate limits.

**Why other work came first.** Core authentication is complete and tested: hashing, token rotation, CSRF, theft detection and password change. Email flows would add infrastructure rather than show different engineering skills.

### 2.3 Advanced search (substring, typo-tolerant and relevance-ranked)

**What it would be.** Finding "rep" inside "report", tolerating typos, and ranking results by relevance with highlights, using MongoDB Atlas Search or OpenSearch.

**Why I left it out.**
- The built-in MongoDB text index already gives fast, word-based search. Title matches are weighted higher, every search is limited to the current user, and it is backed by an index.
- A dedicated search engine adds a separate indexing pipeline. It also adds a delay between saving a task and seeing it in search results, and a cloud dependency that cannot run locally.

**What it would take.** An Atlas Search index with a mandatory `userId` filter (the same isolation rule as Decision 1), handling of index lag in the UI, relevance tests and a cost review.

**Why other work came first.** Correct and isolated search mattered more than ranking quality. The current search is verified: a common term examines 243 index keys to return 20 results.

---

## 3. Implementation limitation I would fix with one more day

### The limitation: revoking a session is not instant

Access tokens are checked without a database lookup (Decision 2). As a result, revocation does not reach access tokens that were already issued:
- when a user changes their password
- when a stolen refresh token is detected

Any access token already held by another device keeps working for **up to 15 minutes**, until it expires.

The browser that logs out is not affected, because its cookie is cleared immediately. The attacker also cannot extend access, because refreshing is blocked. Still, a 15-minute window is longer than it should be after a user reacts to a compromise.

### Why it exists

It is the deliberate trade-off of Decision 2: no session lookup on every request, so the API stays stateless and cheap to scale.

### What I would build in one day

A per-user **session version**, checked quickly on each request:

1. Add a `sessionVersion` number to each user and include it in the access token.
2. On a password change, theft detection or a new **"Sign out of all devices"** action, increase that number. Save it in MongoDB and in Redis.
3. On each request, compare the token's version with the current one:
   - First check a tiny in-memory cache that lives 5–10 seconds.
   - Then check Redis.
   - Fall back to MongoDB if Redis is down.
4. Add a "Sign out of all devices" button and a list of active sessions in Settings. The data needed for this is already stored.

**Result.** Revocation takes seconds instead of 15 minutes. The fast path stays almost free, because most checks hit the in-memory cache.

### How I would prove it works

- **Integration test:** open two sessions, change the password in one, and assert that the other session's still-unexpired access token is rejected within seconds. Repeat with Redis stopped, to prove the MongoDB fallback works.
- **Load test:** re-run the k6 read and mixed scenarios and compare against the current numbers. Acceptance criterion: less than 5% throughput loss.
- **Monitoring:** a new metric shows where each check is answered (memory cache, Redis or MongoDB), to confirm the cache works under load.

---

## Verification at submission

| Check | Result |
| --- | --- |
| Automated tests | **107 passing**: 52 unit, 51 integration (real MongoDB + Redis), 4 Playwright end-to-end |
| Type checking, lint, formatting | pass |
| Security audit (`npm audit`) | 0 vulnerabilities |
| Docker Compose stack (app + Prometheus + Grafana) | built, seeded, load-tested |
| GitHub Actions CI | green on all 4 jobs |
| Performance (one API process on a laptop) | about 1,000 authenticated list requests/s; health endpoint about 10,000 requests/s |

**On performance, honestly:** the design targets 10,000 requests per second with several API instances behind a load balancer. I did **not** demonstrate 10,000 real requests per second, because that needs real multi-server infrastructure. [`docs/scalability.md`](scalability.md) has the measured numbers, the capacity model and the exact test plan.
