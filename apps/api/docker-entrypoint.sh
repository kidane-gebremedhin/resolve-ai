#!/bin/sh
# Container entrypoint for the API image.
#
# Runs database migrations BEFORE starting the server, so every deploy/restart
# brings the schema (indexes + data migrations) up to date automatically. The
# migrate step is idempotent — index sync is a no-op when nothing drifted, and
# data migrations are gated by the SchemaMigration ledger.
#
# `set -e` means a failed migration aborts the container (non-zero exit) instead
# of starting the server against an un-migrated database — that fails the deploy,
# which is what we want. Set SKIP_DB_MIGRATE=1 to bypass (e.g. to start the server
# while running a problematic migration by hand).
set -e

if [ "$SKIP_DB_MIGRATE" = "1" ]; then
  echo "[entrypoint] SKIP_DB_MIGRATE=1 — skipping database migrations"
else
  echo "[entrypoint] running database migrations…"
  node dist/scripts/migrate.js
fi

echo "[entrypoint] starting API server…"
# exec so node becomes PID 1 and receives SIGTERM/SIGINT for graceful shutdown.
exec node dist/index.js
