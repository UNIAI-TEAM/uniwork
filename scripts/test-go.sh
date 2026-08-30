#!/usr/bin/env bash
# Run the Go suite with the test databases it expects. TEST_DATABASE_URL and
# REDIS_TEST_URL come from the env file (or local-env.sh defaults); the
# Redis-backed tests skip themselves when REDIS_TEST_URL is unset, so they
# never fail a machine without Redis — but with the compose stack up they run.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

usage() { echo "usage: $0 [--race]" >&2; }

go_test_args=(test -count=1)
case "$#" in
  0) ;;
  1)
    if [ "$1" != "--race" ]; then usage; exit 2; fi
    go_test_args+=(-race)
    ;;
  *) usage; exit 2 ;;
esac

# shellcheck disable=SC1091
. "$SCRIPT_DIR/local-env.sh"

cd "$REPO_ROOT/server"
gofmt_out="$(gofmt -l .)"
if [ -n "$gofmt_out" ]; then
  echo "gofmt: these files are not formatted:" >&2
  echo "$gofmt_out" >&2
  exit 1
fi
go vet ./...
# staticcheck is pinned as a module tool (go.mod `tool` directive), so this
# runs the same version everywhere without a separate install step.
go tool staticcheck ./...
# Coverage ratchet. server/coverage.floor holds the statement coverage the
# suite had when the floor was last raised; a run below it fails, a run above
# it prints the new number so the author can commit the higher floor.
go "${go_test_args[@]}" -coverprofile=/tmp/uniwork-go-cover.out ./...
total="$(go tool cover -func=/tmp/uniwork-go-cover.out | awk '/^total:/ {sub("%","",$NF); print $NF}')"
floor="$(cat coverage.floor)"
if awk -v t="$total" -v f="$floor" 'BEGIN { exit !(t < f) }'; then
  echo "coverage ${total}% is below the floor ${floor}% (server/coverage.floor)" >&2
  exit 1
fi
if awk -v t="$total" -v f="$floor" 'BEGIN { exit !(t > f + 1) }'; then
  echo "coverage ${total}% — raise server/coverage.floor from ${floor}"
fi
