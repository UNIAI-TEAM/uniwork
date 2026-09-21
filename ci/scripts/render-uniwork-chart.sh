#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHART="${ROOT}/deploy/app/uniwork"
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

helm template uniwork "${CHART}" \
  --set be.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --set fe.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --set be.image.tag=test --set fe.image.tag=test \
  > "${OUT}"

grep -q 'namespace: uniwork' "${OUT}"
grep -q 'name: uniwork-be' "${OUT}"
grep -q 'name: uniwork-fe' "${OUT}"
grep -q 'replicas: 1' "${OUT}"
grep -q 'workload: app' "${OUT}"
grep -q 'type: ClusterIP' "${OUT}"
grep -q 'path: /healthz' "${OUT}"
grep -q 'path: /readyz' "${OUT}"
grep -q 'LIVEKIT_URL' "${OUT}"
grep -q 'wss://livekit.vn247.info:7880' "${OUT}"
grep -q 'name: uniwork-db' "${OUT}"
grep -q 'name: uniwork-redis' "${OUT}"
grep -q 'name: uniwork-app' "${OUT}"
grep -q 'name: uniwork-livekit' "${OUT}"
grep -q 'LIVEKIT_API_KEY' "${OUT}"
grep -q 'allow-from-reap-edge' "${OUT}" || grep -q 'reap-edge' "${OUT}"
for forbidden in LoadBalancer NodePort; do
  if grep -q "${forbidden}" "${OUT}"; then
    echo "FAIL: ${forbidden} must not appear" >&2
    exit 1
  fi
done

if helm template uniwork "${CHART}" --set be.image.digest= --set fe.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >/dev/null 2>"${OUT}.err"; then
  echo "FAIL: expected helm to refuse empty be.image.digest" >&2
  exit 1
fi
echo "OK: uniwork chart render assertions passed"
