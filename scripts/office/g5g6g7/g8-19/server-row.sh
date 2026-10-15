#!/usr/bin/env bash
# G8-19 (UNI-1414) server-row wrapper: the Go / node checks behind the AC rows
# that have no harness step of their own (G8-A03, G8-A05, G8-A06, G8-A08), run
# the way docs/office/g5g6g7/contract-collab.md section 12 lists them, with two
# guards a bare `go test` lacks so a row cannot PASS on nothing:
#   - a `go test` that ran no passing test (every package "[no tests to run]",
#     or a pattern that matches nothing) fails;
#   - a test named by a -run pattern that was SKIPped (no database on the VM)
#     fails: the row is unverified, which is a FAIL of the round, never a PASS.
#
#   bash scripts/office/g5g6g7/g8-19/server-row.sh <G8-A03|G8-A05|G8-A06|G8-A08> [--dry-run] [--then <cmd...>]
#
# --dry-run   prints the PLAN lines (what would run) and runs nothing.
# --then      after the server checks all passed, runs <cmd...> and exits with its
#             code (a harness module exits 77 for BLOCKED); a server failure exits
#             with that failure's code and <cmd...> is not run.
# Exit: 0 all passed, 1 a check failed, 2 bad arguments, else the --then command's.
# Called by evidence.mjs run (`--checker go:g8-19/server-row.sh`) from the spec;
# the filtered output lines are what the cloud round log keeps.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"

ROW="${1:-}"
[ "$#" -eq 0 ] || shift
DRY=0
THEN=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --then) shift; THEN=("$@"); break ;;
    *) echo "server-row: unknown argument '$1'; usage: $0 <G8-A03|G8-A05|G8-A06|G8-A08> [--dry-run] [--then <cmd...>]" >&2; exit 2 ;;
  esac
done

RC=0

# step_go <strict 0|1> <go test args...>; strict = the args carry a -run pattern.
step_go() {
  local strict="$1"
  shift
  local line="go test -count=1 -v $*"
  if [ "$DRY" = 1 ]; then echo "PLAN (cd server) $line"; return 0; fi
  local log
  log="$(mktemp "${TMPDIR:-/tmp}/g819-server-row.XXXXXX")"
  (cd "$REPO_ROOT/server" && go test -count=1 -v "$@") > "$log" 2>&1
  local rc=$?
  echo "server-row: $line"
  grep -E '^(\s*--- (FAIL|SKIP)|PASS$|FAIL|ok |panic)' "$log" | tail -n 80
  if [ "$rc" -eq 0 ] && ! grep -q '^--- PASS' "$log"; then
    echo "server-row: no test passed (a pattern that matches nothing is not a PASS)"
    rc=1
  fi
  if [ "$rc" -eq 0 ] && [ "$strict" = 1 ] && grep -q '^--- SKIP' "$log"; then
    echo "server-row: a test named by -run was not run (the database or Redis is missing on this VM)"
    rc=1
  fi
  rm -f "$log"
  if [ "$rc" -ne 0 ]; then RC=1; fi
  return 0
}

step_node() {
  local line="node --test $*"
  if [ "$DRY" = 1 ]; then echo "PLAN $line"; return 0; fi
  local log
  log="$(mktemp "${TMPDIR:-/tmp}/g819-server-row.XXXXXX")"
  (cd "$REPO_ROOT" && node --test "$@") > "$log" 2>&1
  local rc=$?
  echo "server-row: $line"
  grep -E '^# (tests|pass|fail|cancelled|skipped|todo)' "$log"
  if [ "$rc" -ne 0 ]; then
    tail -n 40 "$log"
    RC=1
  fi
  rm -f "$log"
  return 0
}

case "$ROW" in
  G8-A03)
    step_go 1 ./internal/service ./internal/handler -run 'DocumentComment(Kind|Tombstone|Revision|Purge|Copy|ListToken)'
    step_go 0 ./migrations
    ;;
  G8-A05)
    step_go 1 ./internal/notification ./internal/service ./internal/mentions -run 'DocumentMention|MentionCandidates|Claim|TokenIDs'
    ;;
  G8-A06)
    step_go 1 ./internal/notification -run 'DocumentComment|Titles|Kinds'
    ;;
  G8-A08)
    step_go 1 ./internal/handler -run 'IsolationMatrix|IsolationRealtime|EveryBodyIDFieldHasAReferenceCase'
    step_go 1 ./internal/service -run 'EveryAuditedCommandWritesItsRow|ReusedAuditActionCommandsWriteTheirOwnRows'
    step_node scripts/events-catalogue.test.mjs scripts/no-pii-log.test.mjs
    ;;
  *)
    echo "server-row: unknown row '$ROW'; usage: $0 <G8-A03|G8-A05|G8-A06|G8-A08> [--dry-run] [--then <cmd...>]" >&2
    exit 2
    ;;
esac

if [ "$DRY" = 1 ]; then
  [ "${#THEN[@]}" -eq 0 ] || echo "PLAN then ${THEN[*]}"
  exit 0
fi

if [ "$RC" -ne 0 ]; then
  echo "server-row: $ROW FAILED"
  exit 1
fi
echo "server-row: $ROW server checks passed"
if [ "${#THEN[@]}" -gt 0 ]; then
  "${THEN[@]}"
  exit $?
fi
exit 0
