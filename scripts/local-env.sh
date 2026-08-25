# Shared local development env derivation. Source this AFTER loading the env
# file so explicit values win and only the gaps are filled in.

POSTGRES_DB="${POSTGRES_DB:-uniwork}"
POSTGRES_USER="${POSTGRES_USER:-uniwork}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-uniwork}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"

DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable}"
# Go tests truncate every table, so they get their own database on the same
# server rather than the one the app is using.
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}_test?sslmode=disable}"
REDIS_TEST_URL="${REDIS_TEST_URL:-redis://localhost:6379/15}"

NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:${PORT}}"
NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-ws://localhost:${PORT}}"
NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${FRONTEND_ORIGIN}}"
LOCAL_UPLOAD_BASE_URL="${LOCAL_UPLOAD_BASE_URL:-http://localhost:${PORT}}"
E2E_BASE_URL="${E2E_BASE_URL:-${FRONTEND_ORIGIN}}"

export POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_PORT
export PORT FRONTEND_PORT FRONTEND_ORIGIN
export DATABASE_URL TEST_DATABASE_URL REDIS_TEST_URL
export NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL NEXT_PUBLIC_APP_URL LOCAL_UPLOAD_BASE_URL E2E_BASE_URL
