# Analytics service (Python / FastAPI)

Standalone read-only analytics API. Not wired into the Node app yet —
run and test it on its own.

## Setup

1. Create the read-only database role (once, from the project root):

   ```
   docker exec -i habit_tracker_db psql -U habit_user -d habit_tracker < ../db/roles/analytics_reader.sql
   ```

   This creates `analytics_reader`, a Postgres role with `SELECT`-only
   grants — it cannot `INSERT`/`UPDATE`/`DELETE` even if the Python code
   has a bug. Edit the password in that file before running it if you want
   something other than the placeholder.

2. Create a virtualenv and install dependencies:

   ```
   python -m venv venv
   venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. Copy `.env.example` to `.env` and fill in the `analytics_reader` password:

   ```
   copy .env.example .env
   ```

4. Run it:

   ```
   venv\Scripts\python.exe -m uvicorn main:app --port 8000 --reload
   ```

   `--reload` restarts on file changes, same idea as `nodemon` on the Node side.

## API

| Method | Path                          | Notes |
|--------|-------------------------------|-------|
| GET    | `/analytics/:habit_id/stats`  | 404 if the habit doesn't exist |

Response:

```json
{
  "habit_id": 1,
  "current_streak": 3,
  "completion_rate": 0.75
}
```

- **`current_streak`** — consecutive days of check-ins ending today. If
  today has no check-in yet but yesterday does, the streak still counts
  (today isn't "missed" until it's over) — but a genuinely broken run from
  the past does **not** carry forward, it resets to 0. Computed in Python
  (fetch all check-in dates, walk backward from today) rather than in SQL,
  which is what `db/queries/streak.sql` does — that version reports the
  length of whichever consecutive run happens to be most recent, even if
  it ended weeks ago, so it isn't actually "current."
- **`completion_rate`** — fraction of elapsed periods since the habit was
  created that have a check-in. For a `daily` habit, a period is a day;
  for `weekly`, a period is an ISO week (any check-in that week counts).

## Example (curl)

```
curl http://localhost:8000/analytics/1/stats
```

No auth on this service yet — it's read-only against a read-only DB role,
and not exposed publicly, so it's an acceptable gap for now. Revisit if
this ever needs to be reachable from outside localhost.
