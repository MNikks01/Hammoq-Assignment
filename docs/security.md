# Security

This document describes the controls that are implemented, why each exists, and what remains out of scope. It is not a certification; treat it as the starting point for a review.

## Threat model (summary)

| Asset | Threats considered | Primary controls |
| --- | --- | --- |
| User credentials | Credential stuffing, brute force, DB leak, timing-based enumeration | Argon2id; IP + per-account login limits; generic errors with dummy-hash timing equalization; hashes never selected by default |
| Sessions | XSS token theft, CSRF, refresh-token theft or replay, fixation | HttpOnly cookies; SameSite; signed double-submit CSRF; rotating refresh tokens with family revocation; tokens stored hashed |
| Other users' tasks | IDOR, mass assignment, NoSQL injection | `userId` from the verified token in every query; strict allowlist schemas; server-built filters; `$literal` in update pipelines |
| Availability | Request floods, oversized bodies, slow queries, dependency outages | Rate limits; in-flight cap; deadlines; `maxTimeMS`; 16 KB body cap; fail-fast DB behaviour; Redis fallback |
| Secrets and logs | Leakage through logs, errors, images or the repo | Pino redaction; generic 5xx bodies; validated env; `.env` gitignored; no secrets in images |

Out of scope for this assessment: WAF/bot management, MFA, email verification, account lockout notifications, audit logging, data encryption beyond what the managed database provides, and DDoS absorption (an edge or CDN responsibility).

## Authentication flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant M as MongoDB
  B->>A: GET /auth/csrf
  A-->>B: Set-Cookie tm_csrf=<nonce.hmac> (readable, SameSite=Strict)
  B->>A: POST /auth/login {email,password} + X-CSRF-Token
  A->>M: find user by normalized email
  A->>A: argon2.verify (dummy hash if no user)
  A->>M: insert session {familyId, sha256(refresh), expiresAt, absoluteExpiresAt}
  A-->>B: Set-Cookie tm_at=JWT(15m, HttpOnly, Lax) and tm_rt=random(7d, HttpOnly, Strict, Path=/api/v1/auth)
  B->>A: GET /tasks (cookie tm_at)
  A->>A: verify JWT (HS256, iss, aud, exp), no DB lookup
  Note over B,A: 15 minutes later
  B->>A: GET /tasks → 401
  B->>A: POST /auth/refresh (cookie tm_rt) + CSRF
  A->>M: find session by sha256(rt); claim with conditional update (replacedAt=null)
  A->>M: insert next session in the same family
  A-->>B: new tm_at and tm_rt
  B->>A: retry GET /tasks
