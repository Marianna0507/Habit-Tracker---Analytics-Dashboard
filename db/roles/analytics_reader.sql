-- Read-only role for the Python analytics service.
-- Run manually (see analytics/README.md) — not part of schema.sql because
-- the password shouldn't live in a file that gets re-run casually.
CREATE ROLE analytics_reader WITH LOGIN PASSWORD 'replace-with-the-role-password';

GRANT CONNECT ON DATABASE habit_tracker TO analytics_reader;
GRANT USAGE ON SCHEMA public TO analytics_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_reader;

-- So the role also gets SELECT on any table created later (e.g. future
-- schema changes), without having to re-run this grant by hand.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analytics_reader;
