#!/usr/bin/env bash
# G7-01 app harness (UNI-1376), item C — bring up the three pieces of the
# smallest end-to-end acceptance case on a Linux runner VM:
#
#   * the real D server (Go, this checkout) on a fresh free port,
#   * the D web app (Next dev) on a fresh free port, built with
#     NEXT_PUBLIC_API_URL on its command line,
#   * the fork's Electron app (dev build) under xvfb, pointed at that server
#     through UNIWORK_API_ORIGIN.
#
# Every run picks new ports: a warm cloud VM still holds :3000/:8080 from an
# earlier round, and a run that silently talks to a stale server passes against
# old code. Nothing outside this run's own PID file is ever touched; stop.sh
# kills exactly those PIDs.
#
# Exit codes: 0 up, 1 a step failed, 77 BLOCKED — a precondition the VM does not
# meet (missing tool, no database, no fork revision). BLOCKED is never a pass:
# the caller records it as BLOCKED with the reason printed here.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
cd "$REPO_ROOT"

BLOCKED_EXIT=77
FORK_SHA="${OFFICE_FORK_SHA:-0d03b18}"
FORK_REMOTE="${OFFICE_FORK_REMOTE:-https://github.com/UNIAI-TEAM/uniwork-office}"
RUN_DIR="${HARNESS_RUN_DIR:-$REPO_ROOT/.harness-run}"
FORK_CACHE="${OFFICE_FORK_CACHE:-$HOME/.cache/uniwork-office-harness}"
DRY_RUN="${HARNESS_DRY_RUN:-0}"
SKIP_APP="${HARNESS_SKIP_APP:-0}"

blocked() { # blocked <what is missing> <what would fix it>
  echo "BLOCKED: $1" >&2
  echo "  fix: $2" >&2
  exit "$BLOCKED_EXIT"
}
fail() { echo "FAILED: $1" >&2; exit 1; }

# ---- preconditions -----------------------------------------------------------
# A missing tool is BLOCKED, not a crash: the cloud runner's provision.sh does
# not install xvfb or the Electron runtime libraries for the uniwork profile
# (see the report's provision delta). We never install system packages here
# beyond what this script can do without root: detect and report.
missing=()
for tool in node go pnpm git curl; do
  command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  blocked "missing tools: ${missing[*]}" "provision the cloud VM (see scripts/office/g5g6g7/harness/README.md › provision delta)"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || blocked "node $NODE_MAJOR is older than 22" "install Node 22 on the VM"

# The env file the VM already prepared (cloud runner: write-env.sh). The harness
# reuses that database and Redis — it creates neither, and never resets them.
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env}"
[ -f "$ENV_FILE" ] || blocked "no env file at $ENV_FILE" "run the cloud runner's start.sh (it writes .env) or scripts/init-worktree-env.sh"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL must be set in $ENV_FILE}"
: "${REDIS_URL:?REDIS_URL must be set in $ENV_FILE}"

if [ "$SKIP_APP" != "1" ]; then
  command -v xvfb-run > /dev/null 2>&1 \
    || blocked "xvfb-run is not installed" "apt-get install -y --no-install-recommends xvfb xauth dbus-x11 (provision delta in the harness README)"
  # Electron needs the Chromium shared libraries. The office profile gets them
  # from `playwright install-deps chromium` (install-office.sh); a uniwork VM
  # does not, and without this check the app dies later with an obscure loader
  # error. ldconfig knows every library the VM has.
  libs_missing=()
  for lib in libnss3.so libatk-1.0.so.0 libgbm.so.1 libasound.so.2 libcups.so.2; do
    ldconfig -p 2> /dev/null | grep -q "$lib" || libs_missing+=("$lib")
  done
  if [ "${#libs_missing[@]}" -gt 0 ]; then
    blocked "the Electron runtime libraries are missing: ${libs_missing[*]}" \
      "(cd /tmp && npx --yes --package=playwright@1.62.1 -- playwright install-deps chromium) — provision delta in the harness README"
  fi
