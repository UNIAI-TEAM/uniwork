#!/usr/bin/env bash
# Rebuild every brand asset from scripts/brand/geometry.py.
#
# Needs python3 with fonttools (`pip install fonttools`) and, for the wordmark,
# Inter SemiBold as a .ttf. The wordmark is regenerated only when INTER_TTF
# points at that file — the outlines are already committed, so a mark-only
# change does not need the font.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> mark"
python3 scripts/brand/build-svg.py

if [ -n "${INTER_TTF:-}" ]; then
  echo "==> wordmark + lockups (Inter: $INTER_TTF)"
  node scripts/brand/measure-text.mjs "$INTER_TTF" UniWork -0.02 > /tmp/uniwork-wordmark-metrics.json
  python3 scripts/brand/build-wordmark.py "$INTER_TTF" /tmp/uniwork-wordmark-metrics.json
else
  echo "==> wordmark: skipped (set INTER_TTF to regenerate; see packages/ui/brand/README.md)"
fi

echo "==> rasters"
node scripts/brand/build-assets.mjs

echo "==> squeeze"
python3 scripts/brand/squeeze.py
