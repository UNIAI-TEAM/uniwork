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
set -u

attempts="${MAESTRO_ATTEMPTS:-2}"
attempt=1
while :; do
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
    exit 1
  fi
  echo "::warning::maestro $* failed on attempt $attempt of $attempts; running it again"
  attempt=$((attempt + 1))
done
