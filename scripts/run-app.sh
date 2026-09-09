#!/usr/bin/env bash
# Foreground processes for local development: API, Next.js, and LiveKit logs.
# Call after ensure-postgres, ensure-livekit, and migrations.
set -euo pipefail

ENV_FILE="${1:-.env}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# shellcheck disable=SC1091
. "$(dirname "$0")/local-env.sh"

# Defaults written by ensure-livekit.sh when using the local container.
if [ -f .livekit.env.local ]; then
  # shellcheck disable=SC1091
  . ./.livekit.env.local
fi

echo "Backend:  http://localhost:${PORT}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
if [ "${ENABLE_SWAGGER:-}" = "true" ] || [ "${ENABLE_SWAGGER:-}" = "1" ] || [ "${ENABLE_SWAGGER:-}" = "yes" ]; then
  echo "Swagger:  http://localhost:${PORT}/swagger/index.html"
fi
if [ -n "${LIVEKIT_URL:-}" ]; then
  echo "LiveKit:  ${LIVEKIT_URL}"
fi
echo ""

# Kill the whole process group on Ctrl+C so orphaned go/next children stop.
# LiveKit stays up (same as Postgres/Redis after make stop).
trap 'kill 0' EXIT

(cd server && go run ./cmd/server) &
pnpm --filter @uniwork/web dev &

# Stream LiveKit container logs into the same terminal when ensure-livekit ran.
if [ "${SKIP_LIVEKIT:-}" != "1" ] && [ -f .livekit.env.local ]; then
  docker compose -f docker-compose.livekit.yml logs -f --tail=100 livekit &
fi

wait
