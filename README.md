# Habit Tracker + Analytics Dashboard

Phase 1: Postgres + Node CRUD backend. No auth, no frontend, no analytics yet —
just the database and a tested Express API.

## Stack

- Postgres 16 (Docker)
- Node.js + Express
- `pg` (node-postgres) — raw SQL, no ORM

## Setup

1. Start Postgres:

   ```
   docker compose up -d
   ```

   This runs Postgres in a container named `habit_tracker_db`, exposed on
   `localhost:5433` (5432 was already taken locally, so the host port was
   remapped — see `docker-compose.yml`).

2. Copy `.env.example` to `.env` and adjust if needed:

   ```
   cp .env.example .env
   ```

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

4. Seed a fake user (no auth yet, so this is manual):

   ```
   docker exec habit_tracker_db psql -U habit_user -d habit_tracker \
     -c "INSERT INTO users (email, password_hash) VALUES ('demo@example.com', 'no-auth-yet-placeholder');"
   ```

5. Install dependencies:

   ```
   npm install
   ```

6. Run the API:

   ```
   npm run dev    # nodemon, auto-restart
   npm start      # plain node
   ```

   Server listens on `http://localhost:3000` (configurable via `PORT` in `.env`).

## Schema

- `users(id, email, password_hash, created_at)` — `password_hash` is required
  by the schema even though auth isn't implemented yet; seed a placeholder value.
- `habits(id, user_id, name, frequency, created_at, archived)`
- `checkins(id, habit_id, checkin_date, created_at)` — `UNIQUE(habit_id, checkin_date)`
  prevents double check-ins on the same day.

## API

| Method | Path                     | Body                                  | Notes |
|--------|--------------------------|----------------------------------------|-------|
| GET    | `/habits`                | —                                       | Optional `?user_id=` filter |
| POST   | `/habits`                | `{ user_id, name, frequency? }`         | `frequency` defaults to `daily` |
| POST   | `/habits/:id/checkin`    | `{ checkin_date? }` (defaults to today) | 404 if habit doesn't exist, 409 on duplicate date |
| GET    | `/habits/:id/checkins`   | —                                       | Newest first |

### Example (curl)

```
curl -X POST localhost:3000/habits \
  -H "Content-Type: application/json" \
  -d '{"user_id":1,"name":"Drink water","frequency":"daily"}'

curl -X POST localhost:3000/habits/1/checkin \
  -H "Content-Type: application/json" -d '{}'

curl localhost:3000/habits/1/checkins
```

## Known gotcha (fixed)

`pg` parses Postgres `DATE` columns into JS `Date` objects using the local
timezone, and `res.json()` serializes them with `toISOString()` (UTC) — for
any positive UTC offset this silently shifts a calendar date back by one day.
Fixed in `src/db.js` via a custom type parser that returns `DATE` columns as
plain `YYYY-MM-DD` strings instead.

## Not yet built

- Auth (JWT/session, password hashing)
- Frontend
- Analytics endpoints (streak calculation query is stubbed in `db/queries/streak.sql`)
