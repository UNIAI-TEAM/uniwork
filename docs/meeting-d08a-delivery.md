# D08a delivery report — Meeting Control Plane

UniWork is the meeting control plane (Postgres). LiveKit is reached only through
`ConferenceProvider`. This report is the Must-have close-out for D08a, with a
**scale upgrade addendum** (P0–P5, 2026-03) reflecting production-hardening work
after the initial delivery.

**Related docs:** `meeting-livekit-implementation-plan.md`, `meeting-livekit-architecture-diagrams.md`, `meeting-scale-upgrade-plan.md`.

## 1. Lifecycle

Scheduled create, instant create, PATCH (no status/host), start, end, cancel
(DELETE on SCHEDULED), host transfer. Conditional version updates. Audit rows in
the same transaction as the business write.

## 2. Participants and RSVP

Invite workspace members, list participants, RSVP
(`PUT .../invitations/{id}/response`). Remove revokes grants and enqueues
RemoveParticipant. DECLINED does not revoke grants.

## 3. Invite links

Raw secret returned once; stored as SHA-256. Resolve is public and rate-limited
with credential routes. Revoke + max_uses via conditional UPDATE. Public page:
`/invite/meeting/{linkId}` with `#secret=`. Guest room route:
`/invite/meeting/{linkId}/room` (anonymous join with `display_name` + `uw_guest` cookie).

## 4. Join requests

Create/reuse PENDING, approve/reject with conditional UPDATE. REMOVED
participants are not reactivated. Requester may cancel via public
`POST /meeting-join-requests/{id}/cancel` (member JWT or guest cookie). Host
panel invalidates join-request query keys on realtime events.

## 5. Admission

Every join and the deprecated token route calls `Evaluate` then, if ADMIT,
`IssueJoinCredential`. Host on SCHEDULED → `WAITING_FOR_HOST`. Provider not
READY/SYNCED → `WAITING_FOR_PROVIDER` (read-only check — **no sync**
`ensureProviderSession` on `/join`; outbox or Start/Instant sync handles ensure).
WS `conference.session_ready` notifies lobby when provider SYNCED. No RoomAdmin
on client tokens.

## 6. LiveKit adapter

Room `uw_mtg_{meetingID}`, identity `uw_participant_{participantID}`. SDK
`server-sdk-go/v2`. Fake provider in unit tests. Optional
`//go:build livekit` / `LIVEKIT_INTEGRATION=1` for a live server (skipped in CI).
Token TTL default **30m** (`LIVEKIT_TOKEN_TTL`). `LIVEKIT_ROOM_EMPTY_TIMEOUT=0`
(default) → adapter uses 24h; control plane owns lifecycle via `EndMeeting`.

## 7. Webhook

Signed LiveKit webhook. Handler **enqueues** `webhook_inbox` and returns 200
immediately. Worker dedup + `HandleProviderEvent`. Attendance/session only;
`meetings.status` does not change. `ReconcileStaleAttendance` sweeper (5m).

## 8. Outbox

`outbox_events` with claim `SKIP LOCKED`, lease, exponential backoff,
`DEAD_LETTER` after max attempts. LiveKit calls **outside** DB transaction.
Topics: provider ensure/remove/end. `RunWorkers` in `main.go` shutdown
sequence (outbox + webhook inbox every **1s**, batch **50**, webhook parallel
**×8** — tunable via `MEETING_WORKER_*` env). Realtime publishes after commit
with `meeting_id` + `version`. `ReconcileProviderDesync` auto-enqueues ensure
when desync detected. Migration `034`: webhook inbox pending index.

## 9. Queries

List (existing) plus activity and statistics SQL endpoints.

## 10. Frontend

