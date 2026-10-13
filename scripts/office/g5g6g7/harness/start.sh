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
# meet (missing tool, no database, no fork revision, no network, no display).
# BLOCKED is never a pass: the caller records it as BLOCKED with the reason
# printed here. A step that fails while its precondition is met — an install
# strategy of ours that does not match the fork, a build that breaks — is a FAIL
# (1), never BLOCKED: the r2 round reported BLOCKED for an install bug of this
# script's own and read as "the VM cannot do it".
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
DESKTOP="${HARNESS_DESKTOP:-0}"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-app) SKIP_APP=1 ;;
    --desktop) DESKTOP=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "start.sh: unknown argument $arg (try --help)" >&2; exit 2 ;;
  esac
done

# --dry-run must never touch a live run: before this, it truncated the run's pids
# file and rewrote ports.env/server.env/lib.log before reaching its own exit, so
# stop.sh could no longer find the live server/web/app (reviewer_be H1-2). It
# gets a scratch run dir of its own instead of the real one.
DRY_RUN_DIR=""
if [ "$DRY_RUN" = "1" ]; then
  DRY_RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/harness-dry-run.XXXXXX")"
  RUN_DIR="$DRY_RUN_DIR"
fi
mkdir -p "$RUN_DIR/logs" "$RUN_DIR/userdata"
# Absolute from here on: the D server is started from another directory, and a
# relative HARNESS_RUN_DIR would point its log redirect at the wrong place.
RUN_DIR="$(cd "$RUN_DIR" && pwd)"

# start.sh records its own outcome in start-status.json (state starting | up |
# failed | blocked, plus the reason). The steps after it (sample-ac.mjs,
# document-step.mjs) read it: a start that FAILED must fail them too, and only a
# precondition start.sh itself reported as missing may make them BLOCKED. Cloud
# round 4 had start.sh exit 1 and both later steps record BLOCKED, which read as
# "the VM cannot do it" for what was a harness bug.
STATUS_FILE="$RUN_DIR/start-status.json"
STATUS_FINAL=0
write_status() { # write_status <state> [reason]; the reason is one JSON-escaped line
  local reason="${2:-}"
  reason="${reason//\\/\\\\}"
  reason="${reason//\"/\\\"}"
  reason="${reason//$'\n'/ }"
  reason="${reason//$'\t'/ }"
  printf '{"state":"%s","reason":"%s"}\n' "$1" "$reason" > "$STATUS_FILE"
}
[ "$DRY_RUN" = "1" ] || write_status starting

blocked() { # blocked <what is missing> <what would fix it>
  echo "BLOCKED: $1" >&2
  echo "  fix: $2" >&2
  STATUS_FINAL=1
  write_status blocked "$1 (fix: $2)"
  exit "$BLOCKED_EXIT"
}
fail() {
  echo "FAILED: $1" >&2
  STATUS_FINAL=1
  write_status failed "$1"
  exit 1
}

# The Electron runtime libraries are probed from `ldconfig -p` captured once,
# then matched with bash's own substring test — never a `ldconfig -p | grep -q`
# pipeline. Under `set -o pipefail` a `grep -q` exits at the first match,
# ldconfig takes SIGPIPE (141) and the pipeline's status is 141, so a PRESENT
# library is recorded as missing and the run goes BLOCKED (reviewer_be r2 N3).
LIBCACHE=""
missing_libs() { # missing_libs <lib>...: prints each lib ldconfig does not list
  [ -n "$LIBCACHE" ] || LIBCACHE="$(ldconfig -p 2> /dev/null || true)"
  local lib
  for lib in "$@"; do
    case "$LIBCACHE" in *"$lib"*) ;; *) printf '%s\n' "$lib" ;; esac
  done
}

