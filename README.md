# Habit Tracker + Analytics Dashboard

Postgres + Node CRUD backend with JWT auth, a plain HTML/JS frontend, and a
standalone Python analytics service.

## Layout

- `src/` — Express API (habits, checkins, auth)
- `public/` — plain HTML/CSS/JS frontend, served by the Express app
- `analytics/` — standalone FastAPI service for stats (streak, completion
  rate); not wired into the Node app yet, see `analytics/README.md`
- `db/` — schema and role setup SQL

## Stack

- Postgres 16 (Docker)
- Node.js + Express, `pg` (raw SQL, no ORM), `jsonwebtoken` + `bcryptjs` for auth
- Python + FastAPI for analytics, connecting via a read-only DB role

## Setup

1. Start Postgres:

   ```
   docker compose up -d
   ```

   This runs Postgres in a container named `habit_tracker_db`, exposed on
   `localhost:5433` (5432 was already taken locally, so the host port was
   remapped — see `docker-compose.yml`).

2. Copy `.env.example` to `.env` and set a real `JWT_SECRET`:

   ```
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Paste the generated string in as `JWT_SECRET`. `JWT_EXPIRES_IN` controls
   how long a login token stays valid (e.g. `7d`).

3. Apply the schema:

   ```
   docker exec -i habit_tracker_db psql -U habit_user -d habit_tracker < db/schema.sql
   ```

   Note: `db/schema.sql` also contains a streak-calculation query at the
   bottom (uses a bare `$1` placeholder). It's not part of table setup — it's
   duplicated in `db/queries/streak.sql` for later use in the app. If you
   pipe the whole `schema.sql` file into `psql`, that trailing query will
   error out; the `CREATE TABLE`/`CREATE INDEX` statements above it will
   still have succeeded.

4. Install dependencies:

   ```
   npm install
   ```

5. Run the API:

   ```
   npm run dev    # nodemon, auto-restart
   npm start      # plain node
   ```

   Server listens on `http://localhost:3000` (configurable via `PORT` in `.env`).

## Schema

- `users(id, email, password_hash, created_at)`
- `habits(id, user_id, name, frequency, created_at, archived)`
- `checkins(id, habit_id, checkin_date, created_at)` — `UNIQUE(habit_id, checkin_date)`
  prevents double check-ins on the same day.

## API

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
| GET    | `/habits/:id/stats`      | Yes   | —                                          | Proxies the Python analytics service; `current_streak`, `completion_rate`, weekly `history`. 502 if that service is unreachable |
| GET    | `/habits/:id/export`     | Yes   | —                                          | Streams a CSV of checkin dates from the Python service |

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

curl localhost:3000/habits/1/checkins -H "Authorization: Bearer $TOKEN"
```

## Known gotcha (fixed)

`pg` parses Postgres `DATE` columns into JS `Date` objects using the local
timezone, and `res.json()` serializes them with `toISOString()` (UTC) — for
any positive UTC offset this silently shifts a calendar date back by one day.
Fixed in `src/db.js` via a custom type parser that returns `DATE` columns as
plain `YYYY-MM-DD` strings instead.

## Not yet built

- Auth on the analytics service itself (acceptable for now: it's only
  reachable through Node's `/habits/:id/stats` and `/habits/:id/export`,
  which already require a valid JWT and check habit ownership; it's also
  read-only against a read-only DB role and not exposed publicly)
