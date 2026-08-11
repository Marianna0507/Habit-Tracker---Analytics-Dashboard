# Habit Tracker + Analytics Dashboard

Postgres-backed habit tracker: a Node/Express API with JWT auth, a plain
HTML/JS frontend, and a standalone Python/FastAPI analytics service —
three independently-runnable pieces that talk to each other.

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

**Why two backend services instead of one?** 
A bug in the analytics code cannot corrupt data, even in principle. Node never talks to Postgres
on the Python service's behalf, and Python never touches `/auth` or writes
any data — it physically can't, since it connects as `analytics_reader`, a
Postgres role with `SELECT`-only grants (see `db/roles/analytics_reader.sql`).

**Why does Node proxy the analytics endpoints instead of the frontend
calling Python directly?** 
Two reasons: 
1. auth and habit-ownership only need to be checked in one place (Node already verifies the JWT and that the habit belongs to the caller before proxying)
2. the analytics service itself has no auth of its own — it's only safe to expose because the only
thing that can reach it over the network is Node (and, in Docker, only
other containers on the same internal network can resolve `analytics:8000`
at all).

## Layout

- `src/` — Express API (habits, checkins, calendar, auth, proxying to analytics)
- `public/` — plain HTML/CSS/JS frontend (Chart.js via CDN), served by the
  Express app itself via `express.static` — no separate frontend server/build
- `analytics/` — standalone FastAPI service: streak, completion rate,
  8-week history, CSV export
- `db/` — `schema.sql`, the read-only role setup, and a reference query
- `docker-compose.yml`, `Dockerfile`, `analytics/Dockerfile` — run all three
  services together in containers
