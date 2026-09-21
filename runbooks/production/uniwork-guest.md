# UniWork guest on REAP production Kubernetes

Operator sequence to land and tear down UniWork as an isolated guest on `reap-eng-prod-k8s`: shared Postgres pooler, Redis DB 15, LiveKit, and APISIX edge. **Do not commit or paste secret values** into tickets or this file—use placeholders and bastion-only edits.

**Prerequisite (REAP LMS, Task 1):** Deploy the `lms-core` patch that ignores unresolved LiveKit room names **before** adding UniWork as a second webhook URL on the shared LiveKit server. Without it, LMS may mis-handle events when multiple webhooks are registered.

**Repo paths:** manifests under `deploy/edge/`, `deploy/app/uniwork/`, `deploy/livekit/`; rollout via `ci/Jenkinsfile.production-app.groovy` and `ci/scripts/rollout-uniwork.sh`.

---

## 1. Prereq

Run kubectl from a host with cluster access (Jenkins agent `production-k8s` or bastion with the same kubeconfig):

```bash
export KUBECONFIG=$HOME/.kube/reap-prod
kubectl cluster-info
```

Confirm you can read `reap-data`, `reap-edge`, `reap-integrations`, and create resources in namespace `uniwork`.

---

## 2. Postgres (bastion, not Zalando CR)

Connect to REAP Postgres **on the bastion** (admin session). Do **not** edit the Zalando Postgres CR or operator-managed users.

Generate a strong password for role `uniwork` and run:

```sql
CREATE ROLE uniwork LOGIN PASSWORD '<generate>';
CREATE DATABASE uniwork OWNER uniwork;
\c uniwork
GRANT ALL ON SCHEMA public TO uniwork;
```

Use that password only when building `DATABASE_URL` in the next steps (Secret `uniwork-db`).

---

## 3. Namespace + pull secret

Create namespace `uniwork` if it does not exist:

```bash
kubectl create namespace uniwork --dry-run=client -o yaml | kubectl apply -f -
```

Harbor pull secret (copy from `reap-app`, or recreate an equivalent `dockerconfigjson` for `registry-harbor.ubos.vn`):

```bash
kubectl get secret harbor-registry -n reap-app -o yaml \
  | sed 's/namespace: reap-app/namespace: uniwork/' \
  | kubectl apply -f -
```

Verify: `kubectl -n uniwork get secret harbor-registry`.

---

## 4. App secrets

Create Secrets in `uniwork` with **literal keys only**. Substitute generated or copied values at apply time; never store them in git.

Redis password: read from existing `reap-data` Secret `redis-cache-auth` (key as deployed today). LiveKit API credentials: copy `api-key` and `api-secret` from `reap-integrations/livekit-keys` (same pair LiveKit server uses).

```bash
kubectl -n uniwork create secret generic uniwork-db --from-literal=DATABASE_URL='postgres://uniwork:…@reap-postgresql-pooler.reap-data.svc.cluster.local:5432/uniwork?sslmode=disable'
kubectl -n uniwork create secret generic uniwork-redis --from-literal=REDIS_URL='redis://:…@redis-cache-master.reap-data.svc.cluster.local:6379/15'
kubectl -n uniwork create secret generic uniwork-app --from-literal=JWT_SECRET='<32+ chars>'
# copy api-key/api-secret from reap-integrations/livekit-keys into LIVEKIT_API_KEY / LIVEKIT_API_SECRET
kubectl -n uniwork create secret generic uniwork-livekit --from-literal=LIVEKIT_API_KEY='…' --from-literal=LIVEKIT_API_SECRET='…'
```

If a Secret already exists, delete and recreate or use `kubectl create secret … --dry-run=client -o yaml | kubectl apply -f -` during iteration.

---

## 5. Edge

From UniWork repo root with `KUBECONFIG` set:

1. Edit `deploy/edge/clusterissuer.yaml`: replace `replace-at-apply@example.invalid` with the real ACME contact email.
2. Apply in order; wait for TLS material before routing public traffic.

```bash
kubectl apply -f deploy/edge/clusterissuer.yaml
kubectl apply -f deploy/edge/certificate.yaml
kubectl wait --for=condition=Ready certificate/uniwork-tls -n reap-edge --timeout=600s
kubectl apply -f deploy/edge/apisix-tls.yaml
kubectl apply -f deploy/edge/upstreams.yaml
kubectl apply -f deploy/edge/route.yaml
```

**HTTP-01 stuck:** inspect cert-manager challenge pods and solver routes (`cm-acme-http-solver` in `reap-edge`). Ensure APISIX can reach the HTTP-01 solver; add or fix the challenge route if the Certificate stays `Pending` (same pattern as other REAP HTTP-01 hosts).

