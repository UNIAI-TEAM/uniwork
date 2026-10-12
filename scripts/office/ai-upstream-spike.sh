#!/usr/bin/env bash
# G6-02 spike runner (UNI-1364): one tool loop — user -> the model returns a
# tool call -> the client sends the tool result -> the model answers — through
# the openai-compatible provider in server/internal/ai/provider.
#
#   ai-upstream-spike.sh fake   no network: AI_PROVIDER=fake, SPIKE_MODE=fake
#   ai-upstream-spike.sh dev    the dev upstream (§8.4); requires
#                               OPENAI_BASE_URL, OPENAI_API_KEY and a model in
#                               SPIKE_MODEL or AI_MODEL_OFFICE_UNIWORK_AI
#
# Run from the repo root, under Git Bash or Linux. The exit code is the test's.
# This script never prints the upstream's URL, host, IP, port or key: the
# harness redacts what it emits, and nothing here echoes a value it read.
#
# A dev run is evidence, so it never overwrites an earlier one: the default
# SPIKE_OUT is ac2-dev-run-<UTC yyyymmddThhmmssZ>, a name collision bumps the
# suffix, and an explicit SPIKE_OUT that already holds a run is refused.
set -uo pipefail

usage() {
  echo "usage: $0 fake|dev   (see the header of this file)" >&2
}

# True when a run already wrote any of the three files at this base name.
spike_run_exists() {
  [ -e "$1.json" ] || [ -e "$1.txt" ] || [ -e "$1.log" ]
}

mode="${1:-}"
case "$mode" in
  fake|dev) ;;
  *) usage; exit 2 ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$repo_root" ]; then
  echo "ai-upstream-spike: run this from the repository root" >&2
  exit 2
fi

# Where the JSON + text summary and the run log land. The lane's durable run
# folder on the dev host, the same folder's VPS mirror, or a repo-local
# fallback so the script still runs on a cloud runner.
if [ -z "${SPIKE_RUN_DIR:-}" ]; then
  for candidate in \
    "$HOME/office-g5g6g7/reports/g6-ai_server" \
    "D:/.Vietants_Project/uniwork-workspace/.uniwork-dev/office-g5g6g7/reports/g6-ai_server"; do
    if [ -d "$candidate" ]; then SPIKE_RUN_DIR="$candidate"; break; fi
  done
fi
: "${SPIKE_RUN_DIR:=$repo_root/.spike-out}"
export SPIKE_RUN_DIR

export SPIKE_LOOPS="${SPIKE_LOOPS:-10}"

if [ "$mode" = fake ]; then
  # No network, and nothing that could reach one by accident.
  unset OPENAI_BASE_URL OPENAI_API_KEY
  export AI_PROVIDER=fake SPIKE_MODE=fake
  # Fake mode writes no summary by default: it would be junk in the durable run
  # folder, and the round trip it proves is asserted by the test itself.
  export SPIKE_OUT="${SPIKE_OUT:-}"
else
  missing=""
  [ -n "${OPENAI_BASE_URL:-}" ] || missing="$missing OPENAI_BASE_URL"
  [ -n "${OPENAI_API_KEY:-}" ] || missing="$missing OPENAI_API_KEY"
  if [ -z "${SPIKE_MODEL:-}" ] && [ -z "${AI_MODEL_OFFICE_UNIWORK_AI:-}" ]; then
    missing="$missing SPIKE_MODEL|AI_MODEL_OFFICE_UNIWORK_AI"
  fi
  if [ -n "$missing" ]; then
    echo "ai-upstream-spike: dev mode refuses to run; unset:$missing" >&2
    echo "  source scripts/office/ai-upstream-spike-env.sh for the base url and key," >&2
    echo "  then set the model name (GET /v1/models) in SPIKE_MODEL." >&2
    exit 2
  fi
  export AI_PROVIDER=openai SPIKE_MODE=dev
  if [ -n "${SPIKE_OUT:-}" ]; then
    # An explicit path is honoured verbatim, but never at the cost of an
    # earlier run's evidence.
    if spike_run_exists "$SPIKE_OUT"; then
      echo "ai-upstream-spike: SPIKE_OUT $SPIKE_OUT already holds a run; choose a new name" >&2
      exit 2
    fi
  else
    # Timestamped default: a bare rerun starts a new run instead of
    # overwriting ac2-dev-run-1. A collision (two starts inside one second, or
    # a leftover file) bumps the suffix until the name is free.
    SPIKE_OUT="$SPIKE_RUN_DIR/ac2-dev-run-$(date -u +%Y%m%dT%H%M%SZ)"
    n=1
    while spike_run_exists "$SPIKE_OUT"; do
      n=$((n + 1))
      SPIKE_OUT="$SPIKE_RUN_DIR/ac2-dev-run-$(date -u +%Y%m%dT%H%M%SZ)-$n"
    done
  fi
  export SPIKE_OUT
fi

mkdir -p "$SPIKE_RUN_DIR" || exit 2

cd "$repo_root/server" || exit 2
echo "ai-upstream-spike: mode=$mode loops=$SPIKE_LOOPS provider=${AI_PROVIDER}" >&2

if [ "$mode" = fake ]; then
  go test ./internal/ai/provider -run TestUpstreamSpike -v -count=1
  exit $?
fi

# Dev: keep the whole run as the AC-2 artifact. The harness redacts before it
# writes or logs, so this log holds no host and no key.
go test ./internal/ai/provider -run TestUpstreamSpike -v -count=1 >"$SPIKE_OUT.log" 2>&1
rc=$?
cat "$SPIKE_OUT.log" >&2
echo "ai-upstream-spike: log $SPIKE_OUT.log, summary $SPIKE_OUT.json" >&2
exit $rc