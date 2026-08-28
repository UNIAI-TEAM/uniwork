# D08a delivery report — Meeting Control Plane

UniWork is the meeting control plane (Postgres). LiveKit is reached only through
`ConferenceProvider`. This report is the Must-have close-out for D08a.

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
`/invite/meeting/{linkId}` with `#secret=`.

## 4. Join requests

Create/reuse PENDING, approve/reject with conditional UPDATE. REMOVED
participants are not reactivated. Host panel invalidates join-request query
keys on realtime events.

## 5. Admission

Every join and the deprecated token route calls `Evaluate` then, if ADMIT,
`IssueJoinCredential`. Host on SCHEDULED → `WAITING_FOR_HOST`. No RoomAdmin on
client tokens.

## 6. LiveKit adapter

Room `uw_mtg_{meetingID}`, identity `uw_participant_{participantID}`. SDK
`server-sdk-go/v2`. Fake provider in unit tests. Optional
`//go:build livekit` / `LIVEKIT_INTEGRATION=1` for a live server (skipped in CI).

## 7. Webhook

Signed LiveKit webhook. Dedup on `provider_event_id`. Attendance/session only;
`meetings.status` does not change.

## 8. Outbox

Minimal `outbox_events` + worker in `main.go` shutdown sequence. Topics:
provider ensure/remove/end. Realtime still publishes after commit.

## 9. Queries

List (existing) plus activity and statistics SQL endpoints.

## 10. Frontend

Lobby states, host panel (start/end/cancel, invite, RSVP, join requests, remove,
transfer, invite link copy), room uses `join` not raw token, i18n vi/en.

## 11. Permissions

`canDeleteMeeting` / host actions = current host or workspace owner/admin.

## 12. OpenAPI

Routes registered through `apiOp` + SDI/SDO. New path params:
`participantID`, `invitationID`, `linkId`, `requestId`.

## 13. Local LiveKit

`docker-compose.livekit.yml` + `livekit.dev.yaml`. Env knobs in `.env.example`.

## 14. Tests

Go: state machine, admission, invitations, transfer, join-request, invite-link
hash, fake adapter, webhook does not change status, workspace isolation.
Frontend: join malformed-response, splitMeetings, realtime keys, admission UI.

## 15. Deliberate breaks

Identity, TTL, room name, join instead of token. Deprecated `POST .../token`
still admits then returns `{token,url}` for old clients.

## 16. Should / later (out of D08a)

Guest cookie complete, Prometheus meeting metrics, Idempotency-Key table,
calendar/recording/transcript/AI/breakout/recurring, reactivate-participant
command.

## 17. Risks recorded

Short TTL vs reconnect: FE re-joins. Dual approve: conditional PENDING update.
max_uses: `used_count < max_uses`. Cross-workspace: `RequireMember` on
`m.workspace_id`. Live rooms from dot-1 identities will not match — accepted.
