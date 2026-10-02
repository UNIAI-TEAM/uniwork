#!/usr/bin/env bash
# Cursor Cloud Agent "install" step: runs while Cursor builds the snapshot and
# again on later builds over the saved disk, so every step is idempotent.
# Only disk state survives into an agent run; services start in start.sh.
set -euo pipefail

cd "$(dirname "$0")/../.."

# .env = the documented defaults plus the cloud overrides; regenerated each
# build so a change to either file reaches the next snapshot.
bash .cursor/cloud/write-env.sh

pnpm install --frozen-lockfile

(cd server && go mod download && go build ./...)

pnpm --filter @uniwork/e2e exec playwright install chromium

echo "cloud install: done"
