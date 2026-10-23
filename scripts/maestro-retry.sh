#!/usr/bin/env bash
# Runs `maestro <args>`, and once more if it fails, for the device runs in
# .github/workflows/mobile-verify.yml and chat-mobile-verify.yml. An emulator
# or simulator that boots slowly, or a staging round trip that times out,
# turns one run red without anything being wrong with the app; a flow that
# fails twice is red. A pass on the second attempt is never silent: it is a
# workflow warning and a line in the step summary, so a flow that keeps
# needing the retry is seen and fixed instead of hiding a real intermittent
# crash.
#
#   scripts/maestro-retry.sh test flows/smoke-launch.yaml
#   MAESTRO_ATTEMPTS=1 scripts/maestro-retry.sh test …   (no retry)
#   MAESTRO_LOGCAT=/tmp/logcat.txt scripts/maestro-retry.sh test …
#
# With MAESTRO_LOGCAT set (an Android run), a flow that fails for good appends
# the device's log (`adb logcat -d`) to that file: a JavaScript error an error
# boundary caught leaves only its fallback in the screenshots, and the error
# itself only in logcat (ReactNativeJS). The emulator is gone once the job's
# emulator step ends, so the dump has to happen here.
#
# With MAESTRO_ADB_REVERSE set to ports ("3000 8080", an Android run against
# servers on the runner), every attempt first maps them again with `adb
# reverse`: a failed attempt can restart Maestro's driver and adbd with it,
# which drops the mappings, and the retry then finds localhost refused.
set -u

attempts="${MAESTRO_ATTEMPTS:-2}"
attempt=1
while :; do
  for port in ${MAESTRO_ADB_REVERSE:-}; do
    adb reverse "tcp:$port" "tcp:$port" > /dev/null || echo "::warning::adb reverse tcp:$port failed before attempt $attempt"
  done
  if maestro "$@"; then
    if [ "$attempt" -gt 1 ]; then
      echo "::warning title=Flaky device run::maestro $* failed, then passed on attempt $attempt of $attempts"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        echo "- flaky: \`maestro $*\` passed on attempt $attempt of $attempts" >> "$GITHUB_STEP_SUMMARY"
      fi
    fi
    exit 0
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error title=Device run failed::maestro $* failed $attempts time(s)"
    if [ -n "${MAESTRO_LOGCAT:-}" ]; then
      { echo "--- adb logcat -d after: maestro $*"; adb logcat -d -v threadtime; } >> "$MAESTRO_LOGCAT" 2>&1 || echo "::warning::adb logcat -d failed; no device log for maestro $*"
    fi
    exit 1
  fi
  echo "::warning::maestro $* failed on attempt $attempt of $attempts; running it again"
  attempt=$((attempt + 1))
done
