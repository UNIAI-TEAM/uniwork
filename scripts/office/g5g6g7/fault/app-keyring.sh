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
#
# Control mode (G7-03b FL-09, additive; off unless APP_KEYRING_CONTROL=1): the
# command may LOCK and UNLOCK this keyring while it runs, through two FIFOs the
# script exports as APP_KEYRING_CTL (<path>.in takes one line, "lock" or
# "unlock"; <path>.out answers one line, "ok" or "fail: <why>"). The password
# stays in a variable of this script (never exported, printed or written): only
# this script can unlock the collection it created.
#
#   APP_KEYRING_CONTROL=1 dbus-run-session -- bash scripts/office/g5g6g7/fault/app-keyring.sh \
#     node scripts/office/g5g6g7/fault/app-cases.mjs --case FL-09 --run-dir .harness-run
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
CTL_PID=""
cleanup() {
  if [ -n "$CTL_PID" ]; then
    kill "$CTL_PID" 2> /dev/null || true
    wait "$CTL_PID" 2> /dev/null || true
  fi
  if [ -n "$GKD_PID" ]; then
    kill "$GKD_PID" 2> /dev/null || true
    wait "$GKD_PID" 2> /dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# NameHasOwner on the bus itself never activates a service; a call addressed to
# org.freedesktop.secrets would, and the bus would start a second, locked
# keyring that makes ours exit ("another secret service is running").
name_owned() {
  dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
    org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets 2> /dev/null | grep -q 'boolean true'
}
if name_owned; then
  echo "BLOCKED: org.freedesktop.secrets is already owned on this session bus before our keyring started; not racing it" >&2
  exit 77
fi

KEYRING_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '\n=/+')"
printf '%s' "$KEYRING_PASSWORD" | gnome-keyring-daemon --foreground --unlock --components=secrets > "$WORK/gkd.log" 2>&1 &
GKD_PID=$!
CTL_PASSWORD=""
if [ "${APP_KEYRING_CONTROL:-}" = 1 ]; then CTL_PASSWORD="$KEYRING_PASSWORD"; fi
unset KEYRING_PASSWORD

secrets_owned=no
for _ in $(seq 1 30); do
  kill -0 "$GKD_PID" 2> /dev/null || break
  if name_owned; then
    secrets_owned=yes
    break
  fi
  sleep 0.5
done
unlocked=no
if [ "$secrets_owned" = yes ] && kill -0 "$GKD_PID" 2> /dev/null \
  && dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets/aliases/default \
    org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked 2> /dev/null | grep -q 'boolean false'; then
  unlocked=yes
fi
echo "APP_KEYRING unlocked=$unlocked"
if [ "$unlocked" != yes ]; then
  echo "BLOCKED: the keyring daemon did not come up unlocked; its log tail:" >&2
  tail -n 10 "$WORK/gkd.log" >&2 || true
  exit 77
fi

# the real object path of the default collection (the alias path is not what Lock takes)
default_collection() {
  dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets \
    org.freedesktop.Secret.Service.ReadAlias string:default 2> /dev/null | sed -n 's/.*object path "\(.*\)".*/\1/p'
}
collection_locked() {
  dbus-send --session --print-reply --dest=org.freedesktop.secrets "$1" \
    org.freedesktop.DBus.Properties.Get string:org.freedesktop.Secret.Collection string:Locked 2> /dev/null | sed -n 's/.*boolean \(true\|false\).*/\1/p'
}
keyring_ctl_loop() {
  while true; do
    cmd=""
    read -r cmd < "$WORK/ctl.in" || true
    [ -n "$cmd" ] || continue
    coll="$(default_collection)"
    reply="fail: no default collection on the secrets service"
    if [ -n "$coll" ]; then
      case "$cmd" in
        lock)
          dbus-send --session --print-reply --dest=org.freedesktop.secrets /org/freedesktop/secrets \
            org.freedesktop.Secret.Service.Lock "array:objpath:$coll" > /dev/null 2>&1 || true
          if [ "$(collection_locked "$coll")" = true ]; then reply=ok; else reply="fail: the collection is still unlocked after Lock"; fi
          ;;
        unlock)
          printf '%s' "$CTL_PASSWORD" | GNOME_KEYRING_CONTROL="$XDG_RUNTIME_DIR/keyring" gnome-keyring-daemon --unlock > /dev/null 2>&1 || true
          if [ "$(collection_locked "$coll")" = false ]; then reply=ok; else reply="fail: the collection is still locked after unlock"; fi
          ;;
        *) reply="fail: unknown command" ;;
      esac
    fi
    printf '%s\n' "$reply" > "$WORK/ctl.out"
  done
}
if [ "${APP_KEYRING_CONTROL:-}" = 1 ]; then
  mkfifo "$WORK/ctl.in" "$WORK/ctl.out"
  export APP_KEYRING_CTL="$WORK/ctl"
  keyring_ctl_loop &
  CTL_PID=$!
  echo "APP_KEYRING control=on"
fi

"$@"
rc=$?
echo "APP_CASES_EXIT=$rc"
exit "$rc"
