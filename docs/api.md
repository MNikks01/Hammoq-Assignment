# API reference

Base path `/api/v1`. All bodies are JSON (`Content-Type: application/json` is required when a body is present; otherwise the API returns 415). The maximum body size is 16 KB (413 above that). Every response carries `X-Request-Id`, and API responses send `Cache-Control: private, no-store`.

## Conventions

**Success:** `{ "data": … }`, with `"meta": { page, limit, total, totalPages }` added on list responses.

**Error:**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "requestId": "4f1c…",
             "details": [{ "path": "title", "message": "Title is required" }] } }
```

| HTTP | code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Schema violation, unknown field or parameter, malformed JSON or id, wrong current password |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired session; bad credentials (always the same message) |
| 403 | `CSRF_INVALID` | Missing or mismatched CSRF token on POST/PATCH/DELETE |
| 404 | `NOT_FOUND` | Unknown route; task does not exist **or belongs to someone else** |
| 409 | `CONFLICT` / `VERSION_CONFLICT` | Email already registered / stale `version` on update |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body not JSON |
| 429 | `RATE_LIMITED` | Limit exceeded; `Retry-After` and `RateLimit`/`RateLimit-Policy` (draft-7) headers |
| 503 | `OVERLOADED` / `TIMEOUT` / `SERVICE_UNAVAILABLE` | In-flight cap, deadline or `maxTimeMS`, database unavailable; always with `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected; details are logged server-side under the request id |

**Authentication.** Browser sessions use cookies: `tm_at` (HttpOnly, SameSite=Lax, 15 min), `tm_rt` (HttpOnly, SameSite=Strict, `Path=/api/v1/auth`, 7 days, rotating) and `tm_csrf` (readable, SameSite=Strict). Every POST/PATCH/DELETE, including login and register, must send `X-CSRF-Token` equal to the `tm_csrf` cookie.

**Rate limits** (defaults, configurable):

| Limiter | Scope | Applies to | Default |
| --- | --- | --- | --- |
| `auth_ip` | client IP (IPv6 /56) | register, login, refresh, change-password, delete account | 30 / 15 min |
| `login_account` | normalized email, failures only | login | 10 / 15 min |
| `api` | user id | all authenticated routes | 300 / min |
| `search` | user id | `GET /tasks?search=` | 120 / min |

## Auth

### `GET /auth/csrf`
Issues (or reuses) the CSRF cookie. Returns `200 { data: { csrfToken } }`.

### `POST /auth/register`
Body: `{ name (1–80), email, password (10–128, must include a letter and a digit) }`. Unknown fields are rejected.
Returns `201 { data: { user } }` and sets session cookies. `409 CONFLICT` if the email is taken (case-insensitive).

### `POST /auth/login`
Body: `{ email, password }`. Returns `200 { data: { user } }` and sets cookies. Unknown email and wrong password both return `401` with the same message and similar timing.

### `POST /auth/refresh`
Uses the `tm_rt` cookie and rotates it. Returns `200 { data: { user } }` with new cookies. `401` if the token is missing, unknown, expired or revoked; cookies are cleared in that case. Replaying an already-rotated token more than 10 s after its rotation revokes every session in that family.

### `POST /auth/logout`
Revokes the refresh-token family and clears cookies. Returns `204` (also when already signed out).

### `GET /auth/me` 🔒
Returns `200 { data: { user: { id, name, email, createdAt, updatedAt } } }`.

### `POST /auth/change-password` 🔒
Body: `{ currentPassword, newPassword }` (the new password must differ). Returns `200 { data: { user } }`, revokes all other sessions and issues a fresh one. A wrong current password returns `400` with `details[0].path = "currentPassword"`.

### `DELETE /users/me` 🔒
Body: `{ password }`. Deletes the sessions, all tasks and the user, then clears cookies. Returns `204`; `400` on a wrong password.

## Tasks 🔒

Task object:

