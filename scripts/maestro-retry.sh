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
# With MAESTRO_ADB_RECOVER set (an Android run), a run whose own maestro.log shows it failed because it lost the
# emulator's adb transport ("device offline", DeviceUnreachableException as the error of the command that failed, not
# a capture after an app failure) restarts the adb server, waits up to MAESTRO_ADB_WAIT
# seconds (120) for the emulator to be back and booted, settles MAESTRO_ADB_SETTLE seconds (5) and runs again
# without spending an attempt, up to MAESTRO_ADB_DROPS (2) times per call; past that a drop counts as an ordinary
# failed attempt. It is a `adb transport dropped` warning and a summary line, never a silent pass. UNI-2142: the
# emulator's adb connection drops for 0.3-0.5 s in the first seconds of a Maestro session, and Maestro 2.11.0 fails
# the flow on the first shell call that meets it (mobile-dev-inc/maestro#3451). The transport is back long before an
# `adb get-state` could see it, so the session log is what tells; and an emulator that dropped once tends to drop
# again, so the retry gets a fresh adb server instead of the same connection.
#
# With MAESTRO_ATTEMPT_LOGS set to a directory, every failed run keeps its sessions' maestro.log and
# logs/device-logcat.txt there (<flow>-run<N>/), with every line that holds MAESTRO_TEST_PASSWORD or
# MAESTRO_CALLER_PASSWORD removed: Maestro clears logcat at each flow start and its own log records the typed
# password, so neither survives to the artifact otherwise. Sessions are read from MAESTRO_TESTS_DIR
# (~/.maestro/tests, Maestro's default debug output).
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

tests_dir="${MAESTRO_TESTS_DIR:-$HOME/.maestro/tests}"
transport_lost="Command failed \\(host:transport:[^)]*\\): (device offline|device '[^']*' not found)|DeviceUnreachableException"

# The session directories Maestro has written so far, one per line.
sessions() {
  ls -1 "$tests_dir" 2> /dev/null | LC_ALL=C sort
}

# The error that failed the flow in the maestro.log at $1: the first failed command's, or, when the run failed before
# any command (Maestro starting its driver), the exception after "Failed to run flow".
failure_of() {
  awk '
    /\[Command execution\] CommandFailed:/ { print; found = 1; exit }
    after_flow { if (fallback == "") fallback = $0; after_flow = 0 }
    /Failed to run flow/ { after_flow = 1 }
    END { if (!found && fallback != "") print fallback }
  ' "$1" 2> /dev/null
}

# Prints "dropped" when one of the sessions named on stdin failed because it lost the emulator's adb transport. Only
# the error that failed the flow counts: Maestro also logs the transport's error when it drops while a step that failed
# for the app's own reason (an assertion, an app that crashed at launch) is being captured, and that run spends an app
# attempt like any other.
lost_transport() {
  local session file
  while IFS= read -r session; do
    [ -n "$session" ] || continue
    while IFS= read -r file; do
      if failure_of "$file" | grep -qE "$transport_lost"; then
        echo dropped
        return 0
      fi
    done < <(find "$tests_dir/$session" -type f -name maestro.log 2> /dev/null)
  done
}

# Copies the failed run's maestro.log and device log from the sessions named on stdin to MAESTRO_ATTEMPT_LOGS, minus the password's lines.
keep_attempt_logs() {
  local session file dest flow secrets=()
  flow="$(basename "${flow_file:-maestro}" .yaml)"
  for secret in "${MAESTRO_TEST_PASSWORD:-}" "${MAESTRO_CALLER_PASSWORD:-}"; do
    [ -n "$secret" ] && secrets+=(-e "$secret")
  done
  while IFS= read -r session; do
    [ -n "$session" ] || continue
    while IFS= read -r file; do
      dest="$MAESTRO_ATTEMPT_LOGS/$flow-run$run/$session/${file#"$tests_dir/$session/"}"
      mkdir -p "$(dirname "$dest")"
      if [ "${#secrets[@]}" -gt 0 ]; then
        # grep exits 1 when every line held a secret (keep the empty file) and 2 on an error (keep nothing).
        grep -vF "${secrets[@]}" "$file" > "$dest"
        [ "$?" -le 1 ] || rm -f "$dest"
      else
        cp "$file" "$dest"
      fi
    done < <(find "$tests_dir/$session" -type f \( -name maestro.log -o -name device-logcat.txt \) 2> /dev/null)
  done
}

