#!/usr/bin/env bash
# Enforce the statement-coverage ratchet in server/coverage.floor.
#
# One profile: check it. Several: merge them first. CI shards the Go suite
# across parallel jobs and each shard covers only its own packages, so the
# floor is a statement about the union and can only be read after the merge —
# a shard checking its own profile would compare a slice against the whole.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <coverprofile> [coverprofile...]" >&2
  exit 2
fi

for profile in "$@"; do
  if [ ! -f "$profile" ]; then
    echo "missing coverage profile: $profile" >&2
    exit 1
  fi
done

merged="$1"
if [ "$#" -gt 1 ]; then
  merged="${REPO_ROOT}/.go-tmp/cover-merged.out"
  mkdir -p "$(dirname "$merged")"
  : > "$merged"
  mode=""
  for profile in "$@"; do
    header="$(head -n 1 "$profile")"
    case "$header" in
      mode:*) ;;
      *) echo "$profile is not a coverage profile (no mode: header)" >&2; exit 1 ;;
    esac
    if [ -z "$mode" ]; then
      mode="$header"
      echo "$mode" >> "$merged"
    elif [ "$header" != "$mode" ]; then
      # `-race` writes mode: atomic and a plain run writes mode: set. Mixed
      # modes mean the shards did not run the same command; merging them would
      # produce a number that describes neither.
      echo "coverage profiles disagree on mode: '$mode' vs '$header' ($profile)" >&2
      exit 1
    fi
    tail -n +2 "$profile" >> "$merged"
  done
fi

cd "$REPO_ROOT/server"
total="$(go tool cover -func="$merged" | awk '/^total:/ {sub("%","",$NF); print $NF}')"
floor="$(cat coverage.floor)"
if awk -v t="$total" -v f="$floor" 'BEGIN { exit !(t < f) }'; then
  echo "coverage ${total}% is below the floor ${floor}% (server/coverage.floor)" >&2
  exit 1
fi
if awk -v t="$total" -v f="$floor" 'BEGIN { exit !(t > f + 1) }'; then
  echo "coverage ${total}% — raise server/coverage.floor from ${floor}"
fi
