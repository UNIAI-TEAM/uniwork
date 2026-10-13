#!/usr/bin/env bash
# Headless-keyring spike (UNI-1376, g7-qa): runs INSIDE a private D-Bus session,
#
#   dbus-run-session -- bash scripts/office/g5g6g7/harness/keyring-session.sh
#
# 1. starts gnome-keyring-daemon (secrets component only), unlocked with a
#    throwaway password generated here from /dev/urandom. The password lives in
#    a shell variable and one pipe: it is never echoed, never written to a file
#    and never on a command line (so not in `ps`, a log or the spec text).
#    The keyring's storage and control socket live in a scratch dir of this run
#    (XDG_DATA_HOME / XDG_RUNTIME_DIR), so a warm VM's older keyring can neither
#    interfere nor be touched.
# 2. KEYRING_RT: a secret-tool store -> lookup round trip of a random value
#    (prints `match=yes|no`, never the value).
# 3. SAFESTORAGE: the fork's Electron + its credential store (keyring-probe.mjs)
#    under xvfb-run, in this same session; one JSON line. Expect backend
#    gnome_libsecret, roundTrip ok, status ready.
# 4. two informational variants that say what the app itself would need:
#    SAFESTORAGE_NODESKTOP (no XDG_CURRENT_DESKTOP, which is what the harness
#    app's allow-listed environment has when the VM exports none) and
#    SAFESTORAGE_FORCED (--password-store=gnome-libsecret, no desktop name).
#
# Marker lines: KEYRING_DAEMON, KEYRING_RT, SAFESTORAGE[_NODESKTOP|_FORCED]
# (the probe's JSON) each followed by its `<MARKER>_EXIT=<code>`. Exit: 0 when
# the daemon is up, the round trip matched and SAFESTORAGE passed; else 1
# (2 = not run in a D-Bus session, 77 = a tool is missing, i.e. BLOCKED).
# The daemon is stopped by PID and the scratch dir removed on exit.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$HERE/keyring-probe.mjs"

[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || { echo "keyring-session: no D-Bus session bus; run it as: dbus-run-session -- bash $0" >&2; exit 2; }
for tool in gnome-keyring-daemon secret-tool xvfb-run dbus-send node; do
  command -v "$tool" > /dev/null 2>&1 || { echo "BLOCKED: keyring-session needs $tool (KEYRING_APT did not install it)" >&2; exit 77; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/keyring-spike.XXXXXX")"
chmod 700 "$WORK"
export XDG_DATA_HOME="$WORK/data" XDG_RUNTIME_DIR="$WORK/run"
mkdir -p -m 700 "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR"
GKD_PID=""
cleanup() {
  if [ -n "$GKD_PID" ]; then
    kill "$GKD_PID" 2> /dev/null || true
    wait "$GKD_PID" 2> /dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

overall=0

# ---- the daemon ---------------------------------------------------------------
# `--foreground` keeps the PID of the daemon ours to stop; `--unlock` reads the
# password from stdin and creates + unlocks the login keyring (a fresh data dir has none).
KEYRING_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '\n=/+')"
printf '%s' "$KEYRING_PASSWORD" | gnome-keyring-daemon --foreground --unlock --components=secrets > "$WORK/gkd.log" 2>&1 &
GKD_PID=$!
unset KEYRING_PASSWORD
secrets_owned=no
for _ in $(seq 1 30); do
  if dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets 2> /dev/null | grep -q 'boolean true'; then
    secrets_owned=yes
    break
  fi
  kill -0 "$GKD_PID" 2> /dev/null || break
  sleep 0.5
done
unlocked=no
if [ "$secrets_owned" = yes ] \
  && dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets/aliases/default org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked 2> /dev/null | grep -q 'boolean false'; then
  unlocked=yes
fi
echo "KEYRING_DAEMON secrets=$secrets_owned unlocked=$unlocked"
if [ "$unlocked" != yes ]; then
  echo "keyring-session: the daemon did not come up unlocked; its log tail:" >&2
  tail -n 10 "$WORK/gkd.log" >&2 || true
  overall=1
fi

# ---- KEYRING_RT: secret-tool store -> lookup ----------------------------------
rt_value="$(head -c 18 /dev/urandom | base64 | tr -d '\n=/+')"
match=no
if printf '%s' "$rt_value" | timeout 20 secret-tool store --label='uniwork keyring spike' service uniwork-keyring-spike probe round-trip > /dev/null 2>&1; then
  got="$(timeout 20 secret-tool lookup service uniwork-keyring-spike probe round-trip 2> /dev/null || true)"
  [ -n "$got" ] && [ "$got" = "$rt_value" ] && match=yes
  unset got
fi
timeout 20 secret-tool clear service uniwork-keyring-spike probe round-trip > /dev/null 2>&1 || true
unset rt_value
echo "KEYRING_RT match=$match"
[ "$match" = yes ] || overall=1
echo "KEYRING_RT_EXIT=$([ "$match" = yes ] && echo 0 || echo 1)"

# ---- SAFESTORAGE: the app's own credential store under xvfb, same session -------
run_probe() { # run_probe <label> [probe args...]
  local label=$1 rc
  shift
  xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" node "$PROBE" --label "$label" "$@"
  rc=$?
  echo "${label}_EXIT=$rc"
  return "$rc"
}
run_probe SAFESTORAGE --expect ready || overall=1
run_probe SAFESTORAGE_NODESKTOP --xdg-current-desktop none || true
run_probe SAFESTORAGE_FORCED --xdg-current-desktop none --password-store gnome-libsecret || true

exit "$overall"
