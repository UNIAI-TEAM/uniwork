# UniWork temporary guest on REAP production Kubernetes

**Date:** 2026-09-21  
**Status:** approved design (self-reviewed 2026-09-21)  
**Plan:** `docs/superpowers/plans/2026-09-21-uniwork-on-reap-k8s.md`  
**Repo:** UniWork (`/home/nguyennam/Vietants-workspace/uniwork/uniwork`)  
**Target cluster:** `reap-eng-prod-k8s` (`KUBECONFIG=$HOME/.kube/reap-prod`)

## Goal

Deploy UniWork (backend + frontend + PostgreSQL database) temporarily onto the existing REAP production cluster as an isolated guest: shared Postgres/Redis/LiveKit/edge, separate Kubernetes namespace, public hostname `uniwork.ubos.vn`.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Packaging | All guest manifests + Helm + Jenkins in UniWork repo (approach 1) |
| Namespace | `uniwork` (not `reap-app`) |
| Public access | `uniwork.ubos.vn` — FE `/`, BE `/api/*` (APISIX path-based) |
| TLS | New cert via cert-manager → Secret `uniwork-tls` (ClusterIssuer must be created; none present today) |
| DNS | Already points at cluster public LB IP |
| Workloads | Single Helm chart `uniwork`, two Deployments, 1 replica each, `pool-app` |
| Postgres | Manual SQL: role `uniwork` + database `uniwork` + hand-made K8s Secret (do not edit Zalando CR) |
| Redis | Shared `redis-cache` **master** DNS, logical DB `15` (`redis.ParseURL`; not Sentinel URL) |
| LiveKit | Shared server; multi-URL webhook + app-level room filter; one webhook signing key only |
| LiveKit URL to UniWork | `LIVEKIT_URL=wss://livekit.vn247.info:7880` (browser join URL; SDK converts wss→https). Do **not** put ClusterIP here — `IssueJoinCredential` returns this to the client. |
| FE public env | Origin only: `NEXT_PUBLIC_API_URL=https://uniwork.ubos.vn`, `NEXT_PUBLIC_WS_URL=wss://uniwork.ubos.vn`, `NEXT_PUBLIC_APP_URL=https://uniwork.ubos.vn` (client concatenates `/api/v1/...`) |
| TLS issuer | New HTTP-01 `ClusterIssuer` (cluster has cert-manager but **no applied Issuer**; DNS-01 stubs are empty/`TBD`) |
| Jenkins | Branch `develop`; apply confirm `reap-eng-prod-k8s` |
| Out of scope | ArgoCD for UniWork, HA >1 pod, Zalando CR changes, recording/egress/S3, STT agent |

## Architecture

```text
Internet → LB → APISIX (reap-edge)
                 ├─ https://uniwork.ubos.vn/api/*  → uniwork-be:8080  (ns uniwork)
                 └─ https://uniwork.ubos.vn/*      → uniwork-fe:3000  (ns uniwork)

uniwork-be → Postgres pooler (reap-data): database/user uniwork
          → redis-cache (dedicated Redis DB index)
          → LiveKit (reap-integrations) + webhook URL #2 (ClusterIP)

pool-app: 1× uniwork-be + 1× uniwork-fe
```

| Component | Namespace | Notes |
|---|---|---|
| BE, FE, SA, NetPol, Helm release | `uniwork` | Release name `uniwork` |
| DB role/database | `reap-data` (SQL on bastion) | Not Zalando-managed |
| Redis | `reap-data` | `redis-cache` |
| LiveKit | `reap-integrations` | Add second webhook URL |
| Routes + TLS | `reap-edge` | Manifests live in UniWork repo |

## Helm chart and workloads

**Layout:** `deploy/app/uniwork/` — one Chart, one `values.yaml`, templates for both services.

**Resources:**
- Namespace `uniwork` (chart or one-shot create)
- Deployments: `uniwork-be` (8080), `uniwork-fe` (3000)
- Services: ClusterIP matching deployment names
- `replicaCount: 1` each; `nodeSelector: workload=app`
- ServiceAccount + NetworkPolicy (ingress from `reap-edge`; egress to Postgres/Redis/LiveKit)
- Images: `registry-harbor.ubos.vn/uniwork/{uniwork-be,uniwork-fe}` with digest pin
- `imagePullSecrets: harbor-registry` in namespace `uniwork`

