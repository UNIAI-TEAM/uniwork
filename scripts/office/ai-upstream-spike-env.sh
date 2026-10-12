#!/usr/bin/env bash
# Source this to run the G6-02 spike against the dev upstream (UNI-1364, spec
# §8.4): it reads base_url and env_key out of [model_providers.customlocal] in
# the Codex config and exports OPENAI_BASE_URL and OPENAI_API_KEY.
#
#   source scripts/office/ai-upstream-spike-env.sh
#   scripts/office/ai-upstream-spike.sh dev
#
# Nothing here echoes a value: not the base url, not the key. The dev upstream's
# host, port and key are never written to a repo, report or message — this
# script only points at the config file.
#
# CODEX_CONFIG overrides the config path (default ~/.codex/config.toml);
# SPIKE_ENV_KEY_VAR overrides which environment variable holds the key.
set -uo pipefail

_spike_config="${CODEX_CONFIG:-${HOME:-}/.codex/config.toml}"
if [ ! -r "$_spike_config" ]; then
  echo "ai-upstream-spike-env: cannot read $_spike_config" >&2
  return 2 2>/dev/null || exit 2
fi

# Read the two keys of [model_providers.customlocal] only; stop at the next
# section. Values are taken verbatim between the first pair of quotes.
_spike_read() {
  awk -v want="$1" '
    /^[[:space:]]*\[/ { in_section = ($0 ~ /^[[:space:]]*\[model_providers\.customlocal\][[:space:]]*$/) ; next }
    !in_section { next }
    $0 ~ "^[[:space:]]*" want "[[:space:]]*=" {
      v = $0; sub(/^[^=]*=[[:space:]]*/, "", v)
      gsub(/^"|"[[:space:]]*$/, "", v)
      print v; exit
    }
  ' "$_spike_config"
}

_spike_base_url="$(_spike_read base_url)"
_spike_env_key="$(_spike_read env_key)"

if [ -z "$_spike_base_url" ]; then
  echo "ai-upstream-spike-env: [model_providers.customlocal] has no base_url in $_spike_config" >&2
  return 2 2>/dev/null || exit 2
fi
if [ -z "${SPIKE_ENV_KEY_VAR:-}" ]; then
  if [ -z "$_spike_env_key" ]; then
    echo "ai-upstream-spike-env: [model_providers.customlocal] has no env_key in $_spike_config" >&2
    return 2 2>/dev/null || exit 2
  fi
  SPIKE_ENV_KEY_VAR="$_spike_env_key"
fi

# Indirect expansion: the key comes from the variable the config names, and is
# never printed, not even on the failure path.
_spike_key="${!SPIKE_ENV_KEY_VAR:-}"
if [ -z "$_spike_key" ]; then
  echo "ai-upstream-spike-env: $SPIKE_ENV_KEY_VAR is empty; set it before sourcing" >&2
  unset _spike_config _spike_base_url _spike_env_key _spike_key
  return 2 2>/dev/null || exit 2
fi

export OPENAI_BASE_URL="$_spike_base_url"
export OPENAI_API_KEY="$_spike_key"
export AI_PROVIDER=openai

echo "ai-upstream-spike-env: OPENAI_BASE_URL and OPENAI_API_KEY set from $_spike_config" >&2
unset _spike_config _spike_base_url _spike_env_key _spike_key
echo "ai-upstream-spike-env: set the model name (GET /v1/models) in SPIKE_MODEL before running dev" >&2