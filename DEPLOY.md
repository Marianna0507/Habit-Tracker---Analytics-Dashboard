# Deploying to Render

**Honesty check first:** everything else in this repo has been curl-tested by
running it for real. This file has not — I don't have a Render account or
credentials, so `render.yaml` is written carefully against Render's
documented Blueprint spec but is unverified. If a field name has changed
or a step doesn't match what you see in the dashboard, that's expected —
work from what Render's UI actually shows you, and treat this as a
starting point, not gospel. Render's error messages when a Blueprint field
is wrong are usually clear about what's expected.

## Before you start: a real secret is committed in this repo

`db/roles/analytics_reader.sql` has a hardcoded password in plain text.
That was an acceptable shortcut for local development, but if this repo is
pushed to GitHub for Render to deploy from, **that password is now public**
in your git history. Don't reuse it in production. Generate a fresh one:

```
node -e "console.log(require('crypto').randomBytes(18).toString('base64').replace(/[+/=]/g,''))"
```

You'll use this new password in the manual DB step below - don't commit it
into `db/roles/analytics_reader.sql`; just substitute it when you run the SQL.

## Steps

1. **Push this repo to GitHub** if it isn't already - Render deploys from a
   connected git repo.

2. **New Blueprint** in the Render dashboard → connect the repo → Render
   should detect `render.yaml` at the root and propose three resources:
   `habit-tracker-db` (Postgres), `habit-tracker-api`, `habit-tracker-analytics`.
   Review and apply.

3. **`habit-tracker-analytics` will fail to start** at this point - its
   `DATABASE_URL` is intentionally left blank (`sync: false` in the
   Blueprint) because Render can't provision our custom read-only role
   automatically. That's expected; fix it in the next step.

4. **One-time database setup** - run the schema and create the read-only
   role against Render's Postgres, from your own machine:

   - In the Render dashboard, open `habit-tracker-db` → copy the **External
     Database URL**.
   - Apply the schema:
     ```
     psql "<external-database-url>" -f db/schema.sql
     ```
   - Create the read-only role with your **new** password (not the one
     committed in the repo):
     ```
     psql "<external-database-url>" -c "CREATE ROLE analytics_reader WITH LOGIN PASSWORD '<your-new-password>'; GRANT CONNECT ON DATABASE habit_tracker TO analytics_reader; GRANT USAGE ON SCHEMA public TO analytics_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_reader; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_reader;"
     ```

5. **Set the analytics service's `DATABASE_URL`** in the Render dashboard
   (`habit-tracker-analytics` → Environment): same host/port/database as the
   API's `DATABASE_URL`, but with `analytics_reader` and your new password
   instead of the admin credentials, e.g.
   `postgresql://analytics_reader:<your-new-password>@<same-host>/habit_tracker`.
   Redeploy that service.

6. **`JWT_SECRET`** is handled automatically - the Blueprint uses
   `generateValue: true`, so Render generates a random one at creation time.
   No action needed.

7. **Verify**, using the public URL Render gives `habit-tracker-api`
   (something like `https://habit-tracker-api.onrender.com`):
   ```
   curl https://<your-api-url>/habits
   ```
   should return `401` (no token) rather than erroring/timing out. Then try
   register/login/add-habit/stats the same way you did locally. The
   frontend is served by this same service (it's just `express.static`), so
   visiting that URL in a browser should show the app directly - no
   separate frontend deployment needed.

## If the Blueprint doesn't work

Fall back to creating each service by hand in the Render UI: **New →
PostgreSQL** for the database, then **New → Web Service** twice, pointing
at this repo with **Root Directory** set to `.` (Dockerfile at repo root)
for the API and `analytics` (its own Dockerfile) for the analytics service.
Set the same environment variables described above. The Dockerfiles
themselves (`Dockerfile`, `analytics/Dockerfile`) are the parts that have
actually been tested - they work locally via `docker compose up --build`,
so however the two services get created on Render, those images are solid.

## Free tier caveats

Render's free web services spin down after inactivity - the first request
after idling can take 30-60s while it wakes back up. Free Postgres
instances have historically expired after a fixed period (check Render's
current terms) - fine for a demo/learning deployment, not for anything
you need to stay up indefinitely.