**Backend env (Secrets/ConfigMaps; no passwords in Git):**
- `DATABASE_URL` ← Secret `uniwork-db` (`postgres://uniwork:…@reap-postgresql-pooler.reap-data.svc.cluster.local:5432/uniwork?sslmode=disable`)
- `REDIS_URL` ← Secret `uniwork-redis` (`redis://:PASSWORD@redis-cache-master.reap-data.svc.cluster.local:6379/15`)
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` ← Secret `uniwork-livekit` (copy from `reap-integrations/livekit-keys`)
- ConfigMap (non-secret): `APP_ENV=production`, `PORT=8080`, `FRONTEND_ORIGIN=https://uniwork.ubos.vn`, `API_PUBLIC_URL=https://uniwork.ubos.vn`, `LIVEKIT_URL=wss://livekit.vn247.info:7880`, `TRUSTED_PROXIES=10.244.0.0/16`, `MEETING_PROVIDER=livekit`
- `JWT_SECRET` ← Secret `uniwork-app`

**Probes:** BE `GET /healthz` (live) and `GET /readyz` (ready) on container `:8080` (chi **root**, not under `/api`). FE `GET /` on `:3000`.

**Resources (guest, shared `pool-app`):** BE request `100m`/`256Mi` limit `500m`/`512Mi`; FE request `50m`/`256Mi` limit `500m`/`512Mi`. `runAsNonRoot`: BE UID `1000` (Dockerfile `app` user), FE UID `1001` (node image).

**Frontend build-time args** (Dockerfile already requires `NEXT_PUBLIC_*` at image build; `packages/core/api/http.ts` does `fetch(apiUrl + path)` with paths like `/api/v1/...`; WS is `${wsUrl}/api/v1/ws`):
- `NEXT_PUBLIC_APP_URL=https://uniwork.ubos.vn`
- `NEXT_PUBLIC_API_URL=https://uniwork.ubos.vn`
- `NEXT_PUBLIC_WS_URL=wss://uniwork.ubos.vn`

**Cleanup of WIP:** replace copy-pasted lms-core `deploy/app/uniwork-be/values.yml` (Config Server, Keycloak, Kafka, `lms_core` schema, etc.). Empty `uniwork-fe/` folder is superseded by the unified chart.

## Postgres, Redis, Secrets

### Postgres (manual)

1. On bastion against REAP Postgres: `CREATE ROLE uniwork LOGIN PASSWORD '…';` then `CREATE DATABASE uniwork OWNER uniwork;` plus grants needed for UniWork migrations.
2. Create Secret `uniwork-db` in `uniwork` with `DATABASE_URL` pointing at `reap-postgresql-pooler.reap-data.svc.cluster.local:5432/uniwork`.
3. Document teardown: `DROP DATABASE` / `DROP ROLE` + delete Secret. Operator will not reconcile this role/DB.

### Redis

- UniWork uses `github.com/redis/go-redis/v9` `ParseURL`. Guest URL is **standalone master**, not Sentinel:
  `redis://:PASSWORD@redis-cache-master.reap-data.svc.cluster.local:6379/15`
- Password from existing Secret `redis-cache-auth` in `reap-data` (copy value into `uniwork-redis`; do not mount the LMS secret across namespaces).
- Logical DB **15** isolates keys from LMS (LMS uses Spring Sentinel, typically DB 0). One BE replica: master DNS is enough; Sentinel HA is out of scope.

### Other Secrets (create out-of-band)

