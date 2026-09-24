# UniWork guest on REAP k8s Implementation Plan

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy UniWork BE+FE as a temporary guest on `reap-eng-prod-k8s` (namespace `uniwork`, public `https://uniwork.ubos.vn`) with shared Postgres/Redis/LiveKit and isolated webhooks.

**Architecture:** One Helm release in UniWork repo. Edge uses APISIX `ApisixUpstream` `externalNodes` Domain (same as private-admin Grafana/Keycloak). LiveKit keeps one webhook signing key and two URLs; LMS ignores unresolved rooms; UniWork only enqueues `uw_mtg_*` / `uw-voice-*` / empty-room events.

**Tech Stack:** Helm 3, Kubernetes 1.32, APISIX Ingress CRDs v2, cert-manager HTTP-01, Jenkins declarative (agents `107.188` + `production-k8s`), Go Chi UniWork server, Next.js 16, Zalando Postgres (manual SQL only), redis-cache master DB 15.

**Spec:** `docs/superpowers/specs/2026-09-21-uniwork-on-reap-k8s-design.md`

## Global Constraints

- Guest manifests live in UniWork repo; LMS webhook patch lives in REAP `backend-api`.
- Namespace `uniwork`; 1 replica each; `nodeSelector: workload=app`; Services ClusterIP only.
- `CLUSTER_APPLY_CONFIRM` must equal `reap-eng-prod-k8s` before Helm mutate; images pinned by `sha256:` digest.
- No passwords/keys in Git. No Zalando CR edit. No ArgoCD, no recording/S3/STT, no HA >1 pod.
- `LIVEKIT_URL=wss://livekit.vn247.info:7880` (never ClusterIP — join credential is this URL).
- FE bake-time: `NEXT_PUBLIC_API_URL=https://uniwork.ubos.vn`, `NEXT_PUBLIC_WS_URL=wss://uniwork.ubos.vn`, `NEXT_PUBLIC_APP_URL=https://uniwork.ubos.vn`.
- Redis: `redis://:PASSWORD@redis-cache-master.reap-data.svc.cluster.local:6379/15`.
- Local kubectl: `export KUBECONFIG=$HOME/.kube/reap-prod`.
- Do not commit ACME email or LiveKit/DB passwords.

## File map

| Path | Role |
| --- | --- |
| REAP `lms-core/.../LiveKitWebhookService.java` | Ignore unresolved LiveKit rooms |
| REAP `lms-core/.../LiveKitWebhookServiceTest.java` | Regression for foreign rooms |
| UniWork `server/internal/meetings/room_filter.go` | `IsUniWorkLiveKitRoom` |
| UniWork `server/internal/handler/meeting_token.go` | Drop foreign rooms before enqueue |
| UniWork `deploy/app/uniwork/**` | Helm chart (one release, two Deployments) |
| UniWork `deploy/edge/**` | ClusterIssuer, Certificate, ApisixTls, Upstreams, Routes |
| UniWork `deploy/livekit/**` | Webhook NetPol + config patch notes |
| UniWork `ci/Jenkinsfile.production-app.groovy` | Build/push/approve/rollout |
| UniWork `ci/scripts/rollout-uniwork.sh` | Helm upgrade --install |
| UniWork `ci/scripts/render-uniwork-chart.sh` | Offline chart assertions |
| UniWork `runbooks/production/uniwork-guest.md` | SQL, secrets, LiveKit, edge, smoke, teardown |

---

### Task 1: LMS ignore unresolved LiveKit rooms

**Files:**
- Modify: `/home/nguyennam/Vietants-workspace/elearning-project/code/backend-api/lms-core/src/main/java/com/unicom/lms/core/service/online/LiveKitWebhookService.java` (method `handle`)
- Test: `/home/nguyennam/Vietants-workspace/elearning-project/code/backend-api/lms-core/src/test/java/com/unicom/lms/core/onlineclassroom/LiveKitWebhookServiceTest.java`

**Interfaces:**
- Consumes: existing `handle(String payload, HttpHeaders headers)`, `roomResolver.resolve(roomName)`, `claimEvent`, `enforceWebhookRateLimit`, `publishReceived`
- Produces: unresolved rooms return `accepted=true` with **no** `saveAndFlush`, **no** Kafka publish, **no** rate-limit key

Work in the REAP `backend-api` repo.

- [ ] **Step 1: Write the failing test**

