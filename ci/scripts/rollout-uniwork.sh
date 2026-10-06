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
# rollout without it renders exactly what it did before. NOTE: helm upgrade
# applies the whole value set, so once the engine is live every later rollout
# must keep OFFICE_ENGINE_ENABLED=1 (and the same values), or the engine is
# removed. Per-environment checklist: docs/ops/OFFICE_ENV_CHECKLIST.md.
#   OFFICE_ENGINE_DIGEST          required, sha256:... of the engine image
#   OFFICE_ENGINE_OUTPUT_ORIGINS  required, the file store origin(s) the engine may fetch/write
#   OFFICE_ENGINE_VALUES_FILE     optional, extra values (networkPolicy.officeEngineFileStore CIDRs, resources, ...)
# The engine image tag is IMAGE_TAG. Secret uniwork-office-engine must already exist.
OFFICE_ENGINE_ENABLED="${OFFICE_ENGINE_ENABLED:-0}"
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
