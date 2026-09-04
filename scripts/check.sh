#!/usr/bin/env bash
# Full verification pipeline: typecheck → unit tests → Go tests → E2E.
# Starts backend/frontend only if nothing is listening on their ports, and
# stops only what it started — a dev stack that was already running is left
# exactly as it was.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="${ENV_FILE:-.env}"
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
. scripts/local-env.sh

BACKEND_PID=""
FRONTEND_PID=""
STARTED_BACKEND=false
STARTED_FRONTEND=false
EXIT_CODE=0

cleanup() {
  # `set -e` exits with the failing command's status but never touches
  # EXIT_CODE, so a failed ensure-postgres used to end in "All checks passed".
  local rc=$?
  [ "$rc" -ne 0 ] && EXIT_CODE=$rc
  echo ""
  if [ "$STARTED_BACKEND" = true ] && [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null && wait "$BACKEND_PID" 2>/dev/null || true
    echo "    Stopped backend (PID $BACKEND_PID)"
  fi
  if [ "$STARTED_FRONTEND" = true ] && [ -n "$FRONTEND_PID" ]; then
    # pnpm exits on SIGTERM but leaves `next dev` on the port, and `wait`
    # then never returns. Kill whatever still listens, like `make stop`.
    kill "$FRONTEND_PID" 2>/dev/null || true
    lsof -ti:"$FRONTEND_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    echo "    Stopped frontend (PID $FRONTEND_PID)"
  fi
  echo ""
  if [ "$EXIT_CODE" -eq 0 ]; then echo "✓ All checks passed."; else echo "✗ Checks FAILED."; fi
  exit "$EXIT_CODE"
}
trap cleanup EXIT

wait_for_port() {
  local port=$1 name=$2 max_wait=${3:-60} path=${4:-/}
  local elapsed=0
  echo "    Waiting for $name on :$port..."
  while ! curl -sf "http://localhost:${port}${path}" > /dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$max_wait" ]; then
      echo "    ERROR: $name did not start within ${max_wait}s"
      EXIT_CODE=1
      exit 1
    fi
  done
  echo "    $name ready (${elapsed}s)"
}

echo "==> Using env file: $ENV_FILE"
echo "==> Checking PostgreSQL..."
bash scripts/ensure-postgres.sh "$ENV_FILE"

echo ""; echo "==> [1/6] TypeScript typecheck..."
pnpm typecheck || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [2/6] Lint (package boundaries are lint errors)..."
pnpm lint || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [2b/6] Unused exports, files, dependencies (knip)..."
pnpm knip || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [3/6] TypeScript unit tests + repo contract tests..."
pnpm test || { EXIT_CODE=1; exit 1; }
node --test scripts/catalog-check.test.mjs scripts/no-usf-leak.test.mjs scripts/no-legacy-tokens.test.mjs scripts/governance.test.mjs scripts/brand-assets.test.mjs || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [4/6] Go tests..."
(cd server && go run ./cmd/migrate up) || { EXIT_CODE=1; exit 1; }
bash scripts/test-go.sh --race || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [5/6] Starting services for E2E (only if not already running)..."
check_log_dir="${UNIWORK_CHECK_LOG_DIR:-${REPO_ROOT}/.go-tmp}"
mkdir -p "$check_log_dir"
if curl -sf "http://localhost:${PORT}/healthz" > /dev/null 2>&1; then
  echo "    Backend already running on :$PORT"
else
  echo "    Starting backend..."
  # Build first and run the binary directly. `go run` would make $! the
  # parent process; killing it leaves the server orphaned on its port, and
  # the next run then tests stale code against "already running".
  (cd server && go build -o bin/check-server ./cmd/server) || { EXIT_CODE=1; exit 1; }
  server/bin/check-server > "$check_log_dir/uniwork-check-backend.log" 2>&1 &
  BACKEND_PID=$!
  STARTED_BACKEND=true
  wait_for_port "$PORT" "Backend" 90 "/healthz"
fi
if curl -sf "http://localhost:${FRONTEND_PORT}" > /dev/null 2>&1; then
  echo "    Frontend already running on :$FRONTEND_PORT"
else
  echo "    Starting frontend..."
  pnpm --filter @uniwork/web dev > "$check_log_dir/uniwork-check-frontend.log" 2>&1 &
  FRONTEND_PID=$!
  STARTED_FRONTEND=true
  wait_for_port "$FRONTEND_PORT" "Frontend" 120 "/"
fi

echo ""; echo "==> [6/6] E2E tests (Playwright) against ${E2E_BASE_URL}..."
# E2E registers many accounts from one IP; leftover uw:ratelimit:* keys from dev
# or a prior run in the same minute can 429 the last register (verify dark).
clear_rate_limits() {
  local keys
  if [ -n "${REDIS_URL:-}" ]; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'uniwork-redis-1'; then
      keys=$(docker exec uniwork-redis-1 redis-cli --scan --pattern 'uw:ratelimit:*' 2>/dev/null || true)
      if [ -n "$keys" ]; then
        echo "$keys" | xargs docker exec -i uniwork-redis-1 redis-cli DEL >/dev/null 2>&1 || true
      fi
    elif command -v redis-cli >/dev/null 2>&1; then
      keys=$(redis-cli -u "$REDIS_URL" --scan --pattern 'uw:ratelimit:*' 2>/dev/null || true)
      if [ -n "$keys" ]; then
        echo "$keys" | xargs redis-cli -u "$REDIS_URL" DEL >/dev/null 2>&1 || true
      fi
    fi
  fi
}
clear_rate_limits
pnpm --filter @uniwork/e2e exec playwright install chromium > /dev/null
pnpm --filter @uniwork/e2e test || { EXIT_CODE=1; exit 1; }