Add to `LiveKitWebhookServiceTest` after `signedLiveKitWebhookIsAccepted`:

```java
  @Test
  void unresolvedForeignRoomIsAcceptedWithoutClaimOrPublish() {
    LiveKitProperties properties = properties();
    OnlineSessionParticipantEventRepository repository =
        mock(OnlineSessionParticipantEventRepository.class);
    OnlineSessionRoomResolver roomResolver = mock(OnlineSessionRoomResolver.class);
    LmsCoreEventPublisher publisher = mock(LmsCoreEventPublisher.class);
    StringRedisTemplate redis = mock(StringRedisTemplate.class);
    when(repository.findByEventId("evt-uniwork-room")).thenReturn(Optional.empty());
    when(roomResolver.resolveBroadcastSession("uw_mtg_01TEST")).thenReturn(Optional.empty());
    when(roomResolver.resolve("uw_mtg_01TEST")).thenReturn(Optional.empty());

    LiveKitWebhookService webhookService =
        service(properties, roomResolver, repository, publisher, directTransactions());
    ReflectionTestUtils.setField(webhookService, "stringRedisTemplate", redis);

    Map<String, Object> response =
        webhookService.handle(
            participantLeftPayload(
                "evt-uniwork-room",
                "uw_mtg_01TEST",
                UUID.fromString("6f1a2dd4-67ac-4db8-9e3d-1e7b709fc2db")),
            legacyHeaders());

    assertThat(response).containsEntry("accepted", true).containsEntry("duplicate", false);
    verify(repository, never()).saveAndFlush(any());
    verify(publisher, never()).publishLiveKitWebhookReceived(any());
    verifyNoInteractions(redis);
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend-api`):

```bash
mvn -pl lms-core -am -Dtest=LiveKitWebhookServiceTest#unresolvedForeignRoomIsAcceptedWithoutClaimOrPublish test
```

Expected: FAIL — `saveAndFlush` invoked (today claims with `sessionId=null`).

- [ ] **Step 3: Minimal production change**

In `LiveKitWebhookService.handle`, **after** the broadcast-session branch and **before** `enforceWebhookRateLimit`, resolve then return:

```java
    enforceWebhookRateLimit(roomName);
    Optional<OnlineSessionRoomResolver.ResolvedRoom> resolvedRoom = roomResolver.resolve(roomName);
    OnlineSessionParticipantEvent event =
```

Replace that block with:

```java
    Optional<OnlineSessionRoomResolver.ResolvedRoom> resolvedRoom = roomResolver.resolve(roomName);
    if (resolvedRoom.isEmpty()) {
      return response(eventId, false);
    }
    enforceWebhookRateLimit(roomName);
    OnlineSessionParticipantEvent event =
```

Keep `buildEvent(..., resolvedRoom.orElse(null))` as `buildEvent(..., resolvedRoom.get())` now that empty is returned earlier — or leave `orElse(null)` (unreachable). Prefer `resolvedRoom.get()`.

Do **not** skip the duplicate-event short-circuit above this. Broadcast rooms still take the existing branch.

- [ ] **Step 4: Run tests**

```bash
mvn -pl lms-core -am -Dtest=LiveKitWebhookServiceTest test
```

Expected: PASS (existing duplicate/broadcast/signed cases still pass).

- [ ] **Step 5: Commit in backend-api**

```bash
git add lms-core/src/main/java/com/unicom/lms/core/service/online/LiveKitWebhookService.java \
        lms-core/src/test/java/com/unicom/lms/core/onlineclassroom/LiveKitWebhookServiceTest.java
git commit -m "fix(livekit): ignore unresolved webhook rooms without claiming"
```

Deploy of `lms-core` is **out of this UniWork Jenkinsfile**. After merge, promote via existing REAP production-app pipeline (`BUILD_LMS_CORE`).

---

### Task 2: UniWork webhook accept only UniWork rooms

**Files:**
- Create: `server/internal/meetings/room_filter.go`
- Create: `server/internal/meetings/room_filter_test.go`
- Modify: `server/internal/handler/meeting_token.go` (`livekitWebhook`)

**Interfaces:**
- Consumes: LiveKit event `ev.Room.Name` after `webhook.ReceiveWebhookEvent`
- Produces: `func IsUniWorkLiveKitRoom(name string) bool` — empty name → true; prefix `uw_mtg_` or `uw-voice-` → true; else false

