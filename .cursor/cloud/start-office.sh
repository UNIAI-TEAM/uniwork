#!/usr/bin/env bash
# Every-round start for UNIAI-TEAM/uniwork-office (run-tests.sh --profile office).
# The fork has no services; the one runtime setting its e2e job makes is letting
# Electron's sandbox use unprivileged user namespaces, which does not survive a
# reboot. Best effort: a VM without that sysctl (or without the right to set it)
# runs as it is.
set -uo pipefail

if sysctl kernel.apparmor_restrict_unprivileged_userns > /dev/null 2>&1; then
  sudo sysctl -qw kernel.apparmor_restrict_unprivileged_userns=0 || true
fi

echo "cloud start (office): nothing to start"
