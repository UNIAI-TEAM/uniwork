#!/usr/bin/env bash
# Resolves the process gate level. Sourced by the pre-commit hook and
# scripts/check.sh; CI reads the file directly. Rules: docs/engineering/GATE_LEVELS.md.
#
#   fast      — build phase: cheap hooks, no e2e on PRs, issue key is a warning
#   standard  — the default ruleset as CLAUDE.md documents it
#   strict    — standard plus everything runs everywhere, no warnings
#
# The committed file is the level; the GATE_LEVEL env var overrides it for one
# run (`GATE_LEVEL=strict make check`). Anything not one of the three words
# resolves to strict: a typo must tighten, never loosen.
_gate_file="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/GATE_LEVEL"
GATE_LEVEL="${GATE_LEVEL:-$(tr -d '[:space:]' < "$_gate_file" 2>/dev/null)}"
case "$GATE_LEVEL" in fast|standard|strict) ;; *) GATE_LEVEL=strict ;; esac
export GATE_LEVEL
