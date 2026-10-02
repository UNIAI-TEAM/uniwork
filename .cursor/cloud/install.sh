#!/usr/bin/env bash
# Cursor cloud agent "install" step: runs while Cursor builds the snapshot and
# again on later builds over the saved disk, so every step is idempotent.
# Only disk state survives into an agent run; services start in start.sh.
# Works on any branch: it acts on the current git checkout and reads its
# helpers from its own directory (which may be a copy outside the repo, see
# README.md).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$(git rev-parse --show-toplevel)"

bash "$here/provision.sh"
export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH

bash "$here/write-env.sh"

pnpm install --frozen-lockfile

(cd server && go mod download && go build ./...)

pnpm --filter @uniwork/e2e exec playwright install chromium

echo "cloud install: done"
