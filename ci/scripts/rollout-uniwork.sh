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

helm upgrade --install uniwork "${ROOT}/deploy/app/uniwork" \
  --namespace uniwork --create-namespace \
  --set be.image.tag="${IMAGE_TAG}" \
  --set be.image.digest="${BE_DIGEST}" \
  --set fe.image.tag="${IMAGE_TAG}" \
  --set fe.image.digest="${FE_DIGEST}"

kubectl -n uniwork rollout status deploy/uniwork-be --timeout=300s
kubectl -n uniwork rollout status deploy/uniwork-fe --timeout=300s
