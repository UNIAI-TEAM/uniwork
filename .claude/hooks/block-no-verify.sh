#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash). Agents do not get the human escape
# hatch: `git commit --no-verify` skips .githooks/, and an agent that skips
# them cannot honour the "make check before push" promise CLAUDE.md attaches.
# Exit 2 blocks the call and feeds stderr back to the agent.
cmd="$(node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).tool_input?.command ?? ""')"
# ponytail: token match, not a shell parser — a commit message containing the
# literal flag also trips it; rephrase the message.
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]].*(--no-verify|[[:space:]]-n)([[:space:]]|$)'; then
  echo "blocked: git --no-verify skips .githooks/. Fix the failing check instead (CLAUDE.md § Local Gates)." >&2
  exit 2
fi