Certificate Secret `uniwork-tls` in `reap-edge` must exist before `ApisixTls` references it. Upstreams/Routes need Services `uniwork-be` and `uniwork-fe` in `uniwork` (from Helm rollout).

---

## 6. LiveKit

Shared LiveKit server must call UniWork over cluster DNS. Details: `deploy/livekit/README.md`.

1. **NetworkPolicy:** Host-network LiveKit reaches `uniwork-be` via the Calico IPIP tunnel address on the pool-livekit node.

   ```bash
   kubectl apply -f deploy/livekit/allow-hostnetwork-uniwork-webhook.yaml
   ```

   If the tunnel CIDR differs from the manifest default, discover it (command in README), update the YAML, then apply.

   **Note (Helm):** Chart `deploy/app/uniwork` already allows the same tunnel CIDR in `templates/networkpolicy.yaml` via `values.yaml` (`networkPolicy.livekitTunnelCidr`). After `helm upgrade --install uniwork`, that rule is present; the standalone manifest under `deploy/livekit/` is optional for ops who apply NetPol before Helm or want parity with the LMS repo layout. Avoid conflicting duplicate policies—keep CIDRs equivalent if both are used.

2. **Webhook URL:** Edit `reap-integrations/livekit-server-config` key `livekit.yaml` on the bastion—**keep** the existing LMS webhook URL; **add**:

   `http://uniwork-be.uniwork.svc.cluster.local:8080/api/v1/integrations/livekit/webhook`

   Do not commit rendered LiveKit config.

3. **Restart LiveKit** after config change: rolling restart `deploy/livekit` in `reap-integrations` (or namespace where LiveKit runs today).

Only perform step 2–3 after Task 1 LMS patch is live in production.

---

## 7. App

**Preferred:** Jenkins job `ci/Jenkinsfile.production-app.groovy` on branch `develop`, with deploy enabled and:

`CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s`

Pipeline builds/pushes Harbor images with digest pins, then runs `ci/scripts/rollout-uniwork.sh` on agent `production-k8s`.

**Local/bastion** (after images exist in Harbor and `BE_DIGEST`, `FE_DIGEST`, `IMAGE_TAG` are known):

```bash
export CLUSTER_APPLY_CONFIRM=reap-eng-prod-k8s
export BE_DIGEST=sha256:…
export FE_DIGEST=sha256:…
export IMAGE_TAG=…
ci/scripts/rollout-uniwork.sh
```

Confirm workloads schedule on **pool-app** and become Ready:

```bash
kubectl -n uniwork get pods -o wide
```

---

## 8. Smoke

In-cluster health:

```bash
kubectl -n uniwork exec deploy/uniwork-be -- wget -qO- http://127.0.0.1:8080/healthz
kubectl -n uniwork exec deploy/uniwork-be -- wget -qO- http://127.0.0.1:8080/readyz
```

Public edge (after Certificate + routes):

```bash
curl -fsS https://uniwork.ubos.vn/ | head
curl -fsS https://uniwork.ubos.vn/api/v1/config | head
```

Redis DB 15: from `redis-cache-master` in `reap-data`, `SELECT 15;` then `DBSIZE`—expect `> 0` after a successful login/session flow.

**LiveKit webhook:** Run one LMS classroom session and one UniWork meeting. Task 1 LMS tests already cover ignore behavior for UniWork-prefixed rooms. Confirm UniWork does **not** enqueue LMS `main-room` (or other LMS-only room names) from shared webhook traffic.

---

## 9. Teardown

Reverse guest footprint; **leave** the LMS ignore-unresolved patch deployed (do not roll back Task 1 for teardown).

1. Remove public edge (order flexible; ensure no traffic to guest):

   ```bash
   kubectl delete -f deploy/edge/route.yaml --ignore-not-found
   kubectl delete -f deploy/edge/upstreams.yaml --ignore-not-found
   kubectl delete -f deploy/edge/apisix-tls.yaml --ignore-not-found
   kubectl delete -f deploy/edge/certificate.yaml --ignore-not-found
   ```

   Optionally remove `ClusterIssuer` `letsencrypt-http01` only if no other host uses it.

2. Edit LiveKit `livekit.yaml`: remove the UniWork webhook URL; keep LMS URL; rolling restart LiveKit.

3. Uninstall app and namespace:

   ```bash
   helm uninstall uniwork -n uniwork
   kubectl delete ns uniwork
   ```

4. Postgres on bastion:

   ```sql
   DROP DATABASE uniwork;
   DROP ROLE uniwork;
   ```

5. Optional: delete standalone NetPol `deploy/livekit/allow-hostnetwork-uniwork-webhook.yaml` if applied separately and no longer needed.

Harbor images and Jenkins history can remain; guest data should not.