Lobby states (including `WAITING_FOR_PROVIDER`), WS-driven lobby retry
(`use-lobby-join-retry`) with jitter 0–3s and exponential backoff fallback —
**no 4s poll**. Workspace members use `/api/v1/ws`; public guest room uses
`MeetingLobbyWSProvider` → `GET .../lobby-ws`. Events include
`conference.session_ready`. Token refresh only on unexpected LiveKit disconnect
(no proactive timer). LiveKit opts: `adaptiveStream`, `dynacast`,
`onlySubscribed: true`. Host panel (start/end/cancel, invite, RSVP, join
requests, remove, transfer, invite link copy), room uses `POST /join` not raw
token, public guest invite flow, i18n vi/en.

## 11. Permissions

`canDeleteMeeting` / host actions = current host or workspace owner/admin.

## 12. OpenAPI

Routes registered through `apiOp` + SDI/SDO. New path params:
`participantID`, `invitationID`, `linkId`, `requestId`. Public routes use
`OptionalAuth` where guest cookie applies.

## 13. Local LiveKit

`docker-compose.livekit.yml` + `livekit.dev.yaml`. `make start` / `make dev`
runs `scripts/ensure-livekit.sh` and streams container logs. Env knobs in
`.env.example`. Production sample: `livekit.production.yaml.example`.

## 14. Tests

Go: state machine, admission (incl. `WAITING_FOR_PROVIDER`), invitations,
transfer, join-request + guest cancel, invite-link hash, fake adapter, webhook
inbox + does not change status, attendance idempotent + reconcile, outbox
lease/dead-letter/concurrent claim, workspace isolation.

Frontend: join malformed-response, splitMeetings, realtime debounce + version,
admission UI, lobby retry.

Load: k6 scripts in `scripts/load/`.

## 15. Deliberate breaks

Identity, TTL, room name, join instead of token. Deprecated `POST .../token`
still admits then returns `{token,url}` for old clients (`Deprecation` header).

## 16. Should / later (out of initial D08a)

**Delivered in scale upgrade (2026-03):** guest cookie + public invite room;
webhook inbox async; Prometheus meeting metrics + lag gauges; attendance
reconcile; WS version + debounce; provider desync reconcile + auto-heal;
k6 load scripts; join read-only hot path (P4); guest lobby WS + per-route rate
limits; worker throughput tuning + migration 034 (P5).

**Still later (P6+):** Active speaker UI, attendance WS events, list
pagination, DB partition. Idempotency-Key header, AUDIENCE subscribe-only role,
full Grafana dashboards, remove deprecated `/token` route,
calendar/recording/transcript/AI/breakout/recurring, reactivate-participant
command.

## 17. Risks recorded

Short TTL vs reconnect: FE re-joins on unexpected disconnect only (30m TTL).
Dual approve: conditional PENDING update. max_uses: `used_count < max_uses`.
Cross-workspace: `RequireMember` on `m.workspace_id`. Live rooms from dot-1
identities will not match — accepted. Provider desync if LiveKit empty timeout
fires: mitigated by `LIVEKIT_ROOM_EMPTY_TIMEOUT=0` + `ReconcileProviderDesync`
(auto-enqueue ensure on desync).

## 18. Scale upgrade summary (P0–P5)

| Phase | Delivered |
| --- | --- |
| **P0** | WS-driven lobby; TTL 30m; outbox lease/dead-letter; `WAITING_FOR_PROVIDER`; LiveKit FE opts; prod config sample |
| **P1** | Webhook inbox async; attendance reconcile; WS `version` + debounce 250ms; guest cookie; meeting metrics |
| **P2** | Attendance idempotent; EmptyTimeout policy; provider desync reconcile; lag gauges; k6 load |
| **P3** | Guest public invite + room route; guest cancel join-request; outbox concurrent claim test |
| **P4** | Join read-only (no sync ensure); `conference.session_ready`; guest lobby WS; jitter 0–3s; per-route rate limits |
| **P5** | Migration 034 pending index; desync auto-heal; worker 1s/batch 50/webhook ×8 |

Migrations: `030_outbox_events_lease`, `031–032_webhook_inbox`, `033_attendance_open_uidx`, `034_webhook_inbox_pending_idx`.

Observability: see `meeting-livekit-architecture-diagrams.md` §19.
