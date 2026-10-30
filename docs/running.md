# Running Taskflow

There are two ways to run the app:

- **Option A: Node.js on your machine.** Best for development, with hot reload. Needs MongoDB and Redis.
- **Option B: Docker Compose.** One command starts everything. Needs Docker only.

Both end with you signed in as the demo user.

---

## Prerequisites

| Tool | Version | Needed for | Check |
| --- | --- | --- | --- |
| Node.js | ≥ 22.12 | Option A, tests | `node -v` |
| npm | ≥ 10 | Option A, tests | `npm -v` |
| MongoDB | ≥ 7 | Option A | `mongod --version` |
| Redis | ≥ 7 (optional) | Option A | `redis-server --version` |
| Docker + Compose v2 | recent | Option B | `docker compose version` |
| k6 | any recent | load tests only | `k6 version` |

Installing MongoDB and Redis:

- **macOS (Homebrew):**
  ```bash
  brew tap mongodb/brew && brew install mongodb-community redis
  brew services start mongodb-community
  brew services start redis
  ```
- **Ubuntu/Debian:** follow the official MongoDB guide (https://www.mongodb.com/docs/manual/administration/install-on-linux/), then:
  ```bash
  sudo apt install redis-server
  sudo systemctl start mongod redis-server
  ```
- **Any OS, with Docker installed:** start only the databases from this repo with `docker compose up -d mongo redis`. They listen on `127.0.0.1:27017` and `127.0.0.1:6379`.

Redis is optional. Without it the API still works, but logs a warning: rate limits apply per process and the dashboard cache is off.

---

## Option A: run with Node.js

### 1. Install dependencies

```bash
cd taskflow            # repository root
npm ci
```

npm 11 may warn about install scripts. `argon2` and `esbuild` are already approved in `package.json` (`allowScripts`), so you can ignore the warning.

### 2. Configure environment

```bash
cp .env.example .env
```

Replace the two placeholder secrets with random values. This one-liner does it:

```bash
node -e "const c=require('crypto'),f=require('fs');let s=f.readFileSync('.env','utf8');for(const k of ['ACCESS_TOKEN_SECRET','COOKIE_SECRET'])s=s.replace(new RegExp('^'+k+'=.*','m'),k+'='+c.randomBytes(48).toString('base64url'));f.writeFileSync('.env',s)"
```

The defaults in `.env.example` already point at local MongoDB (`mongodb://127.0.0.1:27017/taskmanager`) and Redis (`redis://127.0.0.1:6379`). If yours run elsewhere, edit `MONGODB_URI` / `REDIS_URL`. To run without Redis, leave `REDIS_URL=` empty.

`.env` is gitignored. Never commit it.

### 3. Seed demo data

```bash
npm run seed
```

This creates the indexes and a demo account with 24 realistic tasks:

```
demo@taskmanager.dev / DemoPassword2026
```

Re-running is safe. It only resets the demo account (and `loadtest-*` accounts) and never touches other users.

### 4. Start the API and the web app (two terminals)

```bash
# terminal 1
npm run dev:api        # API on http://localhost:4000, restarts on file changes

# terminal 2
npm run dev:web        # web app on http://localhost:5173, proxies /api to :4000
```

### 5. Open the app

Go to **http://localhost:5173** and sign in. In development builds the sign-in page has a **"fill demo credentials"** link. You can also create your own account with **Create an account**.

### 6. Check it is healthy (optional)

```bash
curl http://localhost:4000/health/live    # {"status":"ok"}
curl http://localhost:4000/health/ready   # {"status":"ready","checks":{"mongo":"up","redis":"up"}}
```

`ready` with `redis: "down"` reads as `"degraded"`. That is fine for development.

### Stop

Press `Ctrl+C` in both terminals. If you used `brew services`, MongoDB and Redis keep running until you stop them with `brew services stop mongodb-community redis`.

---

## Option B: run with Docker Compose

```bash
cp .env.example .env
# set ACCESS_TOKEN_SECRET and COOKIE_SECRET (use the one-liner from Option A, step 2)

docker compose up --build -d                     # builds images, starts mongo, redis, api, web
docker compose ps                                # wait until api and web show "healthy"
docker compose run --rm api node dist/seed.js    # demo data
```

Open **http://localhost:8080** and sign in with `demo@taskmanager.dev` / `DemoPassword2026`.

| Service | URL / port | Notes |
| --- | --- | --- |
| web (nginx + SPA, proxies `/api`) | http://localhost:8080 | change with `WEB_PORT=…` |
| api | http://127.0.0.1:4000 | loopback only |
| mongo (single-node replica set) | 127.0.0.1:27017 | change with `MONGO_PORT=…` |
| redis | 127.0.0.1:6379 | change with `REDIS_PORT=…` |

If a local MongoDB or Redis already uses those ports:

```bash
MONGO_PORT=27018 REDIS_PORT=6380 docker compose up --build -d
```

**Optional monitoring stack:**

```bash
docker compose --profile monitoring up -d
# Prometheus http://localhost:9090   Grafana http://localhost:3000 (dashboard "Task API")
```

**Logs, stop, reset:**

```bash
docker compose logs -f api        # follow API logs
docker compose down               # stop (data volumes kept)
docker compose down -v            # stop AND delete all data (irreversible)
```

---

## Production-like run (built bundle)

```bash
npm run build                                    # apps/api/dist and apps/web/dist
cd apps/api && node --env-file=../../.env dist/server.js
# serve apps/web/dist with any static server that proxies /api to :4000
# (see infrastructure/docker/nginx.conf), e.g.:
cd ../web && npx vite preview                    # http://localhost:4173, proxies /api
```

With `NODE_ENV=production` the API refuses insecure settings: `WEB_ORIGIN` must use https, cookies must be `Secure`, and secrets must be real and distinct. Use this mode behind TLS. For local work, keep `NODE_ENV=development`.

---

## Running the tests

All test commands run from the repository root.

| Command | Needs | What it runs |
| --- | --- | --- |
| `npm run test:unit` | nothing | Contract, API and web unit tests |
| `npm run test:integration` | MongoDB (+ Redis for cache tests) | API against a real database (throwaway DB per file) |
| `npm test` | MongoDB | unit + integration |
| `npm run test:e2e` | MongoDB, Chromium | Playwright; starts its own API on :4100 and web on :5174 |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | nothing | Static checks |

Before the first E2E run, install the browser:

```bash
cd apps/web && npx playwright install chromium && cd ../..
```

To point tests at another server:

```bash
MONGODB_URI_TEST=mongodb://host:27017 REDIS_URL_TEST=redis://host:6379 npm run test:integration
E2E_MONGODB_URI=mongodb://host:27017/taskmanager_e2e npm run test:e2e
```

---

## Load testing (optional)

```bash
npm run seed -- --loadtest 200     # 200 isolated load-test accounts (~36k tasks)
```

Start the API with raised limits. The normal limits correctly block generated traffic:

```bash
RATE_LIMIT_MAX=10000000 AUTH_RATE_LIMIT_MAX=100000 LOGIN_ACCOUNT_RATE_LIMIT_MAX=100000 \
SEARCH_RATE_LIMIT_MAX=10000000 npm run dev:api
```

Then, in another terminal:

```bash
npm run load:smoke                                                        # quick correctness check
k6 run -e SCENARIO=mixed -e RATE=300 -e DURATION=60s scripts/load-test.js
```

Scenarios, options and measured results are in [scalability.md](scalability.md#5-load-test-procedure). Never point load tests at shared or production systems without permission.

---

## Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run seed` / `npm run seed -- --loadtest N` | Demo data / plus N load-test users |
| `npm run db:indexes` (`-- --dry-run`) | Create missing indexes (show the diff only) |
| `npm run db:explain` | Print query plans for every production query |
| `npm run build` | Production bundles |
| `npm run format` | Auto-format with Prettier |

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Invalid environment configuration: ACCESS_TOKEN_SECRET …` | `.env` is missing or still holds short placeholders. Redo Option A, step 2. |
| `/health/ready` → `mongo: down`, API requests → 503 | MongoDB is not running or `MONGODB_URI` is wrong. Start it; the API reconnects automatically. |
| Sign-in works but actions fail with 403 `CSRF_INVALID` | The `tm_csrf` cookie was cleared. Reload the page; the app fetches a new one. |
| Lots of 429 responses | Rate limits are working. Wait for the window or raise `RATE_LIMIT_MAX` locally. |
| `EADDRINUSE :4000` / `:5173` | Another process holds the port. `lsof -ti tcp:4000 \| xargs kill` (macOS/Linux), or change `PORT`. |
| Web app shows "Unable to reach the server" | The API isn't running on :4000. Start `npm run dev:api`. |
| Playwright: "Executable doesn't exist" | `cd apps/web && npx playwright install chromium` |
| Docker: port 27017/6379 already allocated | `MONGO_PORT=27018 REDIS_PORT=6380 docker compose up -d` |
| `npm run seed` hangs or fails to connect | Check MongoDB is reachable at `MONGODB_URI` (`mongosh "$MONGODB_URI"`). |
