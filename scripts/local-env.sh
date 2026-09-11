# Shared local development env derivation. Source this AFTER loading the env
# file so explicit values win and only the gaps are filled in.

_local_env_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT="${REPO_ROOT:-$(CDPATH= cd -- "$_local_env_dir/.." && pwd)}"

# Windows Git Bash defaults Go scratch space to %LOCALAPPDATA% and
# %TEMP% on C:. When that drive is nearly full, `go build` / `go test`
# fail with "not enough space on the disk" even though the repo is on
# another drive. Redirect scratch dirs into the checkout for repo scripts.
if [ "$(go env GOOS)" = "windows" ] && [ "${UNIWORK_USE_SYSTEM_GO_DIRS:-}" != "1" ]; then
  _go_scratch="${REPO_ROOT}/.go-tmp"
  _go_cache="${REPO_ROOT}/.go-cache"
  mkdir -p "$_go_scratch" "$_go_cache" \
    "$_go_scratch/playwright-browsers" \
    "$_go_scratch/pnpm-store" \
    "$_go_scratch/playwright-output"
  export GOTMPDIR="$_go_scratch"
  export GOCACHE="$_go_cache"
  export TMPDIR="$_go_scratch"
  export TEMP="$_go_scratch"
  export TMP="$_go_scratch"
  # Playwright downloads Chromium to %LOCALAPPDATA% by default; pnpm store
  # defaults to %LOCALAPPDATA%/pnpm on Windows — both land on C:.
  export PLAYWRIGHT_BROWSERS_PATH="$_go_scratch/playwright-browsers"
  export PLAYWRIGHT_OUTPUT_DIR="$_go_scratch/playwright-output"
  export PNPM_STORE_DIR="$_go_scratch/pnpm-store"
fi

POSTGRES_DB="${POSTGRES_DB:-uniwork}"
POSTGRES_USER="${POSTGRES_USER:-uniwork}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-uniwork}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"

DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable}"
# Go tests truncate every table, so they get their own database on the same
# server as DATABASE_URL. Always derive the URL: a stale TEST_DATABASE_URL in
# .env (e.g. port 5433 from the optional postgres-test service) makes testutil
# skip the whole suite when ensure-postgres only starts postgres on POSTGRES_PORT.
_db_host=localhost
if [[ "${DATABASE_URL}" =~ @([^:/]+) ]]; then
  _db_host="${BASH_REMATCH[1]}"
fi
_test_db="${POSTGRES_DB}_test"
TEST_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${_db_host}:${POSTGRES_PORT}/${_test_db}?sslmode=disable"
REDIS_TEST_URL="${REDIS_TEST_URL:-redis://localhost:6379/15}"

NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${PORT}}"
NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-ws://localhost:${PORT}}"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${FRONTEND_ORIGIN}}"
LOCAL_UPLOAD_BASE_URL="${LOCAL_UPLOAD_BASE_URL:-http://localhost:${PORT}}"
E2E_BASE_URL="${E2E_BASE_URL:-${FRONTEND_ORIGIN}}"
# Keep the browser and the server on the same dev code unless overridden.
E2E_VERIFICATION_CODE="${E2E_VERIFICATION_CODE:-${DEV_VERIFICATION_CODE:-123456}}"

export REPO_ROOT
if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then export PLAYWRIGHT_BROWSERS_PATH; fi
if [ -n "${PLAYWRIGHT_OUTPUT_DIR:-}" ]; then export PLAYWRIGHT_OUTPUT_DIR; fi
if [ -n "${PNPM_STORE_DIR:-}" ]; then export PNPM_STORE_DIR; fi
export POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_PORT
export PORT FRONTEND_PORT FRONTEND_ORIGIN
export DATABASE_URL TEST_DATABASE_URL REDIS_TEST_URL
export NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL NEXT_PUBLIC_APP_URL LOCAL_UPLOAD_BASE_URL E2E_BASE_URL E2E_VERIFICATION_CODE