```

- **Password hashing:** Argon2id, m=19 MiB, t=2, p=1 (OWASP minimum). Hashes are transparently upgraded on login if the parameters change. A login for an unknown email still runs a full verification against a dummy hash.
- **Access token:** HS256 JWT signed with `ACCESS_TOKEN_SECRET`, with `iss`, `aud`, `sub` (user id) and `sid`. Verification pins the algorithm list (so `alg=none` and key-confusion attacks are rejected) and allows 5 s of clock tolerance.
- **Refresh token:** 256-bit random value; only its SHA-256 is stored. Because the token is high-entropy, a fast hash is sufficient: a database leak yields nothing usable. Rotation is claimed atomically, so two concurrent refreshes cannot both succeed. A token replayed within 10 s of its rotation (two tabs racing) fails without side effects; a later replay is treated as theft and **revokes the whole family**. Sessions have a sliding 7-day expiry with a hard 30-day cap, and expired documents are removed by a TTL index.
- **Logout** revokes the family server-side and clears cookies. **Password change** revokes every session and issues a fresh one. **Account deletion** requires the password and removes sessions first.
- **Known gap:** access tokens are not checked against revocation, so after logout elsewhere or a password change, an already-issued access token stays valid for up to `ACCESS_TOKEN_TTL` (15 min). The browser that logs out loses its cookie immediately. The fix is described in the assessment decisions (§C).

## Browser security

- **Cookies:** HttpOnly for every session credential, `Secure` in production (enforced at startup), `SameSite=Lax` for the access cookie (top-level navigations keep working), `SameSite=Strict` and a narrow `Path` for the refresh cookie. Nothing sensitive is stored in localStorage or sessionStorage.
- **CSRF:** a signed double-submit token (`nonce.HMAC(COOKIE_SECRET, nonce)`) must be sent in `X-CSRF-Token` on every POST/PATCH/DELETE, including login (which prevents login CSRF). The signature stops an attacker who can plant cookies from a sibling subdomain from choosing a valid token. This layers with SameSite cookies, the CORS allowlist (the custom header forces a preflight that untrusted origins fail) and the JSON-only body requirement (HTML forms cannot send JSON).
- **CORS:** credentials are allowed only for origins in `WEB_ORIGIN`. A wildcard is never used. The recommended deployment is same-origin (`/api` behind the same host), which avoids CORS entirely.
- **Headers:** Helmet on the API with `default-src 'none'; frame-ancestors 'none'` (it only serves JSON), `nosniff`, `Referrer-Policy`, HSTS in production, `X-Powered-By` removed and ETags disabled. The SPA's nginx sends a CSP with `script-src 'self'` (no inline or eval scripts). Inline *styles* are allowed because Radix and Sonner inject small style tags; inline styles are a far lower risk than scripts.
- **XSS:** React escapes all user content; there is no `dangerouslySetInnerHTML`. Tags are restricted to `[a-z0-9-]`, so they are safe in any context.
- **Host header / DNS rebinding:** the API never builds absolute URLs or redirects from `Host`. In production the load balancer should only forward the configured hostnames, and the API should not be reachable directly.

## Input handling and authorization

- **Validation:** every body, query and path parameter goes through a Zod schema from `packages/contracts`. Object schemas are `.strict()`, so unknown keys (`userId`, `_id`, `version`, `completedAt`, `role`, `$where`, …) fail with 400. Types are exact, so `{ "$gt": "" }` is not a string. Query parameters must be single values (blocks HTTP parameter pollution), and limits, page bounds, string lengths, enum values and date ranges are enforced.
- **NoSQL injection:** filters are constructed in `task.query.ts` only from validated primitives, with server-chosen operators. Update pipelines treat strings beginning with `$` as field paths, so every client value is wrapped in `$literal` (a task titled `$userId` is stored literally; an integration test checks this). Mongoose `strictQuery` drops unknown filter paths.
- **Authorization:** deny by default. Each router mounts `authenticate` before its handlers, and ownership is part of the query (`{ _id, userId: <from token> }`) for read, update, status, delete, list, search and dashboard. Another user's task returns 404, which avoids confirming that the id exists. Integration and E2E tests exercise cross-user access on every operation.
- **Prototype pollution:** JSON is parsed by `JSON.parse`, no deep merging is done anywhere, and strict schemas reject `__proto__`/`constructor` keys.

## Abuse prevention and availability

- Rate limits (see [api.md](api.md#conventions)) use a fixed-window counter in Redis shared by all instances (`INCR` + `PEXPIRE NX` in one `MULTI`). If Redis is down they fall back to a per-instance in-memory counter, so limits get looser by the instance count rather than either blocking everyone or disappearing; the fallback is counted in a metric and alerted on. IPv6 clients are keyed by /56, and `trust proxy` is an explicit hop count, so `X-Forwarded-For` cannot be spoofed past the trusted proxy.
- Rate limiting (abuse) is distinct from capacity management (the in-flight cap, request deadlines and pool wait timeouts), which return 503 + `Retry-After`.

## Secrets, dependencies and logging

- Configuration is validated at startup. Missing or short secrets stop the process; in production, placeholder-looking or identical secrets, http origins and insecure cookies are also rejected. Error messages name keys but never values.
- `.env` is gitignored; `.env.example` holds placeholders only. Docker images contain no secrets (`.dockerignore` excludes `.env*`) and run as non-root.
- Use a dedicated MongoDB user with `readWrite` on the application database only. Index creation runs from a separate deployment step that may use a more privileged role.
- Dependencies are locked (`package-lock.json`). Native install scripts are allowlisted (`argon2`, `esbuild`). CI fails on high or critical advisories in shipped dependencies (`npm audit --omit=dev --audit-level=high`). During this work the audit found GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6, high) and an open-redirect advisory in react-router ≤ 7.17; both were fixed by upgrading (zod 4, react-router 7) rather than suppressed.
- Logs are structured JSON. Authorization and cookie headers, `Set-Cookie`, CSRF tokens and any `password`/`token` fields are redacted. Query strings are not logged (search terms can be personal). Bodies are never logged.
- **Rotation:** rotating `ACCESS_TOKEN_SECRET` invalidates all access tokens (users silently refresh within 15 minutes; the refresh tokens remain valid because they are stored hashes, not signed). Rotating `COOKIE_SECRET` invalidates CSRF tokens, and the SPA refetches one automatically. Both can be rotated by redeploying with new values. Supporting key ids for overlap-free rotation is a follow-up.

## Incident response basics

1. **Suspected token theft or account compromise:** revoke the user's sessions (`db.sessions.updateMany({userId}, {$set: {revokedAt: new Date()}})`); if it is widespread, rotate `ACCESS_TOKEN_SECRET` to cut the 15-minute window.
2. **Credential-stuffing spike** (`auth_events_total{event="login_failure"}`, `rate_limit_rejections_total{limiter="login_account"}`): tighten `AUTH_RATE_LIMIT_MAX` and enable WAF or bot rules at the edge.
3. **Leaked secret:** rotate it, redeploy, review logs by request id, and assess the blast radius according to which secret leaked (see Rotation above).
4. Keep the request id from the user's error message: it ties the client report to the server logs.

## Security tests (all automated)

Unauthorized requests on every protected route · invalid, tampered, expired and wrong-key JWTs · `alg=none` · refresh rotation, grace-window replay, theft replay revoking the family, expired refresh · logout revocation · password change revoking other sessions · cross-user read/update/status/delete/list/search/dashboard · mass assignment on create and update · operator injection in body, query, bracket syntax and parameter pollution · `$`-prefixed strings in pipelines · invalid pagination and sort · 413/415/malformed JSON · rate limits (IP, account, user) with `Retry-After` · CSRF missing, mismatched or forged · cookie attributes · generic login errors · security headers, CORS allowlist, request-id sanitization · no internals in errors · redaction paths.
