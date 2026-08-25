#!/usr/bin/env bash
# Full verification pipeline: typecheck → unit tests → Go tests → E2E.
# Starts backend/frontend only if nothing is listening on their ports, and
# stops only what it started — a dev stack that was already running is left
# exactly as it was.
set -euo pipefail

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
  echo ""
  if [ "$STARTED_BACKEND" = true ] && [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null && wait "$BACKEND_PID" 2>/dev/null || true
    echo "    Stopped backend (PID $BACKEND_PID)"
  fi
  if [ "$STARTED_FRONTEND" = true ] && [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null && wait "$FRONTEND_PID" 2>/dev/null || true
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

echo ""; echo "==> [3/6] TypeScript unit tests + repo contract tests..."
pnpm test || { EXIT_CODE=1; exit 1; }
node --test scripts/catalog-check.test.mjs scripts/no-usf-leak.test.mjs scripts/no-legacy-tokens.test.mjs || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [4/6] Go tests..."
(cd server && go run ./cmd/migrate up) || { EXIT_CODE=1; exit 1; }
bash scripts/test-go.sh --race || { EXIT_CODE=1; exit 1; }

echo ""; echo "==> [5/6] Starting services for E2E (only if not already running)..."
if curl -sf "http://localhost:${PORT}/healthz" > /dev/null 2>&1; then
  echo "    Backend already running on :$PORT"
else
  echo "    Starting backend..."
  (cd server && go run ./cmd/server) > /tmp/uniwork-check-backend.log 2>&1 &
  BACKEND_PID=$!
  STARTED_BACKEND=true
  wait_for_port "$PORT" "Backend" 90 "/healthz"
fi
if curl -sf "http://localhost:${FRONTEND_PORT}" > /dev/null 2>&1; then
  echo "    Frontend already running on :$FRONTEND_PORT"
else
  echo "    Starting frontend..."
  pnpm --filter @uniwork/web dev > /tmp/uniwork-check-frontend.log 2>&1 &
  FRONTEND_PID=$!
  STARTED_FRONTEND=true
  wait_for_port "$FRONTEND_PORT" "Frontend" 120 "/"
fi

echo ""; echo "==> [6/6] E2E tests (Playwright) against ${E2E_BASE_URL}..."
pnpm --filter @uniwork/e2e exec playwright install chromium > /dev/null
pnpm --filter @uniwork/e2e test || { EXIT_CODE=1; exit 1; }