- `render.yaml` — Render Blueprint for deployment (see [Deployment](#deployment) below)

## Setup

Two ways to run this locally. Docker is simpler and closer to how it'd
actually be deployed; running natively is faster to iterate on (no rebuild
per change).

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
   Runs standalone on `:8000`. It has no auth of its own — see
   [Not yet built](#not-yet-built).

## Schema

- `users(id, email, password_hash, created_at)`
- `habits(id, user_id, name, frequency, created_at, archived)` — `frequency`
  is `daily` or `weekly`
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
| GET    | `/habits/calendar`       | Yes   | — (`?month=YYYY-MM`, defaults to current) | Every habit's checked-in days for one month, in a single query — see below |
| POST   | `/habits`                | Yes   | `{ name, frequency? }`                     | `frequency` defaults to `daily` |
| POST   | `/habits/:id/checkin`    | Yes   | `{ checkin_date? }` (must be today, or omitted) | 404 if the habit doesn't exist *or* isn't yours; 400 if `checkin_date` isn't today; 409 on duplicate — see below |
| GET    | `/habits/:id/checkins`   | Yes   | —                                          | Same 404 rule; newest first |
| GET    | `/habits/:id/stats`      | Yes   | —                                          | Proxies the analytics service: `current_streak`, `completion_rate`, weekly `history`. See below |
| GET    | `/habits/:id/export`     | Yes   | —                                          | Streams a CSV of checkin dates from the analytics service |
| DELETE | `/habits/:id`            | Yes   | —                                          | Deletes the habit and its checkins (cascade); 204, or 404 if not found/not yours |

### Check-in rules

Check-ins are for **today only** — no backfilling missed days, no
pre-logging future ones. Passing a `checkin_date` that isn't today gets a
400 rather than silently being coerced to today.

`weekly` habits are satisfied by one check-in per ISO week (Monday–Sunday):
a second check-in attempt in the same week gets a 409, even for a
different day. `daily` habits just use the `UNIQUE(habit_id, checkin_date)`
constraint (409 on a duplicate same-day check-in).

### `GET /habits/calendar`

Returns, for every habit, which days of the given month have a check-in —
built for the monthly grid view in the frontend:

```json
{
  "month": "2026-08",
  "days_in_month": 31,
  "today": 11,
  "habits": [
    { "id": 1, "name": "Drink water", "frequency": "daily", "checked_days": [1, 2, 5, 11] }
  ]
}
```

`today` is only non-null when `month` is the actual current month. One
query covers all of the caller's habits (no N+1 per-habit fetch).

### `GET /habits/:id/stats`

Proxies `analytics/main.py`, which computes:

- **`current_streak`** — consecutive days of check-ins ending today. If
  today has no check-in yet but yesterday does, the streak still counts
  (today isn't "missed" until the day is over) — but a run from further in
  the past does **not** carry forward once a day is skipped; it resets to 0.
  Computed in Python (fetch all check-in dates, walk backward from today)
  rather than in SQL — `db/queries/streak.sql` is kept only as a reference;
  it reports the length of whichever consecutive run is most recent, even
  if it ended weeks ago, so it isn't actually "current."
- **`completion_rate`** — fraction of elapsed periods since the habit was
  created that have a check-in. For `daily`, a period is a day; for
  `weekly`, a period is an ISO week (any check-in that week counts).
- **`history`** — completion rate per ISO week for the last 8 weeks, oldest
  first, for the chart in the stats panel. Weeks before the habit existed
  are skipped; partial weeks (the creation week, and the current
  in-progress week) divide by elapsed days rather than a flat 7, so they
  aren't unfairly penalized.

### If the analytics service is down or slow

`/habits/:id/stats` and `/habits/:id/export` call the Python service with a
5-second timeout (`AbortSignal.timeout`, see `fetchAnalytics()` in
`src/routes/habits.js`):

- Unreachable/connection refused → `502`
- Didn't respond within 5s → `504`
- Either way, Node's own request handling doesn't hang waiting on it, and
  the rest of the app (habit list, calendar, check-ins, delete) is
  unaffected — only the stats panel in the frontend shows an inline error.

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

curl "localhost:3000/habits/calendar?month=2026-08" -H "Authorization: Bearer $TOKEN"
```

## Frontend

Single-page vanilla JS app (`public/`), no build step:

- **Habit list** — add a habit, check in, view a stats panel (streak,
  completion rate, an 8-week Chart.js line chart) and export CSV, delete.
- **Monthly calendar grid** — every habit as a row, every day of the month
  as a column, with prev/next navigation. A cell is checked (✓), missed
  (past and unchecked), today (clickable to check in from the grid), or
  future. For `weekly` habits, once one day in a Mon–Sun week is checked
  the rest of that week renders as "not needed" rather than "missed."
- The export button uses `fetch` + `Blob` + object URL instead of a plain
  `<a href>` download link, because a plain link can't send the
  `Authorization` header the endpoint requires.
- `pg` parses Postgres `DATE` columns into JS `Date` objects using the
  local timezone; naively re-serializing with `toISOString()` would shift
  a calendar date by a day for positive UTC offsets. `src/db.js` installs a
  custom type parser so `DATE` columns come back as plain `YYYY-MM-DD`
  strings instead, and the calendar's week-bounding logic
  (`isoWeekBounds()` in `src/routes/habits.js`, mirrored in
  `weekKeyForDay()` in `public/script.js`) is computed in UTC on both ends
  to keep client and server agreeing on which week a day falls in.

## Deployment

`render.yaml` is a Render Blueprint that provisions all three pieces
(managed Postgres, the Node API, and the analytics service) together. It's
written against Render's documented Blueprint spec but has **not been
deployed or tested against a live Render account** — verify field names in
Render's dashboard before trusting it. One step it can't automate: Render's
managed Postgres only exposes the admin connection string via
`fromDatabase`, so the read-only `analytics_reader` role (and its
`DATABASE_URL`, set with `sync: false` in `render.yaml`) has to be created
and wired up manually after the database is provisioned — see the comments
in `render.yaml` and `db/roles/analytics_reader.sql`.

Before pushing this repo anywhere public: `db/roles/analytics_reader.sql`
has a hardcoded password that's fine for local dev only — replace it for
any real deployment.

## Not yet built

- Auth on the analytics service itself (acceptable for now: it's only
  reachable through Node's `/habits/:id/stats` and `/habits/:id/export`,
  which already require a valid JWT and check habit ownership; in Docker
  it's also only reachable from other containers on the same network, not
  the host or the internet)
- An actual live deployment (Blueprint is ready, see [Deployment](#deployment))
