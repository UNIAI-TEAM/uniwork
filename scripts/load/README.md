# Meeting load tests (k6)

Scripts to benchmark control-plane admission under concurrent lobby/join load.
Run against a staging API with valid credentials — not included in `make check`.

## Prerequisites

```bash
brew install k6   # or see https://grafana.com/docs/k6/latest/set-up/install-k6/
export API_BASE_URL=https://staging.example.com
export ACCESS_TOKEN=<workspace member JWT>
export MEETING_ID=<in-progress meeting id>
```

## Scenarios

| Script | Purpose | Target SLO (staging) |
| --- | --- | --- |
| `meeting-join.k6.js` | POST `/join` admission under ramp | p95 < 500ms, error rate < 1% |
| `meeting-lobby-wait.k6.js` | Waiting lobby (no ADMIT) | stable 429/403 rate, no 5xx |

## Run

```bash
k6 run scripts/load/meeting-join.k6.js
k6 run scripts/load/meeting-lobby-wait.k6.js
```

## Capacity notes

- **10k lobby users** without WS-driven retry ≈ 2.5k RPS on `/join` (4s poll) — unsustainable.
- After P0/P1: lobby should be WS-driven; use this suite to validate post-fix RPS.
- Scale API horizontally; one outbox/webhook worker per node shares Postgres claim via `SKIP LOCKED`.
- Alert on `uniwork_meeting_outbox_oldest_pending_seconds` and `uniwork_meeting_webhook_inbox_oldest_pending_seconds` > 30s.

## Nightly (F-11)

`.github/workflows/perf-nightly.yml` seeds a synthetic dataset with
`go run ./cmd/seed --orgs 50 --users 5000 --tasks 1000000` (server/cmd/seed)
and runs, in order: `smoke.k6.js` (50 VU, also on PRs labelled `perf`),
`read-500.k6.js` (mandatory: p95 ≤ 200 ms, errors < 0.1%),
`write-mixed.k6.js` (p95 write ≤ 400 ms), `read-5000.k6.js` and
`chat-read-5000.k6.js` (chat room + message reads; report only until phase C —
OPEN_QUESTIONS O5). Shared login and thresholds live in `perf-lib.js`; results
are uploaded for 90 days and a red nightly opens or updates the `perf` issue.
Locally:

```sh
DATABASE_URL=… go run ./server/cmd/seed --orgs 5 --users 200 --tasks 20000
BASE_URL=http://localhost:8080 SEED_USERS=200 k6 run scripts/load/smoke.k6.js
```

## Documents (C-01 §9.4, G1-09)

Three baselines for the documents module, run by hand (not in CI, not in the
nightly yet). The API needs `FF_DOCUMENTS=true`, and `TRUSTED_PROXIES=127.0.0.1/32,::1/128`
so each simulated user gets its own rate-limit budget from the
`X-Forwarded-For` that `documents-lib.js` sends (without it every VU shares
one IP and the run measures 429s).

| Script | Dataset | Target (staging) |
| --- | --- | --- |
| `documents-autosave.k6.js` | 200 users of `perf-org-0`, one page each (created in `setup`) | 200 KiB PATCH every 2 s, p95 < 150 ms |
| `documents-search.k6.js` | 20k pages in `perf-org-0` (`documents-seed.sql`) | `?q=` trigram search p95 < 200 ms |
| `documents-quota.k6.js` | 100k pages in `perf-org-1` (`documents-seed.sql`) | `CountStorageBytesInOrganization` < 50 ms (EXPLAIN); the HTTP snapshot threshold is a loose 250 ms guard |

```sh
# fresh database, migrations applied, then:
DATABASE_URL=… go run ./server/cmd/seed --orgs 2 --users 400 --tasks 0
psql "$DATABASE_URL" -v org_slug=perf-org-0 -v n=20000  -v tag=search -f scripts/load/documents-seed.sql
psql "$DATABASE_URL" -v org_slug=perf-org-1 -v n=100000 -v tag=quota  -f scripts/load/documents-seed.sql
FF_DOCUMENTS=true TRUSTED_PROXIES=127.0.0.1/32,::1/128 server/bin/server &
k6 run scripts/load/documents-autosave.k6.js
k6 run scripts/load/documents-search.k6.js
k6 run scripts/load/documents-quota.k6.js
```

