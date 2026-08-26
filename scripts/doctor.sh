#!/usr/bin/env bash
# Checks the local toolchain against the versions this repo pins, reading each
# one from the file that already owns it rather than from a copy:
#
#   Node  -> .nvmrc                       (CI reads the same major)
#   Go    -> server/go.mod `go` directive
#   pnpm  -> package.json `packageManager`
#
# A duplicated version number is a version number that drifts, so there is no
# list of expected versions in this script.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

fail=0
ok()   { printf '  \033[32m✓\033[0m %-6s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✗\033[0m %-6s %s\n' "$1" "$2"; fail=1; }
warn() { printf '  \033[33m!\033[0m %-6s %s\n' "$1" "$2"; }

echo "Toolchain"

# --- Node --------------------------------------------------------------------
want_node="$(tr -d ' \n' < .nvmrc)"
if ! command -v node >/dev/null 2>&1; then
  bad node "not installed (want major $want_node — see .nvmrc)"
else
  have_node="$(node --version | sed 's/^v//')"
  if [ "${have_node%%.*}" = "$want_node" ]; then
    ok node "$have_node"
  else
    bad node "$have_node, want major $want_node (.nvmrc). nvm use / fnm use"
  fi
fi

# --- Go ----------------------------------------------------------------------
want_go="$(awk '/^go [0-9]/ {print $2; exit}' server/go.mod)"
want_go_mm="$(printf '%s' "$want_go" | cut -d. -f1,2)"
if ! command -v go >/dev/null 2>&1; then
  bad go "not installed (want $want_go — see server/go.mod)"
else
  have_go="$(go version | awk '{print $3}' | sed 's/^go//')"
  have_go_mm="$(printf '%s' "$have_go" | cut -d. -f1,2)"
  if [ "$have_go_mm" = "$want_go_mm" ]; then
    ok go "$have_go"
  else
    bad go "$have_go, want $want_go_mm.x (server/go.mod)"
  fi
fi

# --- pnpm --------------------------------------------------------------------
want_pnpm="$(node -p "require('./package.json').packageManager.split('@')[1]" 2>/dev/null || echo "")"
if ! command -v pnpm >/dev/null 2>&1; then
  bad pnpm "not installed — run: corepack enable"
else
  have_pnpm="$(pnpm --version)"
  if [ "$have_pnpm" = "$want_pnpm" ]; then
    ok pnpm "$have_pnpm"
  else
    bad pnpm "$have_pnpm, want $want_pnpm (package.json packageManager). corepack enable"
  fi
fi

# --- Docker ------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok docker "running"
else
  bad docker "not running — Postgres and Redis come from docker compose"
fi

echo ""
echo "Repo"

# --- Hooks -------------------------------------------------------------------
# The gate everything else in this repo assumes. Reported, not repaired: a
# doctor that silently fixes things teaches nobody what was broken.
hooks_path="$(git config core.hooksPath || true)"
if [ "$hooks_path" = ".githooks" ]; then
  ok hooks "core.hooksPath -> .githooks"
else
  bad hooks "core.hooksPath is '${hooks_path:-unset}', want .githooks — run: pnpm install"
fi

# --- Env file ----------------------------------------------------------------
if [ -f .env ] || [ -f .env.worktree ]; then
  ok env "$([ -f .env ] && echo .env || echo .env.worktree)"
else
  warn env "no .env — run: make dev (creates it from .env.example)"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "✓ Ready."
else
  echo "✗ Fix the items above before running make setup."
  exit 1
fi
