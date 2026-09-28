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
`write-mixed.k6.js` (p95 write ≤ 400 ms) and `read-5000.k6.js`
(report only until phase C — OPEN_QUESTIONS O5). Shared login and thresholds
live in `perf-lib.js`; results are uploaded for 90 days and a red nightly
opens or updates the `perf` issue. Locally:

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
