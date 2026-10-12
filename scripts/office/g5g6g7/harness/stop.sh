#!/usr/bin/env bash
# Tear down one harness run (UNI-1376, G7-01 item C). It kills exactly the PIDs
# start.sh recorded in the run dir — never a process by name, never another
# run's server, and never the shared PostgreSQL/Redis the VM provides.
#
# Exit codes: 0 torn down (or nothing to tear down), 1 the pid file could not be
# read. A PID that is already gone is not an error.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
RUN_DIR="${HARNESS_RUN_DIR:-$REPO_ROOT/.harness-run}"
PID_FILE="$RUN_DIR/pids"

if [ ! -f "$PID_FILE" ]; then
  echo "harness: no pid file at $PID_FILE; nothing to stop"
  exit 0
fi

# Children first (the app, the web, then the server), and by process group so a
# `go build`/Next child that forked is not left behind. start.sh puts every
# process in its own group with setsid, so -PID is that group.
stopped=0
while read -r name pid port; do
  [ -n "${pid:-}" ] || continue
  case "$name" in app|web|server) ;; *) echo "harness: ignoring unknown pid line: $name $pid" >&2; continue ;; esac
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "-$pid" 2> /dev/null || kill -TERM "$pid" 2> /dev/null || true
    stopped=$((stopped + 1))
  fi
done < <(tac "$PID_FILE")

# Give the group a moment, then make sure it is gone. Only PIDs we started.
for _ in $(seq 1 10); do
  alive=0
  while read -r name pid port; do
    [ -n "${pid:-}" ] || continue
    kill -0 "$pid" 2>/dev/null && alive=1
  done < "$PID_FILE"
  [ "$alive" = 0 ] && break
  sleep 1
done
while read -r name pid port; do
  [ -n "${pid:-}" ] || continue
  kill -0 "$pid" 2>/dev/null || continue
  kill -KILL "-$pid" 2> /dev/null || kill -KILL "$pid" 2> /dev/null || true
done < "$PID_FILE"

# An xvfb-run wrapper leaves the Xvfb it started when it is killed directly;
# it only cleans up on its own exit. Kill the recorded display's server by
# looking at what this run started, never by name across the machine.
if [ -f "$RUN_DIR/display" ]; then
  display="$(cat "$RUN_DIR/display")"
  if [ -n "$display" ] && command -v pgrep > /dev/null 2>&1; then
    for pid in $(pgrep -f "Xvfb $display" 2> /dev/null || true); do
      kill -TERM "$pid" 2> /dev/null || true
    done
  fi
fi

rm -f "$PID_FILE"
echo "harness: stopped $stopped process(es) from $RUN_DIR"
