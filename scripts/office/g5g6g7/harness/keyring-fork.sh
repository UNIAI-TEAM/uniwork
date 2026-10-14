#!/usr/bin/env bash
# Headless-keyring spike (UNI-1376, g7-qa): make the fork checkout the probe
# reads, WITHOUT starting the D stack. It mirrors the fork steps of start.sh
# (same cache dir, same OFFICE_FORK_SHA, same readiness test), so a later
# start.sh run on the same VM reuses the checkout and only has to build it:
#
#   clone -> checkout --detach <sha> -> npm ci --ignore-scripts
#     -> the Electron binary (node_modules/electron/install.js)
#     -> esbuild's platform binary (repair) -> the Electron runtime libraries
#
# The probe itself needs only the fork's Electron binary, esbuild and the
# credentials.ts source: no `npm run build:all` (the slow step) happens here.
# Prints `KEYRING_FORK dir=<path> sha=<short>` on success.
#
# Exit: 0 ready, 1 a step failed (a harness bug), 77 BLOCKED (no network, no
# Node >= 22.12, a library set that cannot be installed).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKED_EXIT=77
FORK_SHA="${OFFICE_FORK_SHA:-0d03b18}"
FORK_REMOTE="${OFFICE_FORK_REMOTE:-https://github.com/UNIAI-TEAM/uniwork-office}"
FORK_CACHE="${OFFICE_FORK_CACHE:-$HOME/.cache/uniwork-office-harness}"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/keyring-fork.XXXXXX")"
trap 'rm -rf "$LOG_DIR"' EXIT

blocked() { echo "BLOCKED: $1" >&2; echo "  fix: $2" >&2; exit "$BLOCKED_EXIT"; }
fail() { echo "FAILED: $1" >&2; exit 1; }
tail_log() { echo "keyring-fork: ---- last 40 lines of $1 ----" >&2; tail -n 40 "$1" >&2 2> /dev/null || true; }

# Node 22 for every fork step (electron 43 pins engines.node >= 22.12.0): nvm's 22 when it
# has one, else the ambient node when it satisfies the engine (start.sh does the same).
node_engine_ok() {
  [ -x "$1" ] || return 1
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}
NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
NVM_NODE=""
if [ -s "$NVM_SH" ]; then
  NVM_NODE="$(bash -c 'set +u; . "$1" > /dev/null 2>&1 || exit 1; nvm which 22 2> /dev/null' _ "$NVM_SH" || true)"
fi
if [ -n "$NVM_NODE" ] && node_engine_ok "$NVM_NODE"; then
  PATH="$(dirname "$NVM_NODE"):$PATH"
  export PATH
elif ! node_engine_ok "$(command -v node || true)"; then
  blocked "no Node >= 22.12 on this VM" "install Node 22 (nvm install 22)"
fi
for tool in git npm curl; do
  command -v "$tool" > /dev/null 2>&1 || blocked "missing tool: $tool" "provision the cloud VM"
done

FORK_DIR="$(node "$HERE/lib.mjs" --fork-dir "$FORK_CACHE" "$FORK_SHA")" || fail "lib.mjs could not resolve the fork cache dir"
[ -n "$FORK_DIR" ] || fail "lib.mjs returned an empty fork cache dir"
mkdir -p "$FORK_CACHE"
fork_network_ok() { curl -sf -o /dev/null --max-time 20 "$FORK_REMOTE/info/refs?service=git-upload-pack"; }

if [ ! -d "$FORK_DIR/.git" ]; then
  echo "keyring-fork: cloning the fork at $FORK_SHA..."
  rm -rf "$FORK_DIR.staging"
  if ! git clone -q "$FORK_REMOTE" "$FORK_DIR.staging" > "$LOG_DIR/clone.log" 2>&1; then
    tail_log "$LOG_DIR/clone.log"
    if fork_network_ok; then fail "git clone $FORK_REMOTE failed although the fork answers"; fi
    blocked "could not clone $FORK_REMOTE" "give the VM network access to the fork, or pre-clone it at OFFICE_FORK_CACHE"
  fi
  mv "$FORK_DIR.staging" "$FORK_DIR"