```json
{ "id": "6ae3…", "title": "Prepare Q4 report", "description": "", "status": "todo|in_progress|completed",
  "priority": "low|medium|high", "dueDate": "2026-11-02T18:29:59.999Z" | null, "tags": ["work"],
  "completedAt": null, "createdAt": "…", "updatedAt": "…", "version": 0 }
```

### `GET /tasks`

| Param | Type | Notes |
| --- | --- | --- |
| `page` | int 1–1000 | default 1 |
| `limit` | int 1–100 | default 20 |
| `status` | `todo`·`in_progress`·`completed` | |
| `priority` | `low`·`medium`·`high` | |
| `tag` | slug | exact tag match |
| `search` | string 1–100 | MongoDB text search over title (weight 5) and description; word/stem match |
| `dueAfter`, `dueBefore` | ISO-8601 with offset | inclusive range; `dueAfter ≤ dueBefore` |
| `overdue` | `true` | due before now and not completed |
| `sortBy` | `updatedAt`·`createdAt`·`dueDate`·`priority`·`title` | default `updatedAt` |
| `sortOrder` | `asc`·`desc` | default `desc` |

Unknown parameters, repeated parameters (`status=a&status=b`) and bracket syntax (`status[$ne]=x`) return 400. Sorting is stable (`_id` tie-breaker). Pagination is offset-based (see [limitations](../README.md#known-limitations)).

```
GET /api/v1/tasks?page=1&limit=20&status=in_progress&priority=high&sortBy=updatedAt&sortOrder=desc&search=report
→ 200 { "data": [Task…], "meta": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 } }
```

### `POST /tasks`
Body: `{ title (required, ≤200), description? (≤5000), status? = todo, priority? = medium, dueDate? (ISO-8601, year 2000–2100, or null), tags? (≤10 slugs [a-z0-9-], ≤24 chars, deduplicated) }`.
Ownership, `version`, `completedAt` and timestamps cannot be set (400). Returns `201` with a `Location` header.

### `GET /tasks/:id`
Returns `200 { data: Task }`; `400` for a malformed id; `404` if the task is not found or not owned by the caller.

### `PATCH /tasks/:id`
Body: `{ version (required), …any subset of the create fields }`. At least one field besides `version` is required; `dueDate: null` clears the due date.
Returns `200` with the updated task (`version + 1`). Returns `409 VERSION_CONFLICT` if `version` is stale, so the client should refetch and retry deliberately.

### `PATCH /tasks/:id/status`
Body: `{ status }`. Idempotent, no version needed. `completedAt` is set on the first completion and cleared when the task is reopened.

### `DELETE /tasks/:id`
Returns `204`; `404` if it is already gone or not owned by the caller.

## Dashboard 🔒

### `GET /dashboard/summary`

```json
{ "data": { "counts": { "total": 24, "todo": 13, "inProgress": 5, "completed": 6, "overdue": 3 },
            "completionRate": 25, "recent": [Task×≤5], "upcoming": [Task×≤5, due in the next 7 days],
            "generatedAt": "…" } }
```
Cached per user for 60 s ± 10 % and invalidated on every task write.

## Operations

| Endpoint | Purpose |
| --- | --- |
| `GET /health/live` | 200 while the process serves HTTP (no dependency checks) |
| `GET /health/ready` | 200 `ready`/`degraded` (Redis down) when MongoDB answers a ping; 503 `not_ready`/`draining`. The ping result is cached for 1 s. |
| `GET /metrics` | Prometheus exposition. Requires `Authorization: Bearer $METRICS_TOKEN`; in production without a token it returns 404. |

## Implementation notes vs. the suggested contract

- `POST /auth/forgot-password` and `/reset-password` are **not implemented** (no email provider); see the assessment decisions.
- `GET /auth/csrf` and `DELETE /users/me` were added beyond the suggested list.
- No OpenAPI file is generated. The Zod schemas in `packages/contracts` are the executable contract, and this document mirrors them.