fi

# ---- fresh ports and the environment derived from them -----------------------
# Ports and the server's environment come from lib.mjs (buildServerEnv), the same
# function scripts/office/g5g6g7/harness/lib.test.mjs pins, so the web, the app
# and the sample AC cannot drift from what the server was started with.
mkdir -p "$RUN_DIR/logs" "$RUN_DIR/userdata"
rm -f "$RUN_DIR/BLOCKED"
: > "$RUN_DIR/pids"
D_SHA="$(git rev-parse HEAD)"
export D_SHA
node "$HERE/lib.mjs" --write "$RUN_DIR" > /dev/null || fail "could not pick free ports"

# shellcheck disable=SC1090
. "$RUN_DIR/ports.env"
API_PORT="$API_PORT" WEB_PORT="$WEB_PORT" METRICS_PORT="$METRICS_PORT" PREVIEW_PORT="$PREVIEW_PORT"
API_ORIGIN="$API_ORIGIN" WEB_ORIGIN="$WEB_ORIGIN"

echo "harness: run dir $RUN_DIR"
echo "harness: D server  $API_ORIGIN (metrics 127.0.0.1:$METRICS_PORT)"
echo "harness: D web     $WEB_ORIGIN"
echo "harness: fork      $FORK_SHA"

if [ "$DRY_RUN" = "1" ]; then
  echo "harness: --dry-run, stopping before anything is started"
  exit 0
fi

# ---- D server ----------------------------------------------------------------
# Built, not `go run`: $! of `go run` is the parent, and killing it leaves the
# server orphaned on the port (scripts/check.sh makes the same choice).
echo "harness: building the D server..."
(cd server && go build -o bin/harness-server ./cmd/server) > "$RUN_DIR/logs/server-build.log" 2>&1 \
  || { tail -20 "$RUN_DIR/logs/server-build.log" >&2; fail "go build ./cmd/server failed"; }

echo "harness: applying migrations..."
(cd server && DATABASE_URL="$DATABASE_URL" go run ./cmd/migrate up) > "$RUN_DIR/logs/migrate.log" 2>&1 \
  || { tail -20 "$RUN_DIR/logs/migrate.log" >&2; fail "migrations failed"; }

echo "harness: starting the D server..."
# The environment is the run's own (server.env, built by lib.mjs), not the VM's
# .env: a stray PORT or FRONTEND_ORIGIN there must not move this run onto a
# shared port. Values are exported, not pasted through `env`, so a URL with a
# `?` or `&` in it survives.
STORAGE_BACKEND="${STORAGE_BACKEND:-local}"
JWT_SECRET="${JWT_SECRET:-harness-dev-secret}"
LOG_LEVEL="${LOG_LEVEL:-info}"
set -a
# shellcheck disable=SC1090
. "$RUN_DIR/server.env"
set +a
setsid server/bin/harness-server >> "$RUN_DIR/logs/server.log" 2>&1 &
SERVER_PID=$!
echo "server $SERVER_PID $API_PORT" >> "$RUN_DIR/pids"

wait_for() { # wait_for <url> <name> <seconds>
  local url=$1 name=$2 seconds=$3 i
  for i in $(seq 1 "$seconds"); do
    curl -sf -o /dev/null "$url" && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || fail "$name died while starting (see $RUN_DIR/logs/server.log)"
    sleep 1
  done
  return 1
}
wait_for "$API_ORIGIN/healthz" "the D server" 90 || { tail -20 "$RUN_DIR/logs/server.log" >&2; fail "the D server did not answer /healthz in 90s"; }
curl -sf "$API_ORIGIN/readyz" > "$RUN_DIR/logs/readyz.json" \
  || echo "harness: warning: /readyz is not ready yet; the sample AC reads it and decides"

