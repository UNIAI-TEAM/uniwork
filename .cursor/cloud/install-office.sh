#!/usr/bin/env bash
# First-use install on a cloud runner VM for UNIAI-TEAM/uniwork-office
# (run-tests.sh --profile office): provision-office.sh, `npm ci` without the
# Electron binary (run-tests.sh fetches it when a spec drives the shell), and
# Playwright Chromium with its system libraries (the same libraries Electron
# needs). Acts on the current git checkout. Idempotent.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)"

bash "$here/provision-office.sh"
export PATH=$HOME/.cargo/bin:$PATH

ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci

# The repository's own Playwright version; install-deps escalates with sudo itself.
npx playwright install-deps chromium
npx playwright install chromium

echo "cloud install (office): done"
