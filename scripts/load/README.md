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