- [ ] **Step 1: Write the failing test**

Create `server/internal/meetings/room_filter_test.go`:

```go
package meetings

import "testing"

func TestIsUniWorkLiveKitRoom(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{name: "meeting", in: "uw_mtg_01J8X4MTGN1P2Q3R4S5T6U7V", want: true},
		{name: "voice", in: "uw-voice-01JCHATROOMID", want: true},
		{name: "empty egress", in: "", want: true},
		{name: "lms main", in: "main-room", want: false},
		{name: "lms broadcast", in: "online-9001-g2-broadcast", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := IsUniWorkLiveKitRoom(tc.in); got != tc.want {
				t.Fatalf("IsUniWorkLiveKitRoom(%q)=%v want %v", tc.in, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && go test ./internal/meetings -run TestIsUniWorkLiveKitRoom -count=1
```

Expected: FAIL `undefined: IsUniWorkLiveKitRoom`.

- [ ] **Step 3: Implement filter + handler gate**

Create `server/internal/meetings/room_filter.go`:

```go
package meetings

import "strings"

// IsUniWorkLiveKitRoom reports whether a LiveKit room belongs to UniWork.
// Empty names are accepted so egress-only webhooks can still match by egress id.
func IsUniWorkLiveKitRoom(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return true
	}
	return strings.HasPrefix(name, "uw_mtg_") || strings.HasPrefix(name, "uw-voice-")
}
```

In `livekitWebhook` in `server/internal/handler/meeting_token.go`, after mapping `mapped.RoomName` from `ev.Room` and **before** `EnqueueProviderWebhook`:

```go
	if ev.Room != nil && !meetings.IsUniWorkLiveKitRoom(ev.Room.Name) {
		w.WriteHeader(http.StatusOK)
		return
	}
```

Keep signature verification first. Keep 200 on unknown event types.

- [ ] **Step 4: Run tests**

```bash
cd server && go test ./internal/meetings ./internal/handler -count=1
```

Expected: PASS (`room_filter` plus existing handler tests).

- [ ] **Step 5: Commit in UniWork**

```bash
git add server/internal/meetings/room_filter.go server/internal/meetings/room_filter_test.go \
        server/internal/handler/meeting_token.go
git commit -m "fix(livekit): ignore foreign webhook rooms before inbox enqueue"
```

---

### Task 3: Helm chart + render assertions

**Files:**
- Create: `deploy/app/uniwork/Chart.yaml`
- Create: `deploy/app/uniwork/values.yaml`
- Create: `deploy/app/uniwork/templates/_helpers.tpl`
- Create: `deploy/app/uniwork/templates/namespace.yaml`
- Create: `deploy/app/uniwork/templates/serviceaccount.yaml`
- Create: `deploy/app/uniwork/templates/configmap.yaml`
- Create: `deploy/app/uniwork/templates/deployment-be.yaml`
- Create: `deploy/app/uniwork/templates/deployment-fe.yaml`
- Create: `deploy/app/uniwork/templates/service-be.yaml`
- Create: `deploy/app/uniwork/templates/service-fe.yaml`
- Create: `deploy/app/uniwork/templates/networkpolicy.yaml`
- Create: `ci/scripts/render-uniwork-chart.sh`
- Delete after chart exists: `deploy/app/uniwork-be/values.yml` and empty `deploy/app/uniwork-fe/` (WIP copy of lms-core)

**Interfaces:**
- Consumes: Secrets `uniwork-db`, `uniwork-redis`, `uniwork-app`, `uniwork-livekit`, `harbor-registry` (created in Task 6, not templated)
- Produces: release `uniwork` in namespace `uniwork`; Deployments/Services `uniwork-be`, `uniwork-fe`

- [ ] **Step 1: Write the failing render script**

Create `ci/scripts/render-uniwork-chart.sh` (executable):

```bash
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
grep -q 'secretName: uniwork-db' "${OUT}"
grep -q 'allow-from-reap-edge' "${OUT}" || grep -q 'reap-edge' "${OUT}"
if grep -q 'LoadBalancer' "${OUT}"; then
  echo "FAIL: LoadBalancer must not appear" >&2
  exit 1
fi

if helm template uniwork "${CHART}" --set be.image.digest= --set fe.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb >/dev/null 2>"${OUT}.err"; then
  echo "FAIL: expected helm to refuse empty be.image.digest" >&2
  exit 1
fi
echo "OK: uniwork chart render assertions passed"
```

