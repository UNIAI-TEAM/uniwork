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