# Every component writes its own log under the run dir, and a cloud round has to
# be able to read the failure from those logs alone — the r1 round died on an
# exit nobody explained and left nothing but the last stdout line. So any
# non-zero exit prints the tail of each component log once; the message says
# which log to open first. HARNESS_LOG_TAIL_LINES tunes the length.
LOG_DIR="$RUN_DIR/logs"
LOG_TAIL_LINES="${HARNESS_LOG_TAIL_LINES:-40}"
dumped_logs=0
# Logs a step already tailed itself (fork_log_tail); the trap must not repeat them.
already_tailed=""
dump_logs() {
  [ -d "$LOG_DIR" ] || return 0
  local log any=0
  for log in "$LOG_DIR"/*.log; do
    [ -f "$log" ] || continue
    # lib.log is lib.mjs's last stderr; run_lib already echoes it on the failing
    # call, so dumping it again here would only duplicate it.
    [ "$(basename "$log")" = "lib.log" ] && continue
    case " $already_tailed " in *" $log "*) continue ;; esac
    any=1
    echo "harness: ---- tail -$LOG_TAIL_LINES $(basename "$log") ----" >&2
    tail -n "$LOG_TAIL_LINES" "$log" >&2 || true
  done
  [ "$any" = 1 ] || echo "harness: no component logs in $LOG_DIR" >&2
}
# A dry run touches nothing of a live run: it works in a scratch run dir (see
# DRY_RUN_DIR), removed here once the exit is reported.
on_exit() {
  local code=$?
  report_exit "$code"
  [ -z "${DRY_RUN_DIR:-}" ] || rm -rf "$DRY_RUN_DIR"
  return 0
}
report_exit() {
  local code=$1
  [ "$code" -eq 0 ] && return 0
  # An exit nobody called fail()/blocked() for (set -e on a bad command) is still
  # a failed start, never a quiet "starting".
  if [ "$STATUS_FINAL" = 0 ] && [ "$DRY_RUN" != "1" ]; then
    write_status failed "start.sh exited $code before finishing (see the component logs)"
  fi
  # BLOCKED already prints the missing precondition and its fix; log tails there
  # would only add noise. Everything else (a failed step, an unexpected exit) is
  # worth the tails.
  [ "$code" -eq "$BLOCKED_EXIT" ] && return 0
  [ "$dumped_logs" = 1 ] && return 0
  dumped_logs=1
  echo "harness: exit $code; component log tails ($LOG_DIR):" >&2
  dump_logs
}
trap on_exit EXIT

# Every lib.mjs call goes through here, so a failure names the step, prints the
# exact command and shows lib.mjs's own message. The r1 round ended on a bare
# `usage: lib.mjs --write <runDir>` with nothing saying which call produced it:
# start.sh imported lib.mjs from `node -e`, argv[1] looked like a direct run,
# and the --write CLI fired with no --write. lib.mjs no longer mistakes that for
# a direct run (see isMainModule), and this wrapper makes any recurrence legible.
run_lib() { # run_lib <step> <args...>; stdout is lib.mjs's output, stderr is teed to lib.log
  local step=$1
  shift
  local output status
  output="$(node "$HERE/lib.mjs" "$@" 2> "$LOG_DIR/lib.log")" && status=0 || status=$?
  if [ "$status" -ne 0 ]; then
    echo "harness: step '$step' failed (exit $status)" >&2
    echo "  command: node $HERE/lib.mjs $*" >&2
    echo "  lib.mjs said:" >&2
    sed 's/^/    /' "$LOG_DIR/lib.log" >&2 || true
    return "$status"
  fi
  printf '%s\n' "$output"
}

# ---- preconditions -----------------------------------------------------------
# A missing tool is BLOCKED, not a crash. What can be installed is installed
# below (see "what this run needs on top of the provisioned VM"); what cannot is
# reported with the command that would fix it.
missing=()
for tool in node go pnpm git curl; do
  command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -gt 0 ]; then
  blocked "missing tools: ${missing[*]}" "provision the cloud VM (see scripts/office/g5g6g7/harness/README.md › provision delta)"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || blocked "node $NODE_MAJOR is older than 22" "install Node 22 on the VM"

# ---- Node 22 from nvm, when the VM's default node is not it ------------------
# The cloud VM's default `node` is not guaranteed to be a 22.x: the agent image
# ships its own build and the runner may put another one first. The fork pins
# `engines.node >= 22.12.0` (electron 43's own engine), so every fork step —
# install, build, electron download, the app — must run on a Node 22. nvm is
# sourced in a subshell (its script is not `set -u` clean) and only the resolved
# 22.x bin dir is taken from it; when nvm has no 22 the ambient node is used if
# it satisfies the engine, and a VM with neither is BLOCKED, never a silent run
# on the wrong major.
NODE_ENGINE_MIN="${HARNESS_NODE_ENGINE_MIN:-22.12.0}"
node_engine_ok() { # node_engine_ok <node-bin>
  [ -x "$1" ] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);const [x,y]=process.argv[1].split(".").map(Number);process.exit(a>x||(a===x&&b>=y)?0:1)' "$NODE_ENGINE_MIN"
}
nvm_node_bin() {
  local sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  [ -s "$sh" ] || return 1
  bash -c 'set +u; . "$1" > /dev/null 2>&1 || exit 1; nvm which 22 2> /dev/null' _ "$sh"
}
NVM_NODE="$(nvm_node_bin || true)"
if [ -n "$NVM_NODE" ] && node_engine_ok "$NVM_NODE"; then
  PATH="$(dirname "$NVM_NODE"):$PATH"
  export PATH
  echo "harness: node $("$NVM_NODE" -p 'process.versions.node') from nvm ($NVM_NODE)"
elif node_engine_ok "$(command -v node)"; then
  echo "harness: node $(node -p 'process.versions.node') from PATH (nvm has no usable 22.x)"
else
  blocked "no Node >= $NODE_ENGINE_MIN on this VM (nvm: ${NVM_NODE:-none}, PATH: $(node -p 'process.versions.node' 2> /dev/null || echo none))" \
    "install Node 22 on the VM (nvm install 22, or the NodeSource 22.x package)"
fi

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

# ---- what this run needs on top of the provisioned VM ------------------------
# The cloud runner's uniwork profile installs xvfb for the desktop Linux proof,
# but the Electron runtime libraries only reach the *office* profile (through
# `playwright install-deps chromium` in install-office.sh). The Advisor's rule is
# that the harness installs what it needs itself, so the gap is filled here — and
# a gap that cannot be filled is BLOCKED with the reason, never an obscure
# loader failure later. Detection only: the install runs after --dry-run.
# The web dev server is started through pnpm, so the checkout must be installed.
[ -d "$REPO_ROOT/node_modules" ] \
  || blocked "this checkout has no node_modules" "run pnpm install (the cloud runner's install.sh does it)"

NEED_XVFB=0
LIBS_MISSING=()
if [ "$SKIP_APP" != "1" ] && [ "$DESKTOP" = "1" ]; then
  # Desktop mode: the app opens on the invoking session's own display, so a
  # person can sign in to it; no Xvfb is started or installed.
  [ -n "${DISPLAY:-}" ] \
    || blocked "--desktop needs a graphical session (DISPLAY is empty)" "run start.sh from a terminal of the desktop session the app should open on"
elif [ "$SKIP_APP" != "1" ]; then
  command -v xvfb-run > /dev/null 2>&1 || NEED_XVFB=1
  while IFS= read -r lib; do
    [ -n "$lib" ] && LIBS_MISSING+=("$lib")
  done < <(missing_libs libnss3.so libatk-1.0.so.0 libgbm.so.1 libasound.so.2 libcups.so.2)
fi

APT=""
if command -v apt-get > /dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then APT="apt-get"
  elif command -v sudo > /dev/null 2>&1 && sudo -n true 2> /dev/null; then APT="sudo apt-get"
  fi
fi
apt_update_once() {
  [ -n "$APT" ] || return 1
  [ -f "$RUN_DIR/logs/.apt-updated" ] && return 0
  # shellcheck disable=SC2086
  $APT update -q >> "$RUN_DIR/logs/apt.log" 2>&1 && : > "$RUN_DIR/logs/.apt-updated"
}
apt_install() { # apt_install <packages...>
  [ -n "$APT" ] || return 1
  # shellcheck disable=SC2086
  $APT install -y -q --no-install-recommends "$@" >> "$RUN_DIR/logs/apt.log" 2>&1
}

# ---- fresh ports and the environment derived from them -----------------------
# Ports and the server's environment come from lib.mjs (buildServerEnv), the same
# function scripts/office/g5g6g7/harness/lib.test.mjs pins, so the web, the app
# and the sample AC cannot drift from what the server was started with.
: > "$RUN_DIR/pids"
D_SHA="$(git rev-parse HEAD)"
export D_SHA
HARNESS_ENV_FILE="$ENV_FILE" run_lib "pick the run's ports and env" --write "$RUN_DIR" > /dev/null \
  || fail "could not pick the run's ports and env (see the step above and $LOG_DIR/lib.log)"

# shellcheck disable=SC1090
. "$RUN_DIR/ports.env"
API_PORT="$API_PORT" WEB_PORT="$WEB_PORT" METRICS_PORT="$METRICS_PORT" PREVIEW_PORT="$PREVIEW_PORT"
API_ORIGIN="$API_ORIGIN" WEB_ORIGIN="$WEB_ORIGIN"

echo "harness: run dir $RUN_DIR"
echo "harness: D server  $API_ORIGIN (metrics 127.0.0.1:$METRICS_PORT)"
echo "harness: D web     $WEB_ORIGIN"
echo "harness: fork      $FORK_SHA"

if [ "$DRY_RUN" = "1" ]; then
  [ "$NEED_XVFB" = 0 ] || echo "harness: --dry-run would install xvfb xauth dbus-x11"
  [ "${#LIBS_MISSING[@]}" -eq 0 ] || echo "harness: --dry-run would install the Electron runtime libraries (${LIBS_MISSING[*]})"
  echo "harness: --dry-run, stopping before anything is started"
  exit 0
fi

# ---- fill the gap the VM's profile left --------------------------------------
if [ "$NEED_XVFB" = 1 ]; then
  echo "harness: xvfb-run is missing; installing xvfb, xauth, dbus-x11..."
  apt_update_once && apt_install xvfb xauth dbus-x11 \
    || blocked "xvfb-run is missing and could not be installed" "run as root or with passwordless sudo, or install: apt-get install -y --no-install-recommends xvfb xauth dbus-x11"
  command -v xvfb-run > /dev/null 2>&1 \
    || blocked "xvfb-run is still missing after the install attempt" "see $RUN_DIR/logs/apt.log"
fi
if [ "${#LIBS_MISSING[@]}" -gt 0 ]; then
  echo "harness: the Electron runtime libraries are missing (${LIBS_MISSING[*]}); installing them..."
  # npx first: it follows the Playwright version and knows the whole set on this
  # Ubuntu release; the explicit list is the fallback when npx cannot run.
  if ! (cd /tmp && npx --yes --package="playwright@1.62.1" -- playwright install-deps chromium) >> "$RUN_DIR/logs/apt.log" 2>&1; then
    apt_update_once && apt_install libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 libcups2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libdrm2 \
      || blocked "the Electron runtime libraries are missing and could not be installed: ${LIBS_MISSING[*]}" "run as root or with passwordless sudo; see $RUN_DIR/logs/apt.log"
  fi
  libs_still=()
  while IFS= read -r lib; do
    [ -n "$lib" ] && libs_still+=("$lib")
  done < <(missing_libs libnss3.so libatk-1.0.so.0 libgbm.so.1 libasound.so.2 libcups.so.2)
  [ "${#libs_still[@]}" -eq 0 ] \
    || blocked "the Electron runtime libraries are still missing: ${libs_still[*]}" "see $RUN_DIR/logs/apt.log"
fi

# ---- D server ----------------------------------------------------------------
# Built, not `go run`: $! of `go run` is the parent, and killing it leaves the
# server orphaned on the port (scripts/check.sh makes the same choice).
echo "harness: building the D server..."
(cd server && go build -o bin/harness-server ./cmd/server) > "$RUN_DIR/logs/server-build.log" 2>&1 \
  || fail "go build ./cmd/server failed (see $RUN_DIR/logs/server-build.log)"

echo "harness: applying migrations..."
(cd server && DATABASE_URL="$DATABASE_URL" go run ./cmd/migrate up) > "$RUN_DIR/logs/migrate.log" 2>&1 \
  || fail "migrations failed (see $RUN_DIR/logs/migrate.log)"

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
# The server also reads a local .env for every key that is empty or unset in its
# environment (server/cmd/server/envfile.go), so clearing DESKTOP_AUTH_CLIENT_ID
# in server.env would be undone by the checkout's .env and collide with
# DESKTOP_AUTH_CLIENTS (cloud round 4). It runs from a directory three levels
# deep inside the run dir (lib.mjs: serverCwd), where none of its four .env
# lookups finds the checkout's file; lib.mjs --write put there a copy of the VM's
# .env without the keys this run owns, so the VM's other settings still arrive.
SERVER_CWD="$RUN_DIR/server-cwd/a/b/c"
mkdir -p "$SERVER_CWD"
cd "$SERVER_CWD"
setsid "$REPO_ROOT/server/bin/harness-server" >> "$RUN_DIR/logs/server.log" 2>&1 &
SERVER_PID=$!
cd "$REPO_ROOT"
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
wait_for "$API_ORIGIN/healthz" "the D server" 90 || fail "the D server did not answer /healthz in 90s"
curl -sf "$API_ORIGIN/readyz" > "$RUN_DIR/logs/readyz.json" \
  || echo "harness: warning: /readyz is not ready yet; the sample AC reads it and decides"

# ---- D web -------------------------------------------------------------------
# NEXT_PUBLIC_API_URL is inlined by the web build, so it goes on the command
# line; it is the same origin the specs use (e2e/api-url.ts asserts this).
echo "harness: starting the D web with NEXT_PUBLIC_API_URL=$API_ORIGIN ..."
setsid env \
  NEXT_PUBLIC_API_URL="$API_ORIGIN" \
  NEXT_PUBLIC_WS_URL="ws://localhost:$API_PORT" \
  NEXT_PUBLIC_APP_URL="$WEB_ORIGIN" \
  E2E_BASE_URL="$WEB_ORIGIN" \
  FRONTEND_PORT="$WEB_PORT" \
  PORT="$API_PORT" \
  pnpm --filter @uniwork/web dev >> "$RUN_DIR/logs/web.log" 2>&1 &
WEB_PID=$!
echo "web $WEB_PID $WEB_PORT" >> "$RUN_DIR/pids"

for i in $(seq 1 180); do
  curl -sf -o /dev/null "$WEB_ORIGIN/login" && break
  kill -0 "$WEB_PID" 2>/dev/null || fail "the D web died while starting (see $RUN_DIR/logs/web.log)"
  [ "$i" -lt 180 ] || fail "the D web did not answer in 180s (see $RUN_DIR/logs/web.log)"
  sleep 1
done

# ---- the fork at a pinned revision -------------------------------------------
if [ "$SKIP_APP" = "1" ]; then
  echo "harness: HARNESS_SKIP_APP=1 — the fork is not cloned and the app is not started"
  echo "harness: up (server + web)"
  STATUS_FINAL=1
  write_status up
  exit 0
fi

# One checkout per revision, so two SHAs never share a working tree (lib.mjs
# owns the layout; sample-ac.mjs reads the same path back).
FORK_DIR="$(run_lib "resolve the fork cache dir" --fork-dir "$FORK_CACHE" "$FORK_SHA")" \
  || fail "could not resolve the fork cache dir for $FORK_SHA (see the step above and $LOG_DIR/lib.log)"
[ -n "$FORK_DIR" ] || fail "lib.mjs --fork-dir returned an empty path for $FORK_SHA"
mkdir -p "$FORK_CACHE"
# Is the fork reachable? A VM without network is the one precondition that makes
# every fork step impossible, so it is probed on its own and reported as BLOCKED;
# with the network up, a clone or install that fails is this harness's step
# failing (FAIL), never a missing capability. Only run when the work is needed,
# so a warm cache never depends on the probe.
fork_network_ok() {
  curl -sf -o /dev/null --max-time 20 "$FORK_REMOTE/info/refs?service=git-upload-pack"
}

if [ ! -d "$FORK_DIR/.git" ]; then
  echo "harness: cloning the fork at $FORK_SHA..."
  # Replace a half-written cache entry through a staging dir, so a failed clone
  # can never leave a directory that looks like a checkout.
  rm -rf "$FORK_DIR.staging"
  if ! git clone -q "$FORK_REMOTE" "$FORK_DIR.staging" > "$RUN_DIR/logs/fork-clone.log" 2>&1; then
    fork_log_tail "$RUN_DIR/logs/fork-clone.log" "the fork clone"
    if fork_network_ok; then
      fail "git clone $FORK_REMOTE failed although the fork answers (see $RUN_DIR/logs/fork-clone.log)"
    fi
    blocked "could not clone $FORK_REMOTE" "give the VM network access to the fork, or pre-clone it at OFFICE_FORK_CACHE"
  fi
  mv "$FORK_DIR.staging" "$FORK_DIR"
fi
# Fetching a bare SHA needs the server to allow it, so a miss fetches the
# branches (the pinned base is on the default branch) and re-checks.
if ! git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null; then
  git -C "$FORK_DIR" fetch -q origin > "$RUN_DIR/logs/fork-fetch.log" 2>&1 || true
fi
if ! git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null; then
  if fork_network_ok; then
    fail "the fork has no commit $FORK_SHA after fetching (the pin is wrong; the pinned base is 0d03b18)"
  fi
  blocked "the fork checkout has no commit $FORK_SHA" "check OFFICE_FORK_SHA; the pinned base is 0d03b18"
fi
git -C "$FORK_DIR" checkout -q --detach "$FORK_SHA"

# ---- install the fork, the runner's way --------------------------------------
# The runner's install-office.sh installs the fork with
# `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` and fetches the binary afterwards with
# `node node_modules/electron/install.js` (run-tests.sh:186-190). This harness
# must do exactly that, because the environment variable alone no longer keeps
# the binary out of `npm ci`:
#
#   * electron 43 dropped the `if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD)
#     process.exit(0)` guard its install.js carried through 42.x, so the flag is
#     now inert. The fork pins electron 43.7.6, so the root `postinstall:
#     install-electron` downloaded a 123 MiB GitHub release *during* `npm ci` —
#     the r2 round died on that download (504 from the release host) and, worse,
#     on any hiccup it takes the whole `npm ci` with it.
#   * a `postinstall` that downloads a release is not a precondition the VM can
#     satisfy, so a failure there is this harness's install strategy failing, not
#     a missing capability: FAIL (1), never BLOCKED (77). Only a missing network
#     or a missing Node 22 is a precondition, and each is probed on its own below.
#
# So: `npm ci --ignore-scripts` for the tree, then the two scripts the fork needs
# (`install-electron`, and esbuild's `install.js` which links the platform binary
# its optional dependency shipped). Everything else the fork's 8 install scripts
# do is for Windows packaging (electron-winstaller's 7z copy) or a version-scheme
# warning (protobufjs) and is deliberately skipped.
FORK_INSTALL_LOG="$RUN_DIR/logs/fork-install.log"
fork_log_tail() { # fork_log_tail <log> <what> — the last 60 lines on stdout before a FAILED
  echo "harness: ---- last 60 lines of $2 ($1) ----" >&2
  tail -n 60 "$1" >&2 2> /dev/null || true
  already_tailed="$already_tailed $1"
}

# The fork's dependency tree is complete when npm ci has run and esbuild links a
# working binary; a cache from an older strategy (a plain `npm ci`, or one that
# died in the postinstall) is re-installed rather than trusted.
fork_tree_ready() {
  local dir=$1
  [ -f "$dir/node_modules/electron/install.js" ] || return 1
  [ -x "$dir/node_modules/.bin/esbuild" ] || return 1
  "$dir/node_modules/.bin/esbuild" --version > /dev/null 2>&1
}

# npm ci with the fork's own scripts off: nothing in the tree may reach the
# network, so a failure here is a real install failure and never a BLOCKED.
run_npm_ci() { # run_npm_ci <dir>
  local dir=$1
  (cd "$dir" && npm ci --ignore-scripts) >> "$FORK_INSTALL_LOG" 2>&1
}

# A missing network is the one precondition that stops the install (BLOCKED); a
# slow or flaky one is not judged here — the install itself reports a real
# failure. Probed only when something still has to be fetched, so a warm cache
# never blocks on it.
need_fork_install=0
fork_tree_ready "$FORK_DIR" || need_fork_install=1
for d in "$FORK_DIR/node_modules/electron" "$FORK_DIR/apps/shell/node_modules/electron"; do
  [ -f "$d/install.js" ] || continue
  { [ -f "$d/path.txt" ] && [ -x "$d/dist/electron" ]; } || need_fork_install=1
done
if [ "$need_fork_install" = 1 ] && ! fork_network_ok; then
  blocked "no network to $FORK_REMOTE" "give the VM network access to the fork, or pre-clone it at OFFICE_FORK_CACHE"
fi

if ! fork_tree_ready "$FORK_DIR"; then
  echo "harness: npm ci in the fork (--ignore-scripts; no Electron binary yet)..."
  if ! run_npm_ci "$FORK_DIR"; then
    fork_log_tail "$FORK_INSTALL_LOG" "the fork install"
    fail "npm ci --ignore-scripts failed in the fork (see $FORK_INSTALL_LOG)"
  fi
  if [ ! -f "$FORK_DIR/node_modules/electron/install.js" ]; then
    fork_log_tail "$FORK_INSTALL_LOG" "the fork install"
    fail "the fork install left no node_modules/electron/install.js (see $FORK_INSTALL_LOG)"
  fi
fi

# `install-electron` in the tree npm ci skipped (npm puts the workspace bins in
# node_modules/.bin; the fork has no apps/shell/node_modules of its own today,
# the second path is the one run-tests.sh also probes).
for d in "$FORK_DIR/node_modules/electron" "$FORK_DIR/apps/shell/node_modules/electron"; do
  [ -f "$d/install.js" ] || continue
  if [ -f "$d/path.txt" ] && [ -x "$d/dist/electron" ]; then
    continue
  fi
  echo "harness: fetching the Electron binary (node $d/install.js)..."
  (cd "$d/.." && node "$d/install.js") >> "$FORK_INSTALL_LOG" 2>&1 \
    || { fork_log_tail "$FORK_INSTALL_LOG" "the Electron binary download"; fail "the Electron binary could not be downloaded (see $FORK_INSTALL_LOG)"; }
done

# esbuild's postinstall links the platform binary; without it `vite` cannot
# bundle and `npm run build:all` fails on a missing esbuild. The JS shim still
# works when the optional platform package is present, so this is a repair, not
# a hard requirement.
if [ -f "$FORK_DIR/node_modules/esbuild/install.js" ] \
  && ! "$FORK_DIR/node_modules/.bin/esbuild" --version > /dev/null 2>&1; then
  echo "harness: repairing the esbuild binary (node node_modules/esbuild/install.js)..."
  (cd "$FORK_DIR" && node node_modules/esbuild/install.js) >> "$FORK_INSTALL_LOG" 2>&1 \
    || { fork_log_tail "$FORK_INSTALL_LOG" "the esbuild binary install"; fail "esbuild's install.js failed in the fork (see $FORK_INSTALL_LOG)"; }
fi

# The build is the slow step, and the cache is one directory per SHA, so a build
# already made from this revision is reused. The marker lives inside the
# checkout, which is never committed to.
BUILD_MARKER="$FORK_DIR/.harness-built"
SHELL_MAIN="$FORK_DIR/apps/shell/out/main/index.js"
if [ -f "$BUILD_MARKER" ] && [ "$(cat "$BUILD_MARKER" 2> /dev/null)" = "$FORK_SHA" ] && [ -f "$SHELL_MAIN" ]; then
  echo "harness: the fork is already built at $FORK_SHA; skipping build:all"
else
  echo "harness: building the fork apps (this is the slow step)..."
  (cd "$FORK_DIR" && npm run build:all) > "$RUN_DIR/logs/fork-build.log" 2>&1 \
    || { fork_log_tail "$RUN_DIR/logs/fork-build.log" "the fork build"; fail "npm run build:all failed in the fork (see $RUN_DIR/logs/fork-build.log)"; }
  printf '%s\n' "$FORK_SHA" > "$BUILD_MARKER"
fi
if [ ! -f "$SHELL_MAIN" ]; then
  fork_log_tail "$RUN_DIR/logs/fork-build.log" "the fork build"
  fail "the fork built but has no $SHELL_MAIN (build:all did not produce the shell)"
fi

# ---- the fork's Electron app under xvfb -------------------------------------
# The app is pointed at this run's server through UNIWORK_API_ORIGIN, which the
# shell persists into userData/app-settings.json (office-bridge-host.ts:84
# persistUniWorkApiOriginFromEnv, called at index.ts:5248) — sample-ac.mjs reads
# it back as proof the running app resolved the D server.
if [ "$DESKTOP" = "1" ]; then
  echo "harness: starting the fork Electron app on the desktop display $DISPLAY..."
else
  echo "harness: starting the fork Electron app under xvfb..."
fi
# The Electron binary is resolved the way the fork's own e2e does
# (apps/shell/e2e/helpers.ts: require('electron') returns the binary path), and
# the switches come before the app path so Chromium consumes them.
ELECTRON_BIN="$(cd "$FORK_DIR/apps/shell" && node -p 'require("electron")' 2> /dev/null || true)"
if [ -z "$ELECTRON_BIN" ] || [ ! -x "$ELECTRON_BIN" ]; then
  # The download step above already ran and reported its own failure; reaching
  # here means the tree has no usable binary, which is an install of ours that
  # did not hold — a FAIL, not a missing precondition.
  fork_log_tail "$FORK_INSTALL_LOG" "the fork install"
  fail "no usable Electron binary in the fork (resolved '${ELECTRON_BIN:-}'; see $FORK_INSTALL_LOG)"
fi

XVFB_DISPLAY_FILE="$RUN_DIR/display"
: > "$XVFB_DISPLAY_FILE"
# Under xvfb-run the app gets a display of its own; in desktop mode it is started
# directly and keeps the DISPLAY of the invoking session. xvfb-run protects its
# display with an Xauthority file; left to itself it makes a private temp one and
# exports XAUTHORITY to the app only, so the document step's second Electron
# instance (a separate process tree) was refused with "Authorization required"
# (cloud round 6). The file lives in the run dir instead (-f) and ports.env
# records it next to DISPLAY.
XVFB_AUTH_FILE="$RUN_DIR/xauthority"
APP_WRAP=()
if [ "$DESKTOP" != "1" ]; then
  : > "$XVFB_AUTH_FILE"
  chmod 600 "$XVFB_AUTH_FILE"
  APP_WRAP=(xvfb-run --auto-servernum -f "$XVFB_AUTH_FILE" --server-args="-screen 0 1280x800x24")
fi
# --password-store=gnome-libsecret is explicit: with no XDG_CURRENT_DESKTOP (appEnv
# does not pass it) Electron falls back to basic_text even with a working
# gnome-keyring, and the credential store reports keyring_unavailable.
# The app gets an allow-listed environment (lib.mjs: appEnv), never the VM's .env
# this script sourced above: DATABASE_URL, JWT_SECRET and the rest are the
# server's, and the app is only its client (reviewer_be H1-8).
APP_ENV=()
while IFS= read -r -d '' entry; do APP_ENV+=("$entry"); done \
  < <(node "$HERE/lib.mjs" --app-env "$API_ORIGIN" "$RUN_DIR/userdata" 2>> "$LOG_DIR/lib.log")
[ "${#APP_ENV[@]}" -gt 0 ] || fail "could not build the app's environment (see $LOG_DIR/lib.log)"
setsid env -i "${APP_ENV[@]}" \
  ${APP_WRAP[@]+"${APP_WRAP[@]}"} \
  bash -c "printf '%s\\n%s\\n' \"\$DISPLAY\" \"\${XAUTHORITY:-}\" > '$XVFB_DISPLAY_FILE'; exec '$ELECTRON_BIN' --no-sandbox --disable-gpu --password-store=gnome-libsecret '$FORK_DIR/apps/shell'" \
  >> "$RUN_DIR/logs/app.log" 2>&1 &
APP_PID=$!
echo "app $APP_PID 0" >> "$RUN_DIR/pids"

# The dev build boots in seconds; a crash here is a real failure, not a block.
for i in $(seq 1 60); do
  [ -s "$XVFB_DISPLAY_FILE" ] && break
  kill -0 "$APP_PID" 2>/dev/null || fail "the Electron app exited while starting (see $RUN_DIR/logs/app.log)"
  sleep 1
done
[ -s "$XVFB_DISPLAY_FILE" ] || fail "xvfb never reported a display for the app"
# Line 1 is the display, line 2 the X auth file the app was given ("" when the
# invoking desktop session uses none).
DISPLAY_VALUE="$(sed -n 1p "$XVFB_DISPLAY_FILE")"
XAUTH_VALUE="$(sed -n 2p "$XVFB_DISPLAY_FILE")"
{
  echo "DISPLAY=$DISPLAY_VALUE"
  [ -z "$XAUTH_VALUE" ] || echo "XAUTHORITY=$XAUTH_VALUE"
  # What the document step needs to hand a deep link to the running app the way
  # the fork's own suite does (second instance, URL in argv): the Electron
  # binary, the app dir, the userData the working copy lands in, the fork
  # checkout and the deployment id the D server and the app must agree on.
  echo "UNIWORK_USER_DATA=$RUN_DIR/userdata"
  echo "ELECTRON_BIN=$ELECTRON_BIN"
  echo "SHELL_APP_DIR=$FORK_DIR/apps/shell"
  echo "OFFICE_FORK_DIR=$FORK_DIR"
  echo "HARNESS_DEPLOYMENT_ID=default"
} >> "$RUN_DIR/ports.env"
echo "harness: app on $DISPLAY_VALUE (pid $APP_PID)"

STATUS_FINAL=1
write_status up
echo "harness: up"
echo "  D server  $API_ORIGIN"
echo "  D web     $WEB_ORIGIN"
echo "  fork      $FORK_DIR @ $FORK_SHA"
echo "  pids      $RUN_DIR/pids"
echo "  next      OFFICE_FORK_SHA=$FORK_SHA HARNESS_RUN_DIR=$RUN_DIR node scripts/office/g5g6g7/evidence.mjs run \\"
echo "              --req G7-A05 --fixture fx-md-notes-vi --checker tester-cloud -- \\"
echo "              node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir $RUN_DIR"
echo "  next      (document step, its own evidence line) OFFICE_FORK_SHA=$FORK_SHA HARNESS_RUN_DIR=$RUN_DIR \\"
echo "              node scripts/office/g5g6g7/evidence.mjs run --req G7-A01 --fixture fx-docx-report-vi --checker tester-cloud -- \\"
echo "              node scripts/office/g5g6g7/harness/document-step.mjs --run-dir $RUN_DIR"