| Secret | Contents |
|---|---|
| `uniwork-db` | `DATABASE_URL` |
| `uniwork-redis` | `REDIS_URL` (DB 15 on redis-cache-master) |
| `uniwork-app` | `JWT_SECRET`; optional SMTP/Google/VAPID if enabled |
| `uniwork-livekit` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` copied from `reap-integrations/livekit-keys` |
| `harbor-registry` | Harbor pull credentials for ns `uniwork` |

Migrations: UniWork server migrates into database `uniwork` on startup (existing UniWork mechanism). No REAP Flyway.

## LiveKit shared webhook isolation

### Facts

- LiveKit `webhook` block: **one** `api_key` + list of `urls`. Cannot assign different signing keys per URL.
- Multiple API keys under `keys:` can exist for CreateRoom/token, but do **not** split webhook delivery.
- UniWork rooms: meetings `uw_mtg_{id}` **and** chat voice `uw-voice-{chatRoomId}` (`liveKitRoomFromChatID`). Identities for meetings: `uw_participant_{id}`. Do **not** drop every non-`uw_mtg_` room — that would break chat-voice webhooks.
- UniWork `HandleProviderEvent` already no-ops when `sessionByRoom` misses; recording finish is keyed by egress id.
- LMS today still claims unresolved rooms with `sessionId=null` (`session_id` is nullable) → foreign-room noise in `mdl_online_session_participant_events`.

### Changes

1. Update LiveKit server config webhook URLs to include:
   - existing lms-core webhook URL
   - `http://uniwork-be.uniwork.svc.cluster.local:8080/api/v1/integrations/livekit/webhook`  
   Use ClusterIP, not the public hostname.
2. NetworkPolicy (and hostNetwork allow pattern, mirroring lms-core) so LiveKit can reach `uniwork-be:8080`.
3. UniWork uses the same LiveKit API key/secret as the cluster for token + webhook JWT verify.
4. **UniWork (required, cheap):** after signature verify, if the event has a room name that is **not** prefixed `uw_mtg_` or `uw-voice-`, return HTTP 200 and **do not enqueue**. Empty room (egress-only) still enqueues so recording finish can match egress id.
5. **LMS (required):** in `LiveKitWebhookService.handle`, after the broadcast-room branch, if `resolve(roomName)` is empty → return `accepted` **without** rate-limit increment, claim, or Kafka publish. Covers `uw_mtg_*`, `uw-voice-*`, and any other foreign room. Lives in REAP `backend-api` `lms-core`.

### Explicit non-goals

- Separate LiveKit instance
- Per-URL webhook API keys
- Public webhook URL through `uniwork.ubos.vn`

### Verification

Create one LMS online-classroom room and one UniWork `uw_mtg_*` room; confirm each backend only applies business state for its own rooms; the other side returns 200 / no-op without wrong writes.

## Edge: TLS and APISIX

Cross-namespace routing **must** follow the existing private-admin pattern (`ApisixUpstream.spec.externalNodes` `type: Domain`), not same-namespace `backends.serviceName` (ApisixRoute lives in `reap-edge`; Services live in `uniwork`).

1. Apply `ClusterIssuer` `letsencrypt-http01` (ACME HTTP-01, `ingress.class: apisix`). Do not use the unapplied DNS-01 stubs (`solvers: []`). ACME account email is **operator-supplied at apply** (`--set` / env); do not commit a mailbox.
2. `Certificate` in `reap-edge` for `uniwork.ubos.vn` → Secret `uniwork-tls`. HTTP-01 needs `/.well-known/acme-challenge` reachable on that host (cert-manager Ingress class `apisix`; if IC ignores Ingress, add a dedicated ApisixRoute to the solver Service).
3. `ApisixTls` host `uniwork.ubos.vn` → secret `uniwork-tls`.
4. Manifests under UniWork `deploy/edge/`:

| Priority | Match | Upstream | websocket |
|---|---|---|---|
| 200 | Host `uniwork.ubos.vn` + `/api`, `/api/*` | Domain `uniwork-be.uniwork.svc.cluster.local:8080` | `true` (`/api/v1/ws`, lobby-ws) |
| 100 | Host `uniwork.ubos.vn` + `/`, `/*` | Domain `uniwork-fe.uniwork.svc.cluster.local:3000` | `true` |

Preserve `/api/...` path (no strip-prefix). `healthz`/`readyz` stay in-cluster only.

