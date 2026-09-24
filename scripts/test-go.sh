#!/usr/bin/env bash
# Run the Go suite with the test databases it expects. TEST_DATABASE_URL and
# REDIS_TEST_URL come from the env file (or local-env.sh defaults); the
# Redis-backed tests skip themselves when REDIS_TEST_URL is unset, so they
# never fail a machine without Redis — but with the compose stack up they run.
#
# CI shards the suite across parallel jobs, one database each: internal/testutil
# serialises every DB test behind one advisory lock, so two packages sharing a
# database take the sum of their times, never the max. --shard picks the slice,
# --skip-static leaves gofmt/vet/staticcheck to the shard that owns them, and
# --skip-floor leaves the coverage ratchet to the job that merges the profiles
# (scripts/go-cover-floor.sh). Locally none of that applies: no flags means the
# whole suite, static checks and floor included.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

# shellcheck disable=SC1091
. "$SCRIPT_DIR/local-env.sh"

cover_out="${UNIWORK_GO_COVER_OUT:-${REPO_ROOT}/.go-tmp/cover.out}"
mkdir -p "$(dirname "$cover_out")"

usage() { echo "usage: $0 [--race] [--shard=all|service|handler|rest] [--skip-static] [--skip-floor]" >&2; }

go_test_args=(test -count=1 -timeout 30m)
race_requested=false
shard=all
run_static=true
check_floor=true

for arg in "$@"; do
  case "$arg" in
    --race) race_requested=true ;;
    --shard=*) shard="${arg#--shard=}" ;;
    --skip-static) run_static=false ;;
    --skip-floor) check_floor=false ;;
    *) usage; exit 2 ;;
  esac
done

case "$shard" in
  all|service|handler|rest) ;;
  *) echo "unknown shard: $shard" >&2; usage; exit 2 ;;
esac

if [ "$race_requested" = true ]; then
  # The race detector needs cgo. Linux/macOS CI has it; Windows often ships with
  # CGO_ENABLED=0 until a C toolchain (gcc/clang) is present.
  export CGO_ENABLED=1
fi

cd "$REPO_ROOT/server"

if [ "$race_requested" = true ]; then
  if go test -race -run=^$ -count=1 ./internal/config >/dev/null 2>&1; then
    go_test_args+=(-race)
  else
    echo "note: skipping -race — needs CGO and a C compiler (gcc/clang)" >&2
    echo "      CI still runs go test -race on Linux; this machine runs the full Go suite without it." >&2
  fi
fi

# sqlc output, thin cmd mains and the shared test DB harness are excluded from
# the coverage denominator — they are not hand-written product code (generated
# is never executed line-by-line in tests; mains are covered via integration).
list_cover_packages() {
  go list ./... | grep -vE '/pkg/db/generated$|/cmd/(migrate|seed|uniwork-admin)$|/internal/testutil$'
}

# The union of service, handler and rest matches list_cover_packages, so a
# sharded run and a whole run share the same coverage denominator.
shard_packages() {
  case "$shard" in
    all) list_cover_packages ;;
    service) go list ./internal/service/... ;;
    handler) go list ./internal/handler/... ;;
    rest) list_cover_packages | grep -vE '/internal/(service|handler)(/|$)' ;;
  esac
}

pkg_list="$(shard_packages)"
if [ -z "$pkg_list" ]; then
  echo "shard '$shard' matched no packages" >&2
  exit 1
fi
pkgs=()
while IFS= read -r pkg; do
  if [ -n "$pkg" ]; then pkgs+=("$pkg"); fi
done <<EOF
$pkg_list
EOF

if [ "$run_static" = true ]; then
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
fi

go "${go_test_args[@]}" -coverprofile="$cover_out" "${pkgs[@]}"

if [ "$check_floor" = true ]; then
  bash "$SCRIPT_DIR/go-cover-floor.sh" "$cover_out"
fi
