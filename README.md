# Habit Tracker + Analytics Dashboard

Postgres + Node CRUD backend with JWT auth, a plain HTML/JS frontend, and a
standalone Python analytics service — three independently-runnable pieces
that talk to each other, built up incrementally (see the commit history for
the week-by-week progression: schema → CRUD → auth → frontend → analytics →
wiring → dockerizing).

## Architecture

```
                    ┌─────────────────────┐
   browser  ──────▶ │   Node / Express     │  serves public/ (HTML/JS/CSS)
  (localhost:3000)  │   src/app.js         │  and the JSON API
                    │                       │
                    │  full read/write      │  Auth: JWT, checked on every
                    │  DB access via the    │  /habits* route. user_id always
                    │  habit_user role      │  comes from the verified token,
                    │                       │  never from the request body.
                    └──────────┬────────────┘
                               │
                    ┌──────────┼────────────┐
                    │          │             │
                    ▼          │             ▼
          ┌──────────────┐    │    ┌──────────────────────┐
          │  Postgres     │◀──┘    │  Python / FastAPI      │
          │  habit_tracker│◀───────│  analytics/main.py     │
          │               │  read-  │  (localhost:8000)      │
          └──────────────┘  only   └───────────┬─────────────┘
                             via                │
                       analytics_reader         │ GET /habits/:id/stats
                       role (SELECT only,       │ GET /habits/:id/export
                       enforced by Postgres,    │ (Node proxies these,
                       not just app code)       │  with a 5s timeout and
                                                 │  502/504 fallback if
                                                 │  this service is down)
```

**Why two backend services instead of one?** This project was built as a
learning exercise, one deliberate step at a time: raw SQL CRUD first, then
auth, then a second language (Python/FastAPI) purely for analytics, kept
separate from the Node API rather than folded in. Node never talks to
Postgres on the Python service's behalf, and Python never touches
`/auth` or writes any data — it physically can't, since it connects as
`analytics_reader`, a Postgres role with `SELECT`-only grants (see
`db/roles/analytics_reader.sql`). A bug in the analytics code cannot corrupt
data, even in principle.

**Why does Node proxy the analytics endpoints instead of the frontend
calling Python directly?** Two reasons: (1) auth and habit-ownership only
need to be checked in one place (Node already verifies the JWT and that the
habit belongs to the caller before proxying), and (2) the analytics service
itself has no auth of its own — it's only safe to expose because the only
thing that can reach it over the network is Node (and, in Docker, only
other containers on the same internal network can resolve `analytics:8000`
at all).

## Layout

- `src/` — Express API (habits, checkins, auth, proxying to analytics)
- `public/` — plain HTML/CSS/JS frontend (Chart.js via CDN), served by the
  Express app itself via `express.static` — no separate frontend server/build
- `analytics/` — standalone FastAPI service: streak, completion rate, weekly
  history, CSV export. See `analytics/README.md` for its own details
- `db/` — `schema.sql`, the read-only role setup, and a reference query
- `docker-compose.yml`, `Dockerfile`, `analytics/Dockerfile` — run all three
  services together in containers
- `render.yaml`, `DEPLOY.md` — deployment prep (unverified — see DEPLOY.md)

## Setup

Two ways to run this locally. Docker is simpler and closer to how it'd
actually be deployed; running natively is faster to iterate on (no rebuild
per change) and is how this was originally developed week-by-week.

### Option A: Docker (all three services)

1. Copy `.env.example` to `.env`, fill in real values for `JWT_SECRET` and
   `ANALYTICS_READER_PASSWORD` (the latter must match whatever password is
   set in `db/roles/analytics_reader.sql` — they're both placeholders by
   default; generate real ones with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
2. `docker compose up -d --build`

   This builds and starts all three containers (`habit_tracker_db`,
   `habit_tracker_api`, `habit_tracker_analytics`) on one internal Docker
   network. On a **fresh** Postgres volume, the schema and the read-only
   role are created automatically via
   `/docker-entrypoint-initdb.d/` (see the `db.volumes` section of
   `docker-compose.yml`) — no manual `psql` step needed. If you already have
   an existing `habit_tracker_data` volume from before this existed, that
   auto-init only runs against an *empty* volume, so nothing changes for you.
3. The app is at `http://localhost:3000`. Postgres is additionally exposed
   on the host at `localhost:5433` (5432 was already taken by an unrelated
   local project) if you want to inspect it directly.

### Option B: Native (Node + Python run directly, faster iteration)

1. Start just Postgres: `docker compose up -d db`
2. Apply the schema and create the read-only role:
   ```
   docker exec -i habit_tracker_db psql -U habit_user -d habit_tracker < db/schema.sql
   docker exec -i habit_tracker_db psql -U habit_user -d habit_tracker < db/roles/analytics_reader.sql
   ```
   (Note: `db/schema.sql` also has a streak-calculation reference query at
   the bottom using a bare `$1` placeholder — not part of table setup, see
   the comment in that file. It errors if you pipe the *whole* file into a
   plain `psql` session, but the `CREATE TABLE`/`CREATE INDEX` statements
   above it will already have succeeded by then.)
3. Node API: copy `.env.example` → `.env`, fill in real secrets, then
   `npm install && npm run dev` (nodemon, auto-restart). Runs on `:3000`.
4. Python analytics: in `analytics/`, copy `.env.example` → `.env`, then
   ```
   python -m venv venv
   venv\Scripts\python.exe -m pip install -r requirements.txt
   venv\Scripts\python.exe -m uvicorn main:app --port 8000 --reload
   ```
   Runs standalone on `:8000` — see `analytics/README.md`.

## Schema

- `users(id, email, password_hash, created_at)`
- `habits(id, user_id, name, frequency, created_at, archived)`
- `checkins(id, habit_id, checkin_date, created_at)` — `UNIQUE(habit_id, checkin_date)`
  prevents double check-ins on the same day.

## API (Node, port 3000)

Auth endpoints are open. Every `/habits*` endpoint requires
`Authorization: Bearer <token>` and only ever operates on the authenticated
user's own habits — there's no way to pass a `user_id` to act as someone else.

| Method | Path                     | Auth? | Body                                    | Notes |
|--------|--------------------------|-------|------------------------------------------|-------|
| POST   | `/auth/register`         | No    | `{ email, password }`                     | Creates the account and returns `{ token, user }` |
| POST   | `/auth/login`            | No    | `{ email, password }`                     | Returns `{ token }` |
| GET    | `/habits`                | Yes   | —                                          | Only the caller's habits; each includes `checked_in_today` |
| POST   | `/habits`                | Yes   | `{ name, frequency? }`                     | `frequency` defaults to `daily` |
| POST   | `/habits/:id/checkin`    | Yes   | `{ checkin_date? }` (defaults to today)    | 404 if the habit doesn't exist *or* isn't yours; 409 on duplicate date |
| GET    | `/habits/:id/checkins`   | Yes   | —                                          | Same 404 rule; newest first |
| GET    | `/habits/:id/stats`      | Yes   | —                                          | Proxies the analytics service: `current_streak`, `completion_rate`, weekly `history`. See below for failure behavior |
| GET    | `/habits/:id/export`     | Yes   | —                                          | Streams a CSV of checkin dates from the analytics service |
| DELETE | `/habits/:id`            | Yes   | —                                          | Deletes the habit and its checkins (cascade); 204, or 404 if not found/not yours |

### If the analytics service is down or slow

`/habits/:id/stats` and `/habits/:id/export` call the Python service with a
5-second timeout (`AbortSignal.timeout`, see `fetchAnalytics()` in
`src/routes/habits.js`):

- Unreachable/connection refused → `502`
- Didn't respond within 5s → `504`
- Either way, Node's own request handling doesn't hang waiting on it, and
  the rest of the app (habit list, check-ins, delete) is unaffected — only
  the stats panel in the frontend shows an inline error.

### Example (curl)

```
TOKEN=$(curl -s -X POST localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"something-long"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -X POST localhost:3000/habits \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Drink water","frequency":"daily"}'

curl -X POST localhost:3000/habits/1/checkin \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{}'

curl localhost:3000/habits/1/stats -H "Authorization: Bearer $TOKEN"
```

## Known gotchas (fixed)

- **Date shifting.** `pg` parses Postgres `DATE` columns into JS `Date`
  objects using the local timezone, and `res.json()` serializes them with
  `toISOString()` (UTC) — for any positive UTC offset this silently shifts a
  calendar date back by one day. Fixed in `src/db.js` via a custom type
  parser that returns `DATE` columns as plain `YYYY-MM-DD` strings instead.
- **"Current streak" that wasn't current.** A pure-SQL streak query (kept as
  a reference in `db/queries/streak.sql`) reports the length of whichever
  consecutive run of check-ins is most recent, even if it ended weeks ago.
  `analytics/main.py` computes it in Python instead (walk backward from
  today) so it actually resets to 0 once a day is missed.
- **CSV download auth.** A plain `<a href>` download link doesn't send the
  `Authorization` header, so it'd just 401 against a protected endpoint.
  The frontend's export button goes through `fetch` (with the header) and
  triggers the download via a `Blob` + object URL instead.

## Deployment

Prepared but not yet actually deployed — see `DEPLOY.md` for a Render
Blueprint (`render.yaml`) and a step-by-step guide, including what can't be
automated (provisioning the read-only DB role on a managed Postgres
instance) and a real secret-hygiene issue worth reading before you push
this repo anywhere public (`db/roles/analytics_reader.sql` has a hardcoded
password that's fine for local dev only).

## Not yet built

- Auth on the analytics service itself (acceptable for now: it's only
  reachable through Node's `/habits/:id/stats` and `/habits/:id/export`,
  which already require a valid JWT and check habit ownership; in Docker
  it's also only reachable from other containers on the same network, not
  the host or the internet)
- An actual live deployment (config is ready, see above)
