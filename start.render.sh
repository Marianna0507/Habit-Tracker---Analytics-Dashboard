#!/bin/sh
# Starts both processes for the combined Render deployment (see
# Dockerfile.render for why). The analytics service gets its own
# DATABASE_URL (the read-only analytics_reader role, passed in as
# ANALYTICS_DATABASE_URL) so it never sees the admin one Node uses -
# same privilege separation as the two-container setup, just within one
# container instead of across Render's private network.
set -e

DATABASE_URL="$ANALYTICS_DATABASE_URL" \
  python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir ./analytics &

exec node src/app.js