- [ ] **Step 2: Run script to verify it fails**

```bash
chmod +x ci/scripts/render-uniwork-chart.sh
./ci/scripts/render-uniwork-chart.sh
```

Expected: FAIL (`Chart.yaml` missing / helm cannot find chart).

- [ ] **Step 3: Implement chart**

`deploy/app/uniwork/Chart.yaml`:

```yaml
apiVersion: v2
name: uniwork
description: Temporary UniWork guest (BE + FE) on REAP production
type: application
version: 0.1.0
appVersion: "0.1.0"
```

`deploy/app/uniwork/values.yaml` (full):

```yaml
namespace: uniwork

imagePullSecrets:
  - name: harbor-registry

nodeSelector:
  workload: app
tolerations: []

public:
  origin: https://uniwork.ubos.vn
  livekitUrl: wss://livekit.vn247.info:7880

be:
  replicaCount: 1
  image:
    registry: registry-harbor.ubos.vn/uniwork
    repository: uniwork-be
    tag: pending
    digest: ""
    requireDigest: true
    pullPolicy: IfNotPresent
  port: 8080
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    allowPrivilegeEscalation: false
    capabilities: { drop: ["ALL"] }
  secrets:
    database: { name: uniwork-db, key: DATABASE_URL }
    redis: { name: uniwork-redis, key: REDIS_URL }
    app: { name: uniwork-app, key: JWT_SECRET }
    livekitKey: { name: uniwork-livekit, key: LIVEKIT_API_KEY }
    livekitSecret: { name: uniwork-livekit, key: LIVEKIT_API_SECRET }

fe:
  replicaCount: 1
  image:
    registry: registry-harbor.ubos.vn/uniwork
    repository: uniwork-fe
    tag: pending
    digest: ""
    requireDigest: true
    pullPolicy: IfNotPresent
  port: 3000
  resources:
    requests: { cpu: 50m, memory: 256Mi }
    limits: { cpu: 500m, memory: 512Mi }
  securityContext:
    runAsNonRoot: true
    runAsUser: 1001
    runAsGroup: 1001
    allowPrivilegeEscalation: false
    capabilities: { drop: ["ALL"] }

networkPolicy:
  livekitTunnelCidr: "10.244.217.192/32"
```

`templates/_helpers.tpl`:

```yaml
{{- define "uniwork.image" -}}
{{- $img := . -}}
{{- if and $img.requireDigest (not $img.digest) -}}
{{- fail (printf "uniwork: %s image.digest is required (sha256:...)" $img.repository) -}}
{{- end -}}
{{- printf "%s/%s@%s" $img.registry $img.repository $img.digest -}}
{{- end -}}
```

`templates/namespace.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: {{ .Values.namespace }}
  labels:
    app.kubernetes.io/part-of: uniwork
    kubernetes.io/metadata.name: uniwork
```

`templates/serviceaccount.yaml`:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: uniwork
  namespace: {{ .Values.namespace }}
automountServiceAccountToken: false
```

`templates/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: uniwork-be
  namespace: {{ .Values.namespace }}
data:
  APP_ENV: "production"
  PORT: {{ .Values.be.port | quote }}
  FRONTEND_ORIGIN: {{ .Values.public.origin | quote }}
  API_PUBLIC_URL: {{ .Values.public.origin | quote }}
  LIVEKIT_URL: {{ .Values.public.livekitUrl | quote }}
  TRUSTED_PROXIES: "10.244.0.0/16"
  MEETING_PROVIDER: "livekit"
```

`templates/deployment-be.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: uniwork-be
  namespace: {{ .Values.namespace }}
