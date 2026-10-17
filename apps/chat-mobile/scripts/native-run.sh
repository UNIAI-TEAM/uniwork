#!/usr/bin/env bash
# Ported from usf apps/mobile/scripts/ios-run.sh, generalised to both platforms.
#
# Build and run the app on <ios|android>, re-applying app.config.ts first.
# `expo run:<platform>` prebuilds only when the native directory is missing;
# once it exists, config plugins are never re-applied and everything
# app.config.ts owns (icon, bundle id, name, scheme, permission strings) stays
# frozen at the first prebuild while the build still reports success. ios/ and
# android/ are gitignored and fully generated, so prebuilding every run is
# safe. --no-install: run:<platform> installs pods itself when the lockfile is
# stale. UNICHAT_* are inherited from the caller so prebuild and run agree on
# the variant. Remaining arguments go to run:<platform> only.
set -euo pipefail

platform="${1:-}"
case "$platform" in
  ios|android) shift ;;
  *)
    echo "usage: $0 <ios|android> [expo run args...]" >&2
    exit 2
    ;;
esac

pnpm exec expo prebuild -p "$platform" --no-install
exec pnpm exec expo "run:$platform" "$@"
