#!/usr/bin/env bash
# Rebuild every brand asset from scripts/brand/geometry.py.
#
# Needs python3 with fonttools (`pip install fonttools`) and, for the wordmark
# and the link-preview cards, Plus Jakarta Sans as a .ttf (the variable font
# from Google Fonts is fine; it is instanced per weight). Both are regenerated
# only when BRAND_FONT_TTF points at that file — their output is committed, so
# a mark-only change does not need the font, and the lock test says when one
# does.
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "==> mark"
python3 scripts/brand/build-svg.py

if [ -n "${BRAND_FONT_TTF:-}" ]; then
  echo "==> wordmark + lockups (Plus Jakarta Sans: $BRAND_FONT_TTF)"
  # The browser measures a variable font at its default weight, so measure a
  # static ExtraBold instance: the advances must be the ones that get drawn.
  python3 -c 'import sys; from fontTools.ttLib import TTFont; from fontTools.varLib import instancer
f = TTFont(sys.argv[1])
(instancer.instantiateVariableFont(f, {"wght": 800}) if "fvar" in f else f).save(sys.argv[2])' "$BRAND_FONT_TTF" "$tmp/font.ttf"
  node scripts/brand/measure-text.mjs "$tmp/font.ttf" uni 0 > "$tmp/uni.json"
  node scripts/brand/measure-text.mjs "$tmp/font.ttf" ork 0 > "$tmp/ork.json"
  python3 scripts/brand/build-wordmark.py "$tmp/font.ttf" "$tmp/uni.json" "$tmp/ork.json"
  # The link-preview cards set type in the same face; static instances for the
  # same reason as above.
  mkdir -p "$tmp/og"
  python3 -c 'import sys; from fontTools.ttLib import TTFont; from fontTools.varLib import instancer
for w in (500, 600, 700, 800):
    f = TTFont(sys.argv[1])
    (instancer.instantiateVariableFont(f, {"wght": w}) if "fvar" in f else f).save(f"{sys.argv[2]}/{w}.ttf")' "$BRAND_FONT_TTF" "$tmp/og"
  export BRAND_OG_FONT_DIR="$tmp/og"
else
  echo "==> wordmark + link-preview cards: skipped (set BRAND_FONT_TTF to regenerate; see packages/ui/brand/README.md)"
fi

echo "==> rasters"
node scripts/brand/build-assets.mjs

echo "==> squeeze"
python3 scripts/brand/squeeze.py
