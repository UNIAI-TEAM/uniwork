#!/usr/bin/env bash
# `turbo lint`, with the failure downgraded to a warning at GATE_LEVEL=fast.
#
# The findings are printed either way — this only decides whether they stop the
# run. docs/adr/0014-coverage-va-lint-la-canh-bao-o-gate-level-fast.md carries
# the reason and the cost. Above fast a lint error fails the run as before.
set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/gate-level.sh"

pnpm exec turbo lint "$@"
rc=$?
if [ "$rc" -ne 0 ] && [ "$GATE_LEVEL" = fast ]; then
  echo ""
  echo "lint: reported, not enforced — GATE_LEVEL=fast (docs/adr/0014)."
  echo "      Every finding above is real and fails the run at standard."
  exit 0
fi
exit "$rc"
