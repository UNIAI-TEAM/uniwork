#!/usr/bin/env bash
# Ported from usf apps/mobile/scripts/ios-run.test.sh. Stubs pnpm on PATH and
# asserts the call sequence of native-run.sh, so it needs no node_modules,
# Xcode, SDK or device.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/uniwork-native-run.XXXXXX")
BIN_DIR="$TEST_DIR/bin"
CALLS_FILE="$TEST_DIR/pnpm-calls.log"

cleanup() {
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
export UNICHAT_TEST_PNPM_CALLS="$CALLS_FILE"

# Stub pnpm: record every invocation; optionally fail the prebuild.
cat >"$BIN_DIR/pnpm" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >>"$UNICHAT_TEST_PNPM_CALLS"
if [ -n "${UNICHAT_TEST_FAIL_PREBUILD:-}" ]; then
  case "$*" in
    *prebuild*) echo "stub prebuild failure" >&2; exit 1 ;;
  esac
fi
STUB
chmod +x "$BIN_DIR/pnpm"

PATH="$BIN_DIR:$PATH"
export PATH

fail() {
  echo "FAIL: $1" >&2
  echo "--- recorded calls ---" >&2
  cat "$CALLS_FILE" >&2 || true
  exit 1
}

run="$SCRIPT_DIR/native-run.sh"

# --- prebuild runs before run:<platform>, for both platforms -----------------
for platform in ios android; do
  : >"$CALLS_FILE"
  bash "$run" "$platform"
  [ "$(sed -n '1p' "$CALLS_FILE")" = "exec expo prebuild -p $platform --no-install" ] ||
    fail "$platform: first call should be the prebuild, got: $(sed -n '1p' "$CALLS_FILE")"
  [ "$(sed -n '2p' "$CALLS_FILE")" = "exec expo run:$platform" ] ||
    fail "$platform: second call should be run:$platform, got: $(sed -n '2p' "$CALLS_FILE")"
  [ "$(wc -l <"$CALLS_FILE")" -eq 2 ] || fail "$platform: expected exactly 2 calls"
done

# --- arguments forward to run:<platform> only --------------------------------
: >"$CALLS_FILE"
bash "$run" ios --device --configuration Release
[ "$(sed -n '1p' "$CALLS_FILE")" = 'exec expo prebuild -p ios --no-install' ] ||
  fail "prebuild must not receive run arguments"
[ "$(sed -n '2p' "$CALLS_FILE")" = 'exec expo run:ios --device --configuration Release' ] ||
  fail "run:ios should receive the forwarded arguments"

# --- a failed prebuild aborts before run ------------------------------------
: >"$CALLS_FILE"
set +e
UNICHAT_TEST_FAIL_PREBUILD=1 bash "$run" android >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || fail "a failed prebuild should make the wrapper exit non-zero"
grep -q 'run:android' "$CALLS_FILE" && fail "run:android must not run after a failed prebuild"

# --- an unknown or missing platform calls nothing ---------------------------
for bad in "" macos; do
  : >"$CALLS_FILE"
  set +e
  bash "$run" $bad >/dev/null 2>&1
  status=$?
  set -e
  [ "$status" -eq 2 ] || fail "platform '$bad' should exit 2, got $status"
  [ ! -s "$CALLS_FILE" ] || fail "platform '$bad' must not call pnpm"
done

echo "native-run.test.sh: all assertions passed"
