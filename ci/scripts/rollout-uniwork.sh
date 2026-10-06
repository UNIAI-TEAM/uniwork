#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIRM="${CLUSTER_APPLY_CONFIRM:-}"
if [[ "${CONFIRM}" != "reap-eng-prod-k8s" ]]; then
  echo "REFUSE: CLUSTER_APPLY_CONFIRM must be reap-eng-prod-k8s (got '${CONFIRM}')" >&2
  exit 2
fi
: "${BE_DIGEST:?BE_DIGEST required}"
: "${FE_DIGEST:?FE_DIGEST required}"
: "${IMAGE_TAG:?IMAGE_TAG required}"
case "${BE_DIGEST}${FE_DIGEST}" in
  *sha256:*) ;;
  *) echo "REFUSE: digests must start with sha256:" >&2; exit 2 ;;
esac
[[ "${BE_DIGEST}" == sha256:* ]] || { echo "REFUSE: BE_DIGEST"; exit 2; }
[[ "${FE_DIGEST}" == sha256:* ]] || { echo "REFUSE: FE_DIGEST"; exit 2; }

# Office engine (apps/office-engine): OFF unless OFFICE_ENGINE_ENABLED=1, so a
# rollout without it renders exactly what it did before. helm upgrade applies
# the whole value set, so a rollout that leaves the engine out removes a live
# one: when OFFICE_ENGINE_ENABLED is unset the script reads the live release
# and REFUSES if it runs the engine. Set OFFICE_ENGINE_ENABLED=1 to keep it, or
# OFFICE_ENGINE_ENABLED=0 to remove it on purpose. Per-environment checklist:
# docs/ops/OFFICE_ENV_CHECKLIST.md.
#   OFFICE_ENGINE_DIGEST          required, sha256:... of the engine image
#   OFFICE_ENGINE_OUTPUT_ORIGINS  required, the file store origin(s) the engine may fetch/write
#   OFFICE_ENGINE_VALUES_FILE     optional, extra values (networkPolicy.officeEngineFileStore CIDRs, resources, ...)
# The engine image tag is IMAGE_TAG. Secret uniwork-office-engine must already exist.
if [[ -z "${OFFICE_ENGINE_ENABLED:-}" ]]; then
  # Unset: keep the old default (off) only when the live release does not run
  # the engine. A first install has no release yet; any other helm or jq
  # failure refuses, since we cannot tell what this rollout would remove.
  helm_err="$(mktemp)"
  if live_values="$(helm get values uniwork --namespace uniwork --all -o json 2>"${helm_err}")"; then
    rm -f "${helm_err}"
    command -v jq >/dev/null 2>&1 || {
      echo "REFUSE: jq is needed to read the live release; set OFFICE_ENGINE_ENABLED=0 or 1 explicitly" >&2
      exit 2
    }
    live_engine="$(printf '%s' "${live_values}" | jq -r '(.officeEngine.enabled // false) | tostring')" || {
      echo "REFUSE: cannot read officeEngine.enabled from the live release; set OFFICE_ENGINE_ENABLED=0 or 1 explicitly" >&2
      exit 2
    }
  elif grep -q 'release: not found' "${helm_err}"; then
    rm -f "${helm_err}"
    live_engine=false
  else
    cat "${helm_err}" >&2
    rm -f "${helm_err}"
    echo "REFUSE: cannot read the live release values; set OFFICE_ENGINE_ENABLED=0 or 1 explicitly" >&2
    exit 2
  fi
  if [[ "${live_engine}" == "true" ]]; then
    echo "REFUSE: the live release runs the office engine and OFFICE_ENGINE_ENABLED is unset or empty; set OFFICE_ENGINE_ENABLED=1 (with its digest and origins) to keep it, or OFFICE_ENGINE_ENABLED=0 to remove it" >&2
    exit 2
  fi
  OFFICE_ENGINE_ENABLED=0
fi
office_args=()
if [[ "${OFFICE_ENGINE_ENABLED}" == "1" ]]; then
  : "${OFFICE_ENGINE_DIGEST:?OFFICE_ENGINE_DIGEST required when OFFICE_ENGINE_ENABLED=1}"
  : "${OFFICE_ENGINE_OUTPUT_ORIGINS:?OFFICE_ENGINE_OUTPUT_ORIGINS required when OFFICE_ENGINE_ENABLED=1}"
  [[ "${OFFICE_ENGINE_DIGEST}" == sha256:* ]] || { echo "REFUSE: OFFICE_ENGINE_DIGEST" >&2; exit 2; }
  if [[ -n "${OFFICE_ENGINE_VALUES_FILE:-}" ]]; then
    [[ -f "${OFFICE_ENGINE_VALUES_FILE}" ]] || { echo "REFUSE: OFFICE_ENGINE_VALUES_FILE not found" >&2; exit 2; }
    office_args+=(-f "${OFFICE_ENGINE_VALUES_FILE}")
  fi
  # --set-string keeps the origin (and a digest) a string; helm splits --set
  # values on commas, so a comma-separated origin list needs each comma escaped.
  comma_escape='\,'
  office_args+=(
    --set officeEngine.enabled=true
    --set-string officeEngine.image.tag="${IMAGE_TAG}"
    --set-string officeEngine.image.digest="${OFFICE_ENGINE_DIGEST}"
    --set-string officeEngine.outputOrigins="${OFFICE_ENGINE_OUTPUT_ORIGINS//,/${comma_escape}}"
  )
elif [[ "${OFFICE_ENGINE_ENABLED}" != "0" ]]; then
  echo "REFUSE: OFFICE_ENGINE_ENABLED must be 0 or 1 (got '${OFFICE_ENGINE_ENABLED}')" >&2
  exit 2
fi

helm upgrade --install uniwork "${ROOT}/deploy/app/uniwork" \
  --namespace uniwork --create-namespace \
  --set-file env.beContent="${ROOT}/deploy/app/env/uniwork-be.env" \
  --set-file env.feContent="${ROOT}/deploy/app/env/uniwork-fe.env" \
  --set be.image.tag="${IMAGE_TAG}" \
  --set be.image.digest="${BE_DIGEST}" \
  --set fe.image.tag="${IMAGE_TAG}" \
  --set fe.image.digest="${FE_DIGEST}" \
  ${office_args[@]+"${office_args[@]}"}

kubectl -n uniwork rollout status deploy/uniwork-be --timeout=300s
kubectl -n uniwork rollout status deploy/uniwork-fe --timeout=300s
if [[ "${OFFICE_ENGINE_ENABLED}" == "1" ]]; then
  kubectl -n uniwork rollout status deploy/uniwork-office-engine --timeout=300s
fi