# ---- D web -------------------------------------------------------------------
# NEXT_PUBLIC_API_URL is inlined by the web build, so it goes on the command
# line; it is the same origin the specs use (e2e/api-url.ts asserts this).
echo "harness: starting the D web with NEXT_PUBLIC_API_URL=$API_ORIGIN ..."
setsid env \
  NEXT_PUBLIC_API_URL="$API_ORIGIN" \
  NEXT_PUBLIC_WS_URL="ws://127.0.0.1:$API_PORT" \
  NEXT_PUBLIC_APP_URL="$WEB_ORIGIN" \
  E2E_BASE_URL="$WEB_ORIGIN" \
  FRONTEND_PORT="$WEB_PORT" \
  PORT="$API_PORT" \
  pnpm --filter @uniwork/web dev >> "$RUN_DIR/logs/web.log" 2>&1 &
WEB_PID=$!
echo "web $WEB_PID $WEB_PORT" >> "$RUN_DIR/pids"

for i in $(seq 1 180); do
  curl -sf -o /dev/null "$WEB_ORIGIN/login" && break
  kill -0 "$WEB_PID" 2>/dev/null || { tail -20 "$RUN_DIR/logs/web.log" >&2; fail "the D web died while starting"; }
  [ "$i" -lt 180 ] || { tail -20 "$RUN_DIR/logs/web.log" >&2; fail "the D web did not answer in 180s"; }
  sleep 1
done

# ---- the fork at a pinned revision -------------------------------------------
if [ "$SKIP_APP" = "1" ]; then
  echo "harness: HARNESS_SKIP_APP=1 — the fork is not cloned and the app is not started"
  echo "harness: up (server + web)"
  exit 0
fi

# One checkout per revision, so two SHAs never share a working tree (lib.mjs
# owns the layout; sample-ac.mjs reads the same path back).
FORK_DIR="$(node -e 'import(process.argv[1]).then((m) => process.stdout.write(m.forkCacheDir(process.argv[2], process.argv[3])))' "$HERE/lib.mjs" "$FORK_CACHE" "$FORK_SHA")"
mkdir -p "$FORK_CACHE"
if [ ! -d "$FORK_DIR/.git" ]; then
  echo "harness: cloning the fork at $FORK_SHA..."
  rm -rf "$FORK_DIR"
  git clone -q "$FORK_REMOTE" "$FORK_DIR" > "$RUN_DIR/logs/fork-clone.log" 2>&1 \
    || { tail -20 "$RUN_DIR/logs/fork-clone.log" >&2; blocked "could not clone $FORK_REMOTE" "give the VM network access to the fork, or pre-clone it at OFFICE_FORK_CACHE"; }
fi
if ! git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null; then
  git -C "$FORK_DIR" fetch -q origin "$FORK_SHA" > "$RUN_DIR/logs/fork-fetch.log" 2>&1 || true
fi
git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null \
  || blocked "the fork checkout has no commit $FORK_SHA" "check OFFICE_FORK_SHA; the pinned base is 0d03b18"
git -C "$FORK_DIR" checkout -q --detach "$FORK_SHA"

# ELECTRON_SKIP_BINARY_DOWNLOAD keeps npm ci cheap; the binary is fetched only
# when the app is actually driven (install-office.sh does the same).
if [ ! -d "$FORK_DIR/node_modules" ]; then
  echo "harness: npm ci in the fork (no Electron binary yet)..."
  (cd "$FORK_DIR" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci) > "$RUN_DIR/logs/fork-npm-ci.log" 2>&1 \
    || { tail -20 "$RUN_DIR/logs/fork-npm-ci.log" >&2; blocked "npm ci failed in the fork" "the fork needs Node 22 and network; see $RUN_DIR/logs/fork-npm-ci.log"; }
fi
for d in "$FORK_DIR/node_modules/electron" "$FORK_DIR/apps/shell/node_modules/electron"; do
  [ -f "$d/install.js" ] && [ ! -f "$d/path.txt" ] || continue
  echo "harness: downloading the Electron binary..."
  node "$d/install.js" > "$RUN_DIR/logs/fork-electron.log" 2>&1 \
    || blocked "the Electron binary could not be downloaded" "network to the Electron release host (see $RUN_DIR/logs/fork-electron.log)"
done

echo "harness: building the fork apps (this is the slow step)..."
(cd "$FORK_DIR" && npm run build:all) > "$RUN_DIR/logs/fork-build.log" 2>&1 \
  || { tail -20 "$RUN_DIR/logs/fork-build.log" >&2; fail "npm run build:all failed in the fork"; }

# ---- the fork's Electron app under xvfb -------------------------------------
# The app is pointed at this run's server through UNIWORK_API_ORIGIN, which the
# shell persists into userData/app-settings.json (office-bridge-host.ts:84
# persistUniWorkApiOriginFromEnv, called at index.ts:5248) — sample-ac.mjs reads
# it back as proof the running app resolved the D server.
echo "harness: starting the fork Electron app under xvfb..."
# The Electron binary is resolved the way the fork's own e2e does
# (apps/shell/e2e/helpers.ts: require('electron') returns the binary path), and
# the switches come before the app path so Chromium consumes them.
ELECTRON_BIN="$(cd "$FORK_DIR/apps/shell" && node -p 'require("electron")' 2> /dev/null || true)"
[ -n "$ELECTRON_BIN" ] && [ -x "$ELECTRON_BIN" ] \
  || blocked "the Electron binary is not installed in the fork" "the harness downloads it with node node_modules/electron/install.js; see $RUN_DIR/logs/fork-electron.log"

XVFB_DISPLAY_FILE="$RUN_DIR/display"
: > "$XVFB_DISPLAY_FILE"
setsid env \
  UNIWORK_API_ORIGIN="$API_ORIGIN" \
  UNIWORK_BRIDGE_SILENT=1 \
  GENOFFICE_USER_DATA="$RUN_DIR/userdata" \
  GENOFFICE_NO_SPARE_VIEW=1 \
  GENOFFICE_LANG=en \
  ELECTRON_DISABLE_SANDBOX=1 \
  xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
  bash -c "echo \"\$DISPLAY\" > '$XVFB_DISPLAY_FILE'; exec '$ELECTRON_BIN' --no-sandbox --disable-gpu '$FORK_DIR/apps/shell'" \
  >> "$RUN_DIR/logs/app.log" 2>&1 &
APP_PID=$!
echo "app $APP_PID 0" >> "$RUN_DIR/pids"

# The dev build boots in seconds; a crash here is a real failure, not a block.
for i in $(seq 1 60); do
  [ -s "$XVFB_DISPLAY_FILE" ] && break
  kill -0 "$APP_PID" 2>/dev/null || { tail -30 "$RUN_DIR/logs/app.log" >&2; fail "the Electron app exited while starting (see $RUN_DIR/logs/app.log)"; }
  sleep 1
done
[ -s "$XVFB_DISPLAY_FILE" ] || fail "xvfb never reported a display for the app"
DISPLAY_VALUE="$(cat "$XVFB_DISPLAY_FILE")"
echo "DISPLAY=$DISPLAY_VALUE" >> "$RUN_DIR/ports.env"
echo "harness: app on $DISPLAY_VALUE (pid $APP_PID)"

echo "harness: up"
echo "  D server  $API_ORIGIN"
echo "  D web     $WEB_ORIGIN"
echo "  fork      $FORK_DIR @ $FORK_SHA"
echo "  pids      $RUN_DIR/pids"
echo "  next      OFFICE_FORK_SHA=$FORK_SHA HARNESS_RUN_DIR=$RUN_DIR node scripts/office/g5g6g7/evidence.mjs run \\"
echo "              --req G7-A05 --fixture fx-md-notes-vi --checker tester-cloud -- \\"
echo "              node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir $RUN_DIR"