The quota scenario reaches the query through the entitlement snapshot
(`GET /orgs/{id}/billing`), which also counts members, workspaces and tasks;
its HTTP p95 is an upper bound. Time the query itself with
`EXPLAIN (ANALYZE, BUFFERS)` of `CountStorageBytesInOrganization`
(`server/pkg/db/queries/usage.sql`) for the organization id of `perf-org-1`.
Record the host, versions and dataset beside the numbers; a local run says
nothing about another machine.

## Work Graph (C-11 §9)

Run by hand, not in CI or the nightly. Two databases, because the load set and
the rebuild checks cannot share an organization: `graph-seed.sql` writes
synthetic edges that no source row backs, so `graph-rebuild --verify` counts
them as drift and a plain `graph-rebuild` closes them.

**Neighbors p95 at 1M edges** (target p95 < 200 ms). `graph-seed.sql` puts
~5 edges on every real task of one organization (OWNED_BY to a member,
BELONGS_TO and three DEPENDS_ON to other tasks), so 200k tasks give ~1M edges
and layer 2 still reads real tasks. The API needs `graph_ui` on for that
organization: `FF_GRAPH_UI=true` at start, or a global `graph_ui` override.
The requests spread over 500 task paths and the global rate limit counts per
user and path (300/min), so the run stays under it without `TRUSTED_PROXIES`.

```sh
# fresh database, migrations applied (cd server && go run ./cmd/migrate up), then:
(cd server && DATABASE_URL=… go run ./cmd/seed --orgs 1 --users 200 --tasks 200000)
psql "$DATABASE_URL" -v org_id=<perf-org-0 id> -v tag=graphload -f scripts/load/graph-seed.sql
FF_GRAPH_UI=true server/bin/server &
BASE_URL=http://localhost:8080 k6 run scripts/load/graph-neighbors.k6.js
# without a local k6:
docker run --rm -v "$PWD/scripts/load:/load:ro" -e BASE_URL=http://host.docker.internal:8080 \
  grafana/k6 run /load/graph-neighbors.k6.js
```

**Rebuild, verify and origin** run on a second database with no
`graph-seed.sql`:

1. `go run ./cmd/seed --orgs 1 --tasks 100000` (from `server/`), then time
   `go run ./cmd/graph-rebuild --org <id>` (the first full projection).
2. Start the API with `FF_GRAPH=true FF_GRAPH_UI=true` and make real changes
   through it: a meeting, tasks from it (`POST /meetings/{id}/summary/tasks`),
   reassignments, status, due dates and dependencies. Wait until
   `SELECT count(*) FROM graph_dirty` is 0.
3. `go run ./cmd/graph-rebuild --org <id> --verify` must print `drift=0`.
4. Every task made from a meeting has an open `ORIGINATED_FROM` edge to it;
   this must count 0:

```sql
SELECT count(*) FROM tasks t
WHERE t.organization_id = :'org_id' AND t.origin_type = 'meeting'
  AND EXISTS (SELECT 1 FROM meetings m WHERE m.id = t.origin_id)
  AND NOT EXISTS (
    SELECT 1 FROM graph_nodes n
    JOIN graph_edges e ON e.from_node = n.id AND e.edge_type = 'ORIGINATED_FROM' AND e.valid_to IS NULL
    JOIN graph_nodes p ON p.id = e.to_node AND p.node_type = 'MEETING' AND p.source_id = t.origin_id
    WHERE n.organization_id = t.organization_id AND n.node_type = 'TASK' AND n.source_id = t.id);
```

`cmd/seed` writes no member profiles and no workspace status catalog, and puts
every organization on the default plan. Before step 1, add the profiles (the
`INSERT` at the end of `server/migrations/134_organization_member_profiles.up.sql`;
read paths assume every member has one). Before step 2, add the status catalog
(`server/migrations/131_seed_task_status_catalog.up.sql`; without it a task
create answers 400 `status không hợp lệ`) and lift the task cap, which the
default plan sets at 200 (a create answers 403 `quota_exceeded`):

```sql
UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code = 'business')
WHERE organization_id = :'org_id';
```
