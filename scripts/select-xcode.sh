#!/usr/bin/env bash
# Selects the Xcode the UniChat iOS builds use (.github/workflows/mobile-verify.yml
# › ios-release, chat-mobile-verify.yml › ios): the release named by the
# version given, `27.0` → /Applications/Xcode_27.0.app, or its newest patch
# (Xcode_27.0.1.app). Never a beta or a release candidate, never another
# minor: a runner image that adds a newer Xcode must not change what the build
# compiles with. Fails, listing what the image has, when the version is absent:
# bump XCODE_VERSION in both workflows in one PR.
#
#   scripts/select-xcode.sh 27.0
#   XCODE_APPS_DIR=/tmp/apps XCODE_SELECT_DRY_RUN=1 scripts/select-xcode.sh 27.0   (tests)
set -euo pipefail

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+$ ]]; then
  echo "::error::select-xcode.sh needs a MAJOR.MINOR version such as 27.0, got '$version'"
  exit 2
fi
apps="${XCODE_APPS_DIR:-/Applications}"

chosen=""
for app in "$apps"/Xcode_*.app; do
  [ -e "$app" ] || continue
  name="$(basename "$app" .app)"
  name="${name#Xcode_}"
  # Exactly the version, or one of its patches: 27.0, 27.0.1. Not 27.01, 27.0_beta, 27.0-RC.
  if [ "$name" = "$version" ] || [[ "$name" =~ ^${version//./\\.}\.[0-9]+$ ]]; then
    chosen="$(printf '%s\n%s\n' "$chosen" "$name" | sed '/^$/d' | sort -V | tail -1)"
  fi
done

if [ -z "$chosen" ]; then
  echo "::error::Xcode $version is not on this runner image. It has: $(ls -d "$apps"/Xcode_*.app 2>/dev/null | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
  exit 1
fi

path="$apps/Xcode_$chosen.app"
if [ -n "${XCODE_SELECT_DRY_RUN:-}" ]; then
  echo "$path"
  exit 0
fi
sudo xcode-select -s "$path"
xcodebuild -version
