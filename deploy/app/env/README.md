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

ConfigMap `uniwork-be.env` ships `AI_PROVIDER=anthropic` with `ANTHROPIC_MODEL=claude-sonnet-5`
(context extraction stays on `claude-haiku-4-5-20251001`); the Secret needs `ANTHROPIC_API_KEY`.
To route through OpenRouter instead, set `AI_PROVIDER=openai` and give `AI_MODEL_<CAPABILITY>` and
`AI_MODEL_ALLOW` OpenRouter slugs (`openai/gpt-4o-mini`) in the same change.
`TestDeployEnvResolvesPricedModels` (`server/internal/ai/deploy_env_test.go`) fails if provider and
model names disagree or a model has no price. For the OpenRouter route, create the API key secret before rollout:

```bash
kubectl -n uniwork create secret generic uniwork-openai \
  --from-literal=OPENAI_API_KEY='sk-or-v1-…' \
  --dry-run=client -o yaml | kubectl apply -f -
```

Rotate the key on OpenRouter if it was ever exposed; update the secret and restart `uniwork-be`.

### Apple (Sign in with Apple, iPhone calls)

Secret `uniwork-apple` holds the two Apple keys of team `XJAM488A6D`; the BE reads
it through `be.secrets.apns` and `be.secrets.siwa` with `optional: true`, so a
cluster without it still starts the pod:

| Key | What | Without it |
|---|---|---|
| `APNS_KEY_ID`, `APNS_PRIVATE_KEY` | APNs token-auth key (`.p8`, PEM text) for iPhone VoIP call pushes (ADR 0038) | VoIP off, iPhones keep the Expo call push; the BE logs at start that the APNs key is incomplete |
| `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` | Sign in with Apple key (`.p8`, PEM text) that signs Apple's client secret (ADR 0041, 0049) | the web's Apple stays off (desktop and Android included, since they sign in with Apple through the web); the iPhone's sign-in works, but account deletion cannot revoke the Apple grant (logged at start) |

The non-secret half is in `uniwork-be.env`: `APNS_TEAM_ID`, `APPLE_SIWA_TEAM_ID`,
`APPLE_SIWA_AUDIENCES` (empty turns the iPhone's Sign in with Apple off),
`APPLE_SIWA_WEB_CLIENT_ID` (the web's Services ID; empty hides Apple on the web) and `APNS_VOIP_TOPIC`
(kept empty: each push uses the token's own `<bundle id>.voip`). iPhone calls
also need the `unichat_mobile_calls_ios` flag (default off, `/admin`).

Create it from the downloaded `.p8` files, never from values typed on the
command line (they land in shell history):

```bash
umask 077; d=$(mktemp -d)
printf '%s' '<apns key id>' > "$d/apns-key-id"   # key ids are not secret
printf '%s' '<siwa key id>' > "$d/siwa-key-id"
kubectl -n uniwork create secret generic uniwork-apple \
  --from-file=APNS_KEY_ID="$d/apns-key-id" \
  --from-file=APNS_PRIVATE_KEY=AuthKey_<apns key id>.p8 \
  --from-file=APPLE_SIWA_KEY_ID="$d/siwa-key-id" \
  --from-file=APPLE_SIWA_PRIVATE_KEY=AuthKey_<siwa key id>.p8 \
  --dry-run=client -o yaml | kubectl apply -f -
rm -r "$d"
kubectl -n uniwork rollout restart deployment/uniwork-be
```

A key id is the 10-character id Apple shows beside the key (also in the `.p8`
file name); it is not secret, but it travels with its key. The PEM keeps its
real line breaks; `\n` escapes are accepted too.

Rotate: in Certificates, Identifiers & Profiles › Keys create the new key
(APNs, or Sign in with Apple bound to `com.uniworkos.chat`), apply the Secret
again with the new id and `.p8` (the command above), restart `uniwork-be`, check
its start log (`APNs VoIP push enabled` with the new `key_id`; no `sign in with
apple: token revoke disabled`), then revoke the old key at Apple. The old key
keeps working until that last step, so nothing fails in between.