5. Enable order: ClusterIssuer → Certificate Ready → ApisixTls → ApisixRoute → HTTPS smoke.

## Jenkins and rollout

Complete `ci/Jenkinsfile.production-app.groovy` (pipeline already registered on Jenkins):

| Stage | Agent | Action |
|---|---|---|
| Checkout + Guard | `107.188` | Only `BRANCH=develop` |
| Build BE / FE | `107.188` | Build/push Harbor; FE with production `NEXT_PUBLIC_*`; write digests |
| Prepare | `107.188` | `target/rollout.env` + digests for `uniwork-be`, `uniwork-fe` |
| Approve | — | Human input |
| Rollout | `production-k8s` | Only if `CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s` |

**Rollout script** `ci/scripts/rollout-uniwork.sh` (single release; do not reuse REAP multi-service `generic-service` roller as-is):

```bash
helm upgrade --install uniwork deploy/app/uniwork \
  -n uniwork --create-namespace \
  --set be.image.tag=… --set be.image.digest=sha256:… \
  --set fe.image.tag=… --set fe.image.digest=sha256:… \
  -f deploy/app/uniwork/values.yaml
kubectl -n uniwork rollout status deploy/uniwork-be deploy/uniwork-fe
```

**One-time / runbook (not every pipeline run):** DB SQL + Secrets, LiveKit multi-URL + NetPol, ClusterIssuer + Certificate + ApisixRoute.

Local ops: `export KUBECONFIG=$HOME/.kube/reap-prod`.

## Error handling, smoke, teardown

### Fail-closed

- Jenkins/Helm refuse rollout without `sha256:` digests or without confirm `reap-eng-prod-k8s`.
- BE refuses start without `DATABASE_URL` / `JWT_SECRET`.
- LiveKit webhook: bad signature → 401; UniWork foreign room (`!uw_mtg_` and `!uw-voice-`) → 200 no enqueue; LMS unresolved room → 200 no claim.

### Smoke checklist

1. Both pods Ready on `pool-app`.
2. `https://uniwork.ubos.vn/` serves FE; `/api/v1/…` reaches BE.
3. Migrations applied on database `uniwork`.
4. Cross-app LiveKit webhook isolation verified.
5. Redis DB index isolation verified.

### Teardown

1. Delete ApisixRoute + Certificate (DNS optional).
2. Remove UniWork webhook URL from LiveKit config; delete webhook NetPol.
3. `helm uninstall uniwork -n uniwork` (and delete namespace).
4. `DROP DATABASE uniwork;` / `DROP ROLE uniwork;`; delete Secrets.
5. LMS early-ignore patch may remain (safe generally) or be reverted if desired.

## Implementation inventory (for planning)

**In UniWork repo:**
- `deploy/app/uniwork/` Helm chart (replace WIP `uniwork-be/` + empty `uniwork-fe/`; Jenkins looks for this chart, not per-service `values.yml`)
- `deploy/edge/` ClusterIssuer, Certificate, ApisixTls, ApisixUpstream, ApisixRoute
- `deploy/livekit/` webhook NetPol + runbook for editing `livekit-server-config`
- `ci/Jenkinsfile.production-app.groovy` complete `stages{}` + Approve/Rollout; FE `--build-arg NEXT_PUBLIC_*`
- `ci/scripts/rollout-uniwork.sh` and `ci/scripts/render-uniwork-chart.sh`
- `runbooks/production/uniwork-guest.md`: SQL, Secrets, LiveKit, edge apply, smoke, teardown

**In REAP backend-api (small):**
- LMS `LiveKitWebhookService` early-ignore for unresolved rooms

## Success criteria

- UniWork reachable at `https://uniwork.ubos.vn` with FE and `/api` BE.
- One BE + one FE pod on `pool-app` in namespace `uniwork`.
- Dedicated Postgres database/user `uniwork`; no Zalando CR drift required for go-live.
- Shared LiveKit without cross-app business-state corruption.
- Jenkins develop → Harbor → confirm `reap-eng-prod-k8s` → Helm digest rollout works end-to-end.
