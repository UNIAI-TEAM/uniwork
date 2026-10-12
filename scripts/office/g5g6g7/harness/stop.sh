#!/usr/bin/env bash
# Tear down one harness run (UNI-1376, G7-01 item C). It signals exactly the
# process groups start.sh recorded in the run dir — never a process by name,
# never another run's server, and never the shared PostgreSQL/Redis the VM
# provides. start.sh starts each piece with setsid, so the recorded PID is its
# group leader and one signal reaches its children too (this is what takes down
# the Xvfb that xvfb-run started for this run, and nothing else's).
#
# Exit codes: 0 torn down (or nothing to tear down). A PID that is already gone
# is not an error; the run dir keeps its logs and artifacts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
RUN_DIR="${HARNESS_RUN_DIR:-$REPO_ROOT/.harness-run}"
PID_FILE="$RUN_DIR/pids"

if [ ! -f "$PID_FILE" ]; then
  echo "harness: no pid file at $PID_FILE; nothing to stop"
  exit 0
fi

# App, then web, then server: reverse of the start order, so the app stops
# talking to a web that is still up.
pids=()
while read -r name pid port; do
  [ -n "${pid:-}" ] || continue
  case "$name" in
    app|web|server) pids=("$pid" "${pids[@]:-}") ;;
    *) echo "harness: ignoring unknown pid line: $name $pid" >&2 ;;
  esac
done < "$PID_FILE"

signal_group() { # signal_group <signal> <pid>
  kill "-$1" "-$2" 2> /dev/null || kill "-$1" "$2" 2> /dev/null || true
}

stopped=0
for pid in "${pids[@]:-}"; do
  [ -n "$pid" ] || continue
  if kill -0 "$pid" 2> /dev/null; then
    signal_group TERM "$pid"
    stopped=$((stopped + 1))
  fi
done

# Give the groups a moment to exit, then make sure they are gone.
for _ in $(seq 1 10); do
  alive=0
  for pid in "${pids[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2> /dev/null && alive=1
  done
  [ "$alive" = 0 ] && break
  sleep 1
done
for pid in "${pids[@]:-}"; do
  [ -n "$pid" ] || continue
  kill -0 "$pid" 2> /dev/null || continue
  signal_group KILL "$pid"
done

rm -f "$PID_FILE"
echo "harness: stopped $stopped process group(s) from $RUN_DIR"
