#!/usr/bin/env bash
# Make sure the PostgreSQL this checkout points at is reachable and that its
# database (and the matching *_test database Go tests use) exist.
#
# Local (localhost DATABASE_URL): starts the shared `postgres` compose service
# and creates the databases inside it. Every checkout and worktree shares that
# one container and gets its own database — see init-worktree-env.sh.
# Remote: skips Docker and only waits for connectivity.
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create .env from .env.example, or run 'make worktree-env' and use .env.worktree."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# shellcheck disable=SC1091
. "$(dirname "$0")/local-env.sh"

export PGPASSWORD="$POSTGRES_PASSWORD"

db_host=""
db_port="$POSTGRES_PORT"
db_name="$POSTGRES_DB"

parse_database_url() {
  local rest authority hostport path port_part
  rest="${DATABASE_URL#*://}"
  rest="${rest%%\?*}"
  authority="${rest%%/*}"
  path="${rest#*/}"
  if [ "$authority" = "$rest" ]; then path=""; fi
  hostport="${authority##*@}"
  if [[ "$hostport" == \[* ]]; then
    db_host="${hostport#\[}"; db_host="${db_host%%]*}"
    port_part="${hostport#*\]}"
    if [[ "$port_part" == :* ]] && [ -n "${port_part#:}" ]; then db_port="${port_part#:}"; fi
  else
    db_host="${hostport%%:*}"
    if [[ "$hostport" == *:* ]] && [ -n "${hostport##*:}" ]; then db_port="${hostport##*:}"; fi
  fi
  if [ -n "$path" ]; then db_name="${path%%/*}"; fi
}
parse_database_url

is_local() {
  [ "$db_host" = "localhost" ] || [ "$db_host" = "127.0.0.1" ] || [ "$db_host" = "::1" ]
}

ensure_db() {
  local name=$1
  local exists
  exists="$(docker compose exec -T postgres \
    psql -U "$POSTGRES_USER" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$name'")"
  if [ "$exists" != "1" ]; then
    docker compose exec -T postgres \
      psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$name\"" > /dev/null
    echo "    created database '$name'"
  fi
}

if is_local; then
  echo "==> Ensuring the shared PostgreSQL container is running on localhost:${db_port}..."
  docker compose up -d postgres redis
  echo "==> Waiting for PostgreSQL to be ready..."
  until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres > /dev/null 2>&1; do
    sleep 1
  done
  echo "==> Ensuring databases exist..."
  ensure_db "$db_name"
  ensure_db "${db_name}_test"
  echo "✓ PostgreSQL ready (local Docker). Database: $db_name (tests: ${db_name}_test)"
else
  echo "==> Remote database detected (host: $db_host). Skipping Docker."
  if command -v pg_isready > /dev/null 2>&1; then
    until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do sleep 1; done
    echo "✓ PostgreSQL ready (remote: $db_host:$db_port). Database: $db_name"
  else
    echo "✓ PostgreSQL configured (remote: $db_host:$db_port). pg_isready not found — skipped the preflight."
  fi
fi
