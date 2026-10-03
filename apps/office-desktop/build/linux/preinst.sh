#!/bin/bash
# Runs before dpkg copies any file. A refusal here aborts the install with a
# non-zero exit code, so nothing is written and no half-installed package is
# left behind. The at-placeholders are substituted by scripts/package.mjs; the
# substituted copy is what fpm embeds.
set -u

OS_RELEASE_FILE="${UNIWORK_OS_RELEASE_FILE:-/etc/os-release}"
REFUSED=1

fail() {
  echo "UniWork Office: installation refused - this system is not supported." >&2
  echo "UniWork Office: từ chối cài đặt - hệ điều hành này không được hỗ trợ." >&2
  echo "$1" >&2
  echo "Install the .AppImage instead: it runs on any x64 Linux distribution." >&2
  echo "Hãy dùng bản .AppImage: bản này chạy trên mọi bản phân phối Linux x64." >&2
  exit "$REFUSED"
}

version_at_least() {
  # GNU sort -V orders dotted versions; the smaller of the two inputs first.
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

[ -r "$OS_RELEASE_FILE" ] || fail "Cannot read ${OS_RELEASE_FILE}."

# shellcheck disable=SC1090
. "$OS_RELEASE_FILE"

case "${ID:-}" in
  ubuntu)
    version_at_least "${VERSION_ID:-0}" "22.04" || fail "Ubuntu ${VERSION_ID:-unknown} found; Ubuntu 22.04 or 24.04 (x64) is required. / Đã tìm thấy Ubuntu ${VERSION_ID:-không rõ}; cần Ubuntu 22.04 hoặc 24.04 (x64)."
    ;;
  debian)
    # Electron 44 needs glibc >= 2.31; Debian 11 (bullseye) is the first release with it.
    version_at_least "${VERSION_ID:-0}" "11" || fail "Debian ${VERSION_ID:-unknown} found; Debian 11 or newer (x64) is required. / Đã tìm thấy Debian ${VERSION_ID:-không rõ}; cần Debian 11 trở lên (x64)."
    ;;
  *)
    fail "Detected ${ID:-unknown} ${VERSION_ID:-}; the .deb package supports Ubuntu and Debian only. / Phát hiện ${ID:-không rõ} ${VERSION_ID:-}; gói .deb chỉ hỗ trợ Ubuntu và Debian."
    ;;
esac

exit 0
