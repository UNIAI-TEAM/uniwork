# K8s app env files (`deploy/app/env`) — UniWork guest on REAP.

Non-secret production runtime for the `uniwork` Helm chart.
**Do not put secrets here** (DB/Redis URLs, JWT, LiveKit API keys, SMTP password,
AWS keys, Google client secret, VAPID private key, AI keys, office engine tokens).
Those stay as Kubernetes Secrets + `secretKeyRef` in the chart.

| File | Used by |
|---|---|
| `uniwork-be.env` | `uniwork-be` ConfigMap |
| `uniwork-fe.env` | `uniwork-fe` ConfigMap (runtime only; NEXT_PUBLIC_* are image build-args) |
| `uniwork-office-engine.env` | `uniwork-office-engine` ConfigMap |

## Install / upgrade

```bash
helm upgrade --install uniwork deploy/app/uniwork \
  --namespace uniwork \
  --set-file env.beContent=deploy/app/env/uniwork-be.env \
  --set-file env.feContent=deploy/app/env/uniwork-fe.env \
  --set-file env.officeEngineContent=deploy/app/env/uniwork-office-engine.env \
  --set be.image.digest=sha256:… \
  --set fe.image.digest=sha256:… \
  --set-string officeEngine.image.digest=sha256:…
```

`ci/scripts/rollout-uniwork.sh` passes the same `--set-file` flags and always
rolls out BE + FE + office-engine. Jenkins build params do **not** toggle the
engine; change origins/workers in `uniwork-office-engine.env` and re-rollout.

Prerequisite checklist (Secret, bucket CORS, kubelet pids):  
[`docs/ops/OFFICE_ENV_CHECKLIST.md`](../../../docs/ops/OFFICE_ENV_CHECKLIST.md).

### Office engine

Always on (`officeEngine.enabled=true` in values). Chart:

1. Deploys Deployment / Service / NetworkPolicy for `uniwork-office-engine`.
2. Injects non-secret env from `uniwork-office-engine.env` (ConfigMap).
3. Sets `OFFICE_ENGINE_URL=http://uniwork-office-engine:<port>` on the BE
   (keep `OFFICE_ENGINE_URL=` empty in `uniwork-be.env`).
4. Requires Secret `uniwork-office-engine` (BE + engine both read it; missing
   Secret fails pods at start).

```bash
kubectl -n uniwork create secret generic uniwork-office-engine \
  --from-literal=OFFICE_ENGINE_SERVICE_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=OFFICE_ENGINE_GRANT_KEY="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

`DESKTOP_AUTH_*` (public PKCE client for the Office desktop app) are non-secret
placeholders in `uniwork-be.env`.

### OpenRouter (AI gateway)

ConfigMap `uniwork-be.env` ships `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`,
and model overrides. Create the API key secret before rollout:

```bash
kubectl -n uniwork create secret generic uniwork-openai \
  --from-literal=OPENAI_API_KEY='sk-or-v1-…' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Rotate the key on OpenRouter if it was ever exposed; update the secret and restart `uniwork-be`.
