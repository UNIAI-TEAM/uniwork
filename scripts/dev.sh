#!/usr/bin/env bash
# One command from a fresh clone to a running app: prerequisites, env file
# (worktree-aware), dependencies, database, migrations, then both services.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

missing=()
command -v node >/dev/null 2>&1 || missing+=("node")
command -v pnpm >/dev/null 2>&1 || missing+=("pnpm")
command -v go >/dev/null 2>&1 || missing+=("go")
command -v docker >/dev/null 2>&1 || missing+=("docker")
if [ ${#missing[@]} -gt 0 ]; then
  echo "✗ Missing prerequisites: ${missing[*]}"
  echo "  Install: Node.js 22+, pnpm 10.28+, Go 1.27+, Docker"
  exit 1
fi

# A worktree has a `.git` FILE (pointing at the main repo), not a directory.
if [ -f .git ]; then
  ENV_FILE=".env.worktree"
  if [ ! -f "$ENV_FILE" ]; then
    echo "==> Worktree detected. Generating $ENV_FILE..."
    bash scripts/init-worktree-env.sh "$ENV_FILE"
  fi
else
  ENV_FILE=".env"
  if [ ! -f "$ENV_FILE" ]; then
    echo "==> Creating $ENV_FILE from .env.example..."
    cp .env.example "$ENV_FILE"
  fi
fi
echo "==> Using $ENV_FILE"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# shellcheck disable=SC1091
. scripts/local-env.sh

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies..."
  pnpm install
fi

bash scripts/ensure-postgres.sh "$ENV_FILE"

echo "==> Running migrations..."
(cd server && go run ./cmd/migrate up)

echo ""
echo "✓ Ready. Starting services..."
echo "  Backend:  http://localhost:${PORT}"
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo ""

trap 'kill 0' EXIT
(cd server && go run ./cmd/server) &
pnpm --filter @uniwork/web dev &
wait