spec:
  replicas: {{ .Values.be.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: uniwork-be
  template:
    metadata:
      labels:
        app.kubernetes.io/name: uniwork-be
        reap.io/pool: pool-app
    spec:
      serviceAccountName: uniwork
      automountServiceAccountToken: false
      imagePullSecrets:
        {{- toYaml .Values.imagePullSecrets | nindent 8 }}
      securityContext:
        runAsNonRoot: true
        runAsUser: {{ .Values.be.securityContext.runAsUser }}
        runAsGroup: {{ .Values.be.securityContext.runAsGroup }}
        seccompProfile:
          type: RuntimeDefault
      nodeSelector:
        {{- toYaml .Values.nodeSelector | nindent 8 }}
      containers:
        - name: uniwork-be
          image: {{ include "uniwork.image" .Values.be.image | quote }}
          imagePullPolicy: {{ .Values.be.image.pullPolicy }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          ports:
            - name: http
              containerPort: {{ .Values.be.port }}
          envFrom:
            - configMapRef:
                name: uniwork-be
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.be.secrets.database.name }}
                  key: {{ .Values.be.secrets.database.key }}
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.be.secrets.redis.name }}
                  key: {{ .Values.be.secrets.redis.key }}
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.be.secrets.app.name }}
                  key: {{ .Values.be.secrets.app.key }}
            - name: LIVEKIT_API_KEY
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.be.secrets.livekitKey.name }}
                  key: {{ .Values.be.secrets.livekitKey.key }}
            - name: LIVEKIT_API_SECRET
              valueFrom:
                secretKeyRef:
                  name: {{ .Values.be.secrets.livekitSecret.name }}
                  key: {{ .Values.be.secrets.livekitSecret.key }}
          resources:
            {{- toYaml .Values.be.resources | nindent 12 }}
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /readyz, port: http }
            initialDelaySeconds: 5
            periodSeconds: 5
```

`templates/deployment-fe.yaml`: copy the BE Deployment; rename to `uniwork-fe`; use `.Values.fe`; `containerPort` 3000; omit `envFrom`/`env` secret refs; both probes `httpGet.path: /`.

`templates/service-be.yaml` / `service-fe.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: uniwork-be
  namespace: {{ .Values.namespace }}
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: uniwork-be
  ports:
    - name: http
      port: 8080
      targetPort: http
```

(FE: name `uniwork-fe`, port 3000.)

`templates/networkpolicy.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: uniwork
  namespace: {{ .Values.namespace }}
  labels:
    allow-from-reap-edge: "true"
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: reap-edge
      ports:
        - protocol: TCP
          port: 8080
        - protocol: TCP
          port: 3000
    - from:
        - ipBlock:
            cidr: {{ .Values.networkPolicy.livekitTunnelCidr | quote }}
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - {}
```

If the cluster default-deny is namespace-scoped only on some NS, still ship this policy. Re-check livekit tunnel CIDR at apply (`kubectl get node …-pool-livekit-… -o jsonpath='{.metadata.annotations.projectcalico\.org/IPv4IPIPTunnelAddr}'`) and `--set networkPolicy.livekitTunnelCidr=…/32` if it drifted from `10.244.217.192`.

- [ ] **Step 4: Run render script**

```bash
./ci/scripts/render-uniwork-chart.sh
```

Expected: `OK: uniwork chart render assertions passed`

- [ ] **Step 5: Commit**

```bash
git add deploy/app/uniwork ci/scripts/render-uniwork-chart.sh
git rm -f deploy/app/uniwork-be/values.yml 2>/dev/null || true
git commit -m "feat(deploy): add uniwork helm chart for REAP guest"
```

---

### Task 4: Jenkinsfile + rollout script

**Files:**
- Modify: `ci/Jenkinsfile.production-app.groovy` (replace incomplete file)
- Create: `ci/scripts/rollout-uniwork.sh`

**Interfaces:**
- Consumes: Harbor `registry-harbor.ubos.vn/uniwork`, digests in `target/digests/{uniwork-be,uniwork-fe}.digest`
- Produces: `helm upgrade --install uniwork` only when `CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s`

- [ ] **Step 1: Write rollout script with fail-closed confirm**

`ci/scripts/rollout-uniwork.sh`:

```bash
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
```

- [ ] **Step 2: Dry-run refuse without confirm**

```bash
chmod +x ci/scripts/rollout-uniwork.sh
CLUSTER_APPLY_CONFIRM=wrong BE_DIGEST=sha256:abc FE_DIGEST=sha256:def IMAGE_TAG=x ./ci/scripts/rollout-uniwork.sh
```

Expected: exit 2, `REFUSE: CLUSTER_APPLY_CONFIRM`.

- [ ] **Step 3: Complete Jenkinsfile**

Replace `ci/Jenkinsfile.production-app.groovy` with a valid declarative pipeline:

- `agent none`
- params: `BRANCH` default `develop`; `DEPLOY` true; `CLUSTER_APPLY_CONFIRM` default `''` (description: set `reap-eng-prod-k8s` to mutate); Git/Harbor credential IDs as today
- `environment.REGISTRY = 'registry-harbor.ubos.vn/uniwork'`
- `stages { stage('Build images') { agent { label '107.188' } stages { Checkout, Guard BRANCH==develop, Registry Login, Build BE, Build FE, Prepare } } }`
- Build FE **must** pass:

```groovy
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://uniwork.ubos.vn \
  --build-arg NEXT_PUBLIC_WS_URL=wss://uniwork.ubos.vn \
  --build-arg NEXT_PUBLIC_APP_URL=https://uniwork.ubos.vn \
  -t ${imageName} -f apps/web/Dockerfile .