fi
if ! git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null; then
  git -C "$FORK_DIR" fetch -q origin > "$LOG_DIR/fetch.log" 2>&1 || true
fi
git -C "$FORK_DIR" cat-file -e "$FORK_SHA^{commit}" 2> /dev/null || fail "the fork has no commit $FORK_SHA (check OFFICE_FORK_SHA)"
git -C "$FORK_DIR" checkout -q --detach "$FORK_SHA"

tree_ready() {
  [ -f "$FORK_DIR/node_modules/electron/install.js" ] && [ -x "$FORK_DIR/node_modules/.bin/esbuild" ] \
    && "$FORK_DIR/node_modules/.bin/esbuild" --version > /dev/null 2>&1
}
if ! tree_ready; then
  fork_network_ok || blocked "no network to $FORK_REMOTE" "give the VM network access, or pre-install the fork at OFFICE_FORK_CACHE"
  echo "keyring-fork: npm ci in the fork (--ignore-scripts; no Electron binary yet)..."
  (cd "$FORK_DIR" && npm ci --ignore-scripts) > "$LOG_DIR/npm-ci.log" 2>&1 || { tail_log "$LOG_DIR/npm-ci.log"; fail "npm ci --ignore-scripts failed in the fork"; }
  [ -f "$FORK_DIR/node_modules/electron/install.js" ] || fail "the fork install left no node_modules/electron/install.js"
fi
# electron 43 downloads its binary only through install.js (the skip flag is inert), so it is fetched here.
for d in "$FORK_DIR/node_modules/electron" "$FORK_DIR/apps/shell/node_modules/electron"; do
  [ -f "$d/install.js" ] || continue
  if [ -f "$d/path.txt" ] && [ -x "$d/dist/electron" ]; then continue; fi
  echo "keyring-fork: fetching the Electron binary..."
  (cd "$d/.." && node "$d/install.js") > "$LOG_DIR/electron.log" 2>&1 || { tail_log "$LOG_DIR/electron.log"; fail "the Electron binary could not be downloaded"; }
done
if ! "$FORK_DIR/node_modules/.bin/esbuild" --version > /dev/null 2>&1 && [ -f "$FORK_DIR/node_modules/esbuild/install.js" ]; then
  (cd "$FORK_DIR" && node node_modules/esbuild/install.js) > "$LOG_DIR/esbuild.log" 2>&1 || { tail_log "$LOG_DIR/esbuild.log"; fail "esbuild's install.js failed in the fork"; }
fi

# The Electron runtime libraries: the main process loads them even with no window. Same check
# and the same install paths as start.sh (npx playwright install-deps first, an explicit list second).
APT=""
if [ "$(id -u)" -eq 0 ]; then APT="apt-get"
elif command -v sudo > /dev/null 2>&1 && sudo -n true 2> /dev/null; then APT="sudo apt-get"; fi
LIBCACHE="$(ldconfig -p 2> /dev/null || true)"
libs_missing=()
for lib in libnss3.so libatk-1.0.so.0 libgbm.so.1 libasound.so.2 libcups.so.2; do
  case "$LIBCACHE" in *"$lib"*) ;; *) libs_missing+=("$lib") ;; esac
done
if [ "${#libs_missing[@]}" -gt 0 ]; then
  echo "keyring-fork: the Electron runtime libraries are missing (${libs_missing[*]}); installing them..."
  if ! (cd /tmp && npx --yes --package="playwright@1.62.1" -- playwright install-deps chromium) > "$LOG_DIR/libs.log" 2>&1; then
    [ -n "$APT" ] || blocked "the Electron runtime libraries are missing and apt is not usable" "run as root or with passwordless sudo"
    # shellcheck disable=SC2086
    { $APT update -q && $APT install -y -q --no-install-recommends libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 libcups2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 libdrm2; } > "$LOG_DIR/libs.log" 2>&1 \
      || { tail_log "$LOG_DIR/libs.log"; blocked "the Electron runtime libraries could not be installed: ${libs_missing[*]}" "see the log tail above"; }
  fi
fi

echo "KEYRING_FORK dir=$FORK_DIR sha=$(git -C "$FORK_DIR" rev-parse --short HEAD)"
