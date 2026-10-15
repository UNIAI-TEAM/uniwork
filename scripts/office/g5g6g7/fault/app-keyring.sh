#!/usr/bin/env bash
# Runs a command (the app-layer fault runner) with an unlocked OS keyring, so
# the fork app it launches can keep its desktop session (UNI-1380, WI-4). The
# fork refuses safeStorage's basic_text backend (credentials.ts), and a cloud
# VM has no desktop session: this is the harness's keyring-session.sh recipe
# (README › Headless keyring) around one command instead of the probes.
#
#   dbus-run-session -- bash scripts/office/g5g6g7/fault/app-keyring.sh \
#     node scripts/office/g5g6g7/fault/app-cases.mjs --run-dir .harness-run
#
# The keyring password is random per run, lives in one variable and one pipe,
# and is never printed or written. The daemon and its scratch dir are this
# script's own and go when it ends. Exit: the command's own code; 77 when the
# keyring cannot be brought up (BLOCKED, never a pass).
set -u
[ "$#" -gt 0 ] || { echo "usage: dbus-run-session -- bash $0 <command> [args...]" >&2; exit 2; }
[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || { echo "BLOCKED: no D-Bus session bus; run it as: dbus-run-session -- bash $0 ..." >&2; exit 77; }
for tool in gnome-keyring-daemon dbus-send; do
  command -v "$tool" > /dev/null 2>&1 || { echo "BLOCKED: app-keyring needs $tool (apt-get install -y gnome-keyring dbus-x11)" >&2; exit 77; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/fault-keyring.XXXXXX")"
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

KEYRING_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '\n=/+')"
printf '%s' "$KEYRING_PASSWORD" | gnome-keyring-daemon --foreground --unlock --components=secrets > "$WORK/gkd.log" 2>&1 &
GKD_PID=$!
unset KEYRING_PASSWORD

unlocked=no
for _ in $(seq 1 30); do
  if dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets/aliases/default \
      org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked 2> /dev/null | grep -q 'boolean false'; then
    unlocked=yes
    break
  fi
  kill -0 "$GKD_PID" 2> /dev/null || break
  sleep 0.5
done
echo "APP_KEYRING unlocked=$unlocked"
if [ "$unlocked" != yes ]; then
  echo "BLOCKED: the keyring daemon did not come up unlocked; its log tail:" >&2
  tail -n 10 "$WORK/gkd.log" >&2 || true
  exit 77
fi

"$@"
rc=$?
echo "APP_CASES_EXIT=$rc"
exit "$rc"