```

- Build BE: `-f server/Dockerfile ./server` (unchanged)
- Keep `pushImage` capturing RepoDigest into `target/digests/<svc>.digest`
- Prepare writes `target/rollout.env` with `IMAGE_TAG`, both digests; `stash` `target/**,deploy/app/uniwork/**,ci/scripts/**`
- `stage('Approve') { when { expression { return params.DEPLOY } } input message: 'Deploy develop images to reap-eng-prod-k8s?' }`
- `stage('Rollout') { agent { label 'production-k8s' } when { allOf { expression { params.DEPLOY }; expression { params.CLUSTER_APPLY_CONFIRM == 'reap-eng-prod-k8s' } } } }` unstash, `. target/rollout.env`, export `CLUSTER_APPLY_CONFIRM`, `BE_DIGEST`, `FE_DIGEST`, `IMAGE_TAG`, run `ci/scripts/rollout-uniwork.sh`

Guard:

```groovy
if (params.BRANCH != 'develop') {
  error("production-app refuses BRANCH=${params.BRANCH}; use develop")
}
```

Fix the current file: wrap stages in `stages { }`; add Approve/Rollout; change confirm string from `uniwork-develop-k8s`.

- [ ] **Step 4: Syntax check Jenkinsfile locally if `groovy` exists; otherwise review `pipeline { stages {` nesting matches REAP `ci/Jenkinsfile.production-app.groovy`**

```bash
# optional
groovy -e 'true'
```

- [ ] **Step 5: Commit**

```bash
git add ci/Jenkinsfile.production-app.groovy ci/scripts/rollout-uniwork.sh
git commit -m "ci: helm digest rollout to reap-eng-prod-k8s from develop"
```

---

### Task 5: Edge TLS + APISIX manifests

**Files:**
- Create: `deploy/edge/clusterissuer.yaml`
- Create: `deploy/edge/certificate.yaml`
- Create: `deploy/edge/apisix-tls.yaml`
- Create: `deploy/edge/upstreams.yaml`
- Create: `deploy/edge/route.yaml`

**Interfaces:**
- Consumes: operator-supplied ACME email at apply; DNS already on cluster LB
- Produces: Secret `reap-edge/uniwork-tls`; routes host `uniwork.ubos.vn`

- [ ] **Step 1: Write manifests**

`deploy/edge/clusterissuer.yaml` — leave email as `${ACME_EMAIL}` **is not valid YAML**. Use:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-http01
  labels:
    app.kubernetes.io/part-of: uniwork
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: replace-at-apply@example.invalid
    privateKeySecretRef:
      name: letsencrypt-http01-account-key
    solvers:
      - http01:
          ingress:
            class: apisix
```

Runbook will `sed` the email before apply. Do not invent a real mailbox in Git.

`deploy/edge/certificate.yaml`:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: uniwork-tls
  namespace: reap-edge
spec:
  secretName: uniwork-tls
  dnsNames:
    - uniwork.ubos.vn
  issuerRef:
    name: letsencrypt-http01
    kind: ClusterIssuer
    group: cert-manager.io
```

`deploy/edge/apisix-tls.yaml`:

```yaml
apiVersion: apisix.apache.org/v2
kind: ApisixTls
metadata:
  name: uniwork-tls
  namespace: reap-edge
spec:
  hosts:
    - uniwork.ubos.vn
  secret:
    name: uniwork-tls
    namespace: reap-edge
```

`deploy/edge/upstreams.yaml` (same `externalNodes` Domain pattern as `deploy/edge-config/apisix-routes/32-private-admin-grafana.yaml` in REAP):

```yaml
apiVersion: apisix.apache.org/v2
kind: ApisixUpstream
metadata:
  name: uniwork-be
  namespace: reap-edge
spec:
  scheme: http
  passHost: pass
  timeout: { connect: 5s, read: 60s, send: 60s }
  externalNodes:
    - type: Domain
      name: uniwork-be.uniwork.svc.cluster.local
      port: 8080
      weight: 100
---
apiVersion: apisix.apache.org/v2
kind: ApisixUpstream
metadata:
  name: uniwork-fe
  namespace: reap-edge
spec:
  scheme: http
  passHost: pass
  timeout: { connect: 5s, read: 60s, send: 60s }
  externalNodes:
    - type: Domain
      name: uniwork-fe.uniwork.svc.cluster.local
      port: 3000
      weight: 100
```

`deploy/edge/route.yaml`:

```yaml
apiVersion: apisix.apache.org/v2
kind: ApisixRoute
metadata:
  name: uniwork
  namespace: reap-edge
spec:
  ingressClassName: apisix
  http:
    - name: uniwork-api
      priority: 200
      websocket: true
      match:
        hosts: [uniwork.ubos.vn]
        paths: [/api, /api/*]
      upstreams:
        - name: uniwork-be
    - name: uniwork-web
      priority: 100
      websocket: true
      match:
        hosts: [uniwork.ubos.vn]
        paths: [/, /*]
      upstreams:
        - name: uniwork-fe
```

- [ ] **Step 2: Offline validate YAML**

```bash
python3 -c "import yaml,sys; [yaml.safe_load_all(open(p)) for p in [
  'deploy/edge/clusterissuer.yaml','deploy/edge/certificate.yaml',
  'deploy/edge/apisix-tls.yaml','deploy/edge/upstreams.yaml','deploy/edge/route.yaml']]"
```

Expected: no parse error.

- [ ] **Step 3: Commit**

```bash
git add deploy/edge
git commit -m "feat(deploy): APISIX and cert-manager manifests for uniwork.ubos.vn"
```

Do **not** `kubectl apply` in this task (runbook Task 7). If HTTP-01 Ingress is not picked up by APISIX IC, runbook adds a challenge ApisixRoute — do not guess solver Service name in Git.

---

### Task 6: LiveKit webhook NetPol + config runbook snippet

**Files:**
- Create: `deploy/livekit/allow-hostnetwork-uniwork-webhook.yaml`
- Create: `deploy/livekit/README.md`

**Interfaces:**
- Consumes: Calico IPIP tunnel of current pool-livekit worker (default `10.244.217.192/32`, same as LMS webhook NetPol)
- Produces: ingress to `uniwork-be:8080` from LiveKit hostNetwork

- [ ] **Step 1: Write NetPol** (namespace `uniwork`, podSelector `app.kubernetes.io/name: uniwork-be`, from ipBlock tunnel CIDR, port 8080). Mirror comments from REAP `deploy/integrations/livekit/manifests/30-allow-lms-core-webhook-hostnetwork.yaml`.

- [ ] **Step 2: README apply steps (no secrets)**

```markdown
# LiveKit shared webhook (UniWork guest)

Webhook URL to add (keep existing lms-core URL):

http://uniwork-be.uniwork.svc.cluster.local:8080/api/v1/integrations/livekit/webhook

LiveKit `webhook` has one api_key and a list of urls. Edit secret
`reap-integrations/livekit-server-config` key `livekit.yaml` on bastion
(do not commit the rendered YAML). Rolling restart `deploy/livekit` after.

Discover tunnel CIDR:
kubectl get node -l workload=livekit \
  -o jsonpath='{.items[0].metadata.annotations.projectcalico\.org/IPv4IPIPTunnelAddr}{"\n"}'

Apply NetPol with that /32 if different from 10.244.217.192.
```

- [ ] **Step 3: Commit**

```bash
git add deploy/livekit
git commit -m "feat(deploy): LiveKit hostNetwork webhook access to uniwork-be"
```

---

### Task 7: Guest runbook (SQL, secrets, apply order, smoke, teardown)

**Files:**
- Create: `runbooks/production/uniwork-guest.md`

**Interfaces:**
- Consumes: bastion/`production-k8s` kubectl, existing `redis-cache-auth` and `livekit-keys`
- Produces: operator-run sequence; no secret values in the file

- [ ] **Step 1: Write the runbook** with these exact sections:

1. **Prereq:** `export KUBECONFIG=$HOME/.kube/reap-prod`
2. **Postgres (bastion, not Zalando CR):**

```sql
CREATE ROLE uniwork LOGIN PASSWORD '<generate>';
CREATE DATABASE uniwork OWNER uniwork;
\c uniwork
GRANT ALL ON SCHEMA public TO uniwork;
```

3. **Namespace + pull secret:** create ns if needed; copy `harbor-registry` from `reap-app` (or recreate dockerconfigjson).
4. **App secrets** (literal keys only):

```bash
kubectl -n uniwork create secret generic uniwork-db --from-literal=DATABASE_URL='postgres://uniwork:…@reap-postgresql-pooler.reap-data.svc.cluster.local:5432/uniwork?sslmode=disable'
kubectl -n uniwork create secret generic uniwork-redis --from-literal=REDIS_URL='redis://:…@redis-cache-master.reap-data.svc.cluster.local:6379/15'
kubectl -n uniwork create secret generic uniwork-app --from-literal=JWT_SECRET='<32+ chars>'
# copy api-key/api-secret from reap-integrations/livekit-keys into LIVEKIT_API_KEY / LIVEKIT_API_SECRET
kubectl -n uniwork create secret generic uniwork-livekit --from-literal=LIVEKIT_API_KEY='…' --from-literal=LIVEKIT_API_SECRET='…'
```

5. **Edge:** substitute ACME email → apply ClusterIssuer → Certificate → wait Ready → ApisixTls → Upstreams/Route. If HTTP-01 stuck, inspect `cm-acme-http-solver` and add challenge route.
6. **LiveKit:** apply NetPol; add webhook URL; restart livekit.
7. **App:** Jenkins `develop` + `CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s` (or local `rollout-uniwork.sh` after images exist). Confirm pods on pool-app:

```bash
kubectl -n uniwork get pods -o wide
```

8. **Smoke:**

```bash
kubectl -n uniwork exec deploy/uniwork-be -- wget -qO- http://127.0.0.1:8080/healthz
kubectl -n uniwork exec deploy/uniwork-be -- wget -qO- http://127.0.0.1:8080/readyz
curl -fsS https://uniwork.ubos.vn/ | head
curl -fsS https://uniwork.ubos.vn/api/v1/config | head
# Redis DB 15: from redis-cache-master, SELECT 15; DBSIZE > 0 after login
```

Webhook: one LMS classroom + one UniWork meeting; LMS test in Task 1 already covers ignore; UniWork must not enqueue LMS `main-room`.

9. **Teardown:** delete ApisixRoute/Tls/Certificate; remove UniWork webhook URL; `helm uninstall uniwork -n uniwork`; `kubectl delete ns uniwork`; `DROP DATABASE uniwork; DROP ROLE uniwork;`. Leave LMS ignore-unresolved patch in place.

- [ ] **Step 2: Commit**

```bash
git add runbooks/production/uniwork-guest.md
git commit -m "docs: runbook to land and tear down UniWork on REAP k8s"
```

---

## Spec coverage (self-check)

| Spec requirement | Task |
| --- | --- |
| ns `uniwork`, 1 pod each, pool-app | 3 |
| Helm + digest pin | 3, 4 |
| Jenkins develop / confirm `reap-eng-prod-k8s` | 4 |
| FE NEXT_PUBLIC origins | 4 |
| Manual Postgres user/db + secrets | 7 |
| Redis master DB 15 | 3, 7 |
| LiveKit multi-URL + hostNetwork NetPol | 6 |
| UniWork room prefix filter (`uw_mtg_` + `uw-voice-`) | 2 |
| LMS ignore unresolved rooms | 1 |
| APISIX path `/api` + `/` + websocket + externalNodes | 5 |
| HTTP-01 cert `uniwork-tls` | 5, 7 |
| Smoke + teardown | 7 |
| No Zalando CR / no Argo / no recording | global — no task |

## Execution order on cluster

1. Merge/deploy Task 1 `lms-core` (REAP pipeline) **before** adding the second LiveKit webhook URL.
2. Task 2 in UniWork image (Jenkins build).
3. Task 7 secrets + SQL.
4. Task 6 LiveKit NetPol + webhook URL.
5. Task 4 Helm rollout (needs images + secrets).
6. Task 5/7 edge TLS+routes after or in parallel with workloads (Certificate can precede pods; routes need Services).
