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
#
# With MAESTRO_IOS_UDID set to the simulator's UDID (an iOS run), every attempt
# after the first starts from a simulator with no driver on it. Maestro starts
# its XCTest driver with `xcodebuild test-without-building … -destination
# id=<udid>` and waits MAESTRO_DRIVER_STARTUP_TIMEOUT for it; when that runs
# out it gives up without stopping the xcodebuild, so a retry launched a second
# runner for the same bundle beside the first one still coming up, and both
# lost. The leftover xcodebuild and the half-started runner are stopped first.
#
# With MAESTRO_ADB_RECOVER set (an Android run), every attempt first asks adb
# for the emulator's state, and when it is not "device" (adbd dropped: the
# emulator answers "device offline") runs `adb reconnect offline` and waits up
# to two minutes for it to come back booted. Without it, an emulator that went
# offline during the step stayed offline for the retry, and both attempts
# failed on the transport, not on the app.
set -u

ios_driver="dev.mobile.maestro-driver-iosUITests.xctrunner"

# Stops what a timed-out start of Maestro's iOS driver left behind on the simulator MAESTRO_IOS_UDID names.
clear_ios_driver() {
  local spawn="xcodebuild test-without-building .*-destination id=$MAESTRO_IOS_UDID"
  pkill -f "$spawn" || true
  for _ in $(seq 1 30); do
    pgrep -f "$spawn" > /dev/null || break
    sleep 1
  done
  xcrun simctl terminate "$MAESTRO_IOS_UDID" "$ios_driver" > /dev/null 2>&1 || true
  xcrun simctl bootstatus "$MAESTRO_IOS_UDID" -b > /dev/null || echo "::warning::simulator $MAESTRO_IOS_UDID did not report booted before attempt $attempt"
}

# Brings back an emulator adb no longer calls "device" before an attempt (MAESTRO_ADB_RECOVER).
recover_android() {
  local state
  state="$(adb get-state 2> /dev/null | tr -d '\r')"
  [ "$state" = "device" ] && return 0
  echo "::warning::adb reports the emulator ${state:-gone} before attempt $attempt; reconnecting"
  adb reconnect offline > /dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    if [ "$(adb get-state 2> /dev/null | tr -d '\r')" = "device" ] \
      && [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ]; then
      return 0
    fi
    sleep 2
  done
  echo "::warning::the emulator was not back two minutes after adb reconnect, before attempt $attempt"
}

attempts="${MAESTRO_ATTEMPTS:-2}"
attempt=1
while :; do
  if [ "$attempt" -gt 1 ] && [ -n "${MAESTRO_IOS_UDID:-}" ]; then
    clear_ios_driver
  fi
  if [ -n "${MAESTRO_ADB_RECOVER:-}" ]; then
    recover_android
  fi
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