# A fresh adb server, then the emulator back and booted, after a run that lost the transport (MAESTRO_ADB_RECOVER).
restart_adb() {
  adb kill-server > /dev/null 2>&1 || true
  adb start-server > /dev/null 2>&1 || true
  local deadline=$((SECONDS + ${MAESTRO_ADB_WAIT:-120}))
  while :; do
    if [ "$(adb get-state 2> /dev/null | tr -d '\r')" = "device" ] \
      && [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ]; then
      sleep "${MAESTRO_ADB_SETTLE:-5}"
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "::warning::the emulator was not back after restarting the adb server, before the rerun of attempt $attempt"
      return 0
    fi
    sleep 2
  done
}

# The flow file among the arguments, for naming its kept logs.
flow_file=""
for arg in "$@"; do
  case "$arg" in *.yaml | *.yml) flow_file="$arg" ;; esac
done

attempts="${MAESTRO_ATTEMPTS:-2}"
drop_budget="${MAESTRO_ADB_DROPS:-2}"
attempt=1
run=0
drops=0
dropped_runs=0
while :; do
  run=$((run + 1))
  if [ "$attempt" -gt 1 ] && [ -n "${MAESTRO_IOS_UDID:-}" ]; then
    clear_ios_driver
  fi
  for port in ${MAESTRO_ADB_REVERSE:-}; do
    adb reverse "tcp:$port" "tcp:$port" > /dev/null || echo "::warning::adb reverse tcp:$port failed before attempt $attempt"
  done
  before="$(sessions)"
  if maestro "$@"; then
    if [ "$attempt" -gt 1 ]; then
      echo "::warning title=Flaky device run::maestro $* failed, then passed on attempt $attempt of $attempts"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        echo "- flaky: \`maestro $*\` passed on attempt $attempt of $attempts" >> "$GITHUB_STEP_SUMMARY"
      fi
    fi
    exit 0
  fi
  new_sessions="$(LC_ALL=C comm -13 <(printf '%s\n' "$before") <(sessions))"
  if [ -n "${MAESTRO_ATTEMPT_LOGS:-}" ]; then
    keep_attempt_logs <<< "$new_sessions"
  fi
  if [ -n "${MAESTRO_ADB_RECOVER:-}" ] && [ -n "$(lost_transport <<< "$new_sessions")" ]; then
    dropped_runs=$((dropped_runs + 1))
    if [ "$drops" -lt "$drop_budget" ]; then
      drops=$((drops + 1))
      echo "::warning title=adb transport dropped::maestro $* lost the emulator's adb transport (device offline) on attempt $attempt of $attempts; restarting the adb server and running it again (infra retry $drops of $drop_budget)"
      if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        echo "- adb transport dropped: \`maestro $*\` on attempt $attempt; adb server restarted" >> "$GITHUB_STEP_SUMMARY"
      fi
      restart_adb
      continue
    fi
  fi
  if [ "$attempt" -ge "$attempts" ]; then
    reason=""
    [ "$dropped_runs" -gt 0 ] && reason="; the emulator's adb transport dropped on $dropped_runs run(s)"
    echo "::error title=Device run failed::maestro $* failed $attempts time(s)$reason"
    if [ -n "${MAESTRO_LOGCAT:-}" ]; then
      { echo "--- adb logcat -d after: maestro $*"; adb logcat -d -v threadtime; } >> "$MAESTRO_LOGCAT" 2>&1 || echo "::warning::adb logcat -d failed; no device log for maestro $*"
    fi
    exit 1
  fi
  echo "::warning::maestro $* failed on attempt $attempt of $attempts; running it again"
  attempt=$((attempt + 1))
done
