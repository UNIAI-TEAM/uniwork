# UniWork temporary guest on REAP production Kubernetes

**Date:** 2026-09-21  
**Status:** approved design (pending implementation plan)  
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
| Redis | Shared `redis-cache`, dedicated DB index (e.g. `15`) |
| LiveKit | Shared server; multi-URL webhook + app-level room filter; one webhook signing key only |
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
- `DATABASE_URL` ← Secret `uniwork-db`
- `REDIS_URL` ← redis-cache + DB index (e.g. `/15`)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` ← Secret `uniwork-livekit` (same keys as cluster `livekit-keys`)
- `API_PUBLIC_URL` / `FRONTEND_ORIGIN` = `https://uniwork.ubos.vn`
- `JWT_SECRET` and other app secrets ← Secret `uniwork-app`
- `APP_ENV=production`

**Frontend build-time args** (Dockerfile already requires `NEXT_PUBLIC_*` at image build):
- `NEXT_PUBLIC_APP_URL=https://uniwork.ubos.vn`
- `NEXT_PUBLIC_API_URL=https://uniwork.ubos.vn` (or `/api` form matching FE client convention — verify against current web client)
- `NEXT_PUBLIC_WS_URL=wss://uniwork.ubos.vn`

**Cleanup of WIP:** replace copy-pasted lms-core `deploy/app/uniwork-be/values.yml` (Config Server, Keycloak, Kafka, `lms_core` schema, etc.). Empty `uniwork-fe/` folder is superseded by the unified chart.

## Postgres, Redis, Secrets

### Postgres (manual)

1. On bastion against REAP Postgres: `CREATE ROLE uniwork LOGIN PASSWORD '…';` then `CREATE DATABASE uniwork OWNER uniwork;` plus grants needed for UniWork migrations.
2. Create Secret `uniwork-db` in `uniwork` with `DATABASE_URL` pointing at `reap-postgresql-pooler.reap-data.svc.cluster.local:5432/uniwork`.
3. Document teardown: `DROP DATABASE` / `DROP ROLE` + delete Secret. Operator will not reconcile this role/DB.

### Redis

- `REDIS_URL` uses shared `redis-cache` credentials (`redis-cache-auth`) and a dedicated logical DB index (preferred: `15`).
- Key prefix `uniwork:` is optional if the app supports it; DB index alone is sufficient for guest isolation.

### Other Secrets (create out-of-band)

| Secret | Contents |
|---|---|
| `uniwork-app` | `JWT_SECRET`; optional SMTP/Google/VAPID if enabled |
| `uniwork-livekit` | API key/secret copied from `reap-integrations/livekit-keys` |
| `harbor-registry` | Harbor pull credentials for ns `uniwork` |

Migrations: UniWork server migrates into database `uniwork` on startup (existing UniWork mechanism). No REAP Flyway.

## LiveKit shared webhook isolation

### Facts

- LiveKit `webhook` block: **one** `api_key` + list of `urls`. Cannot assign different signing keys per URL.
- Multiple API keys under `keys:` can exist for CreateRoom/token, but do **not** split webhook delivery.
- UniWork rooms: `uw_mtg_{meetingID}`; identities: `uw_participant_{id}`.
- UniWork already no-ops business handling when `sessionByRoom` misses (LMS rooms ignored after optional inbox enqueue).
- LMS today still claims unresolved rooms with `sessionId=null` → foreign-room noise risk.

### Changes

1. Update LiveKit server config webhook URLs to include:
   - existing lms-core webhook URL
   - `http://uniwork-be.uniwork.svc.cluster.local:8080/api/v1/integrations/livekit/webhook`  
   Use ClusterIP, not the public hostname.
2. NetworkPolicy (and hostNetwork allow pattern, mirroring lms-core) so LiveKit can reach `uniwork-be:8080`.
3. UniWork uses the same LiveKit API key/secret as the cluster for token + webhook JWT verify.
4. **UniWork (optional hardening):** drop early if room name does not start with `uw_mtg_` before enqueue.
5. **LMS (required small patch):** in `LiveKitWebhookService`, if not a broadcast room and `resolve(roomName)` is empty → return accepted **without claiming** (covers `uw_mtg_*` and any other foreign rooms). Lives in REAP `backend-api` / `lms-core`.

### Explicit non-goals

- Separate LiveKit instance
- Per-URL webhook API keys
- Public webhook URL through `uniwork.ubos.vn`

### Verification

Create one LMS online-classroom room and one UniWork `uw_mtg_*` room; confirm each backend only applies business state for its own rooms; the other side returns 200 / no-op without wrong writes.

## Edge: TLS and APISIX

1. Ensure a working cert-manager **ClusterIssuer** (HTTP-01 via edge or DNS-01). Cluster has cert-manager pods but **no Issuer/ClusterIssuer** observed at design time; `reap-wildcard-tls` exists but does not cover `uniwork.ubos.vn`.
2. `Certificate` for `uniwork.ubos.vn` → Secret `uniwork-tls`.
3. Bind TLS on APISIX for that host.
4. ApisixRoute (manifests under UniWork `deploy/edge/`):

| Priority | Match | Upstream |
|---|---|---|
| Higher | Host `uniwork.ubos.vn` + `/api/*` | `uniwork-be.uniwork.svc:8080` (preserve `/api/...` path) |
| Lower | Host `uniwork.ubos.vn` + `/*` | `uniwork-fe.uniwork.svc:3000` |

5. Allow WebSocket upgrade for FE if required by `wss://uniwork.ubos.vn`.
6. Enable order: Issuer → Certificate Ready → ApisixRoute → HTTPS smoke.

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
- LiveKit webhook: bad signature → 401; foreign room → ignore (UniWork no-op; LMS early-accept without claim).

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
- `deploy/app/uniwork/` Helm chart (replace WIP `uniwork-be`/`uniwork-fe` stubs)
- `deploy/edge/` Certificate, ApisixRoute, TLS binding notes
- `deploy/livekit/` or runbook snippet for multi-URL webhook + NetPol
- `ci/Jenkinsfile.production-app.groovy` complete Approve/Rollout
- `ci/scripts/rollout-uniwork.sh` (+ digest helpers as needed)
- Runbook: bastion SQL + Secret creation

**In REAP backend-api (small):**
- LMS `LiveKitWebhookService` early-ignore for unresolved rooms

## Success criteria

- UniWork reachable at `https://uniwork.ubos.vn` with FE and `/api` BE.
- One BE + one FE pod on `pool-app` in namespace `uniwork`.
- Dedicated Postgres database/user `uniwork`; no Zalando CR drift required for go-live.
- Shared LiveKit without cross-app business-state corruption.
- Jenkins develop → Harbor → confirm `reap-eng-prod-k8s` → Helm digest rollout works end-to-end.
