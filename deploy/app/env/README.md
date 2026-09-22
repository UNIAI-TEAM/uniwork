# K8s app env files (`deploy/app/env`) — UniWork guest on REAP.

Non-secret production runtime for the `uniwork` Helm chart.
**Do not put secrets here** (DB/Redis URLs, JWT, LiveKit API keys, SMTP password,
AWS keys, Google client secret, VAPID private key, AI keys). Those stay as
Kubernetes Secrets + `secretKeyRef` in the chart.

| File | Used by |
|---|---|
| `uniwork-be.env` | `uniwork-be` ConfigMap |
| `uniwork-fe.env` | `uniwork-fe` ConfigMap (runtime only; NEXT_PUBLIC_* are image build-args) |

## Install / upgrade

```bash
helm upgrade --install uniwork deploy/app/uniwork \
  --namespace uniwork \
  --set-file env.beContent=deploy/app/env/uniwork-be.env \
  --set-file env.feContent=deploy/app/env/uniwork-fe.env \
  --set be.image.digest=sha256:… --set fe.image.digest=sha256:…
```

`ci/scripts/rollout-uniwork.sh` passes the same `--set-file` flags.
