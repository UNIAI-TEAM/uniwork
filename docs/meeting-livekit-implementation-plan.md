# D08a — Meeting Control Plane + LiveKit adapter

Tài liệu triển khai. Specs/plans trong `docs/` viết tiếng Việt; comment trong code tiếng Anh.

## Giả định (suy từ convention repo, không hỏi lại)

- **W1-03** = tổ chức + workspace + membership. Cổng duy nhất: `WorkspaceService.RequireMember`. Không tạo lại bảng User/Workspace.
- **W1-05** = Project. **Chưa có module.** `project_id` nullable TEXT, không FK, không validate tồn tại. Không tạo bảng `projects`.
- Không tách microservice. Layer: `handler` → `service` → `pkg/db` (sqlc). Không dựng `internal/meeting/` hexagonal song song.
- `ConferenceProvider` sống trong package sẵn có `server/internal/meetings/`. Protobuf LiveKit chỉ trong adapter + webhook mapper.
- RSVP (`invitation.response_status`) **không** đồng nhất AccessGrant. DECLINED không tự thu hồi grant. Chỉ RemoveParticipant / RevokeAccess / revoke invite-link mới thu hồi.
- Cột wire giữ `description` (agenda), `starts_at`/`ends_at` (lịch dự kiến). Không rename cột 003.
- `meetings.room_name` là cột legacy opaque; nguồn sự thật phòng provider là `meeting_conference_sessions`. Token không đọc `room_name` để cấp quyền.
- JSON API `snake_case`. Mã lỗi máy đọc `snake_case` (ErrorSDO), không SCREAMING_SNAKE.
- DELETE HTTP trên meeting SCHEDULED = cancel (không hard-delete). ENDED/CANCELED/IN_PROGRESS → `invalid_meeting_state`.
- Host điều hành = `host_user_id` **hoặc** workspace owner/admin. Member thường không cancel/start/end.
- Guest Must-have tối thiểu: cookie HttpOnly ký HMAC (`uw_guest`) khi resolve/join public mà chưa đăng nhập. Không dùng display name làm identity.
- Realtime Must: `EventPublisher` sau commit (như tasks). Outbox bắt buộc cho thao tác provider cần retry (RemoveParticipant, EndSession).
- CreateRoom: phương án A — `EnsureSession` khi Start/Instant, tên phòng deterministic `uw_mtg_{meeting_id}`. Không giữ transaction DB khi gọi mạng.

---

## 1. Hiện trạng repository

Modular monolith: Go 1.27, Chi, pgx/v5 + sqlc, Redis Streams + gorilla/websocket, Prometheus, OpenAPI phản chiếu từ `apiOp` (`docs/api-sdi-sdo.md`).

Meetings **dot-1** (migration 003, frozen FK): CRUD, notes, attendee creator, `POST /meetings/{id}/token` mint JWT LiveKit sau `Get` (membership only). Identity = user id, TTL 6 giờ, không RoomAdmin check nhưng cũng không RoomService. `github.com/livekit/protocol v1.50.4` — chưa `server-sdk-go/v2`.

Auth JWT `RequireAuth`. Lỗi `mapServiceError`. Tx mẫu: `AcceptInvite`. Không outbox. `events.Bus` wired, chưa subscribe. Compose: Postgres + Redis, không LiveKit. Frontend: list/detail/room.

Migration mới: **008+**, không `REFERENCES`, index `CREATE [UNIQUE] INDEX CONCURRENTLY` một statement/file.

## 2. Thành phần tái sử dụng

User/workspace/org ULID; `RequireMember`; `util.NewID`; `decode` + 1 MiB cap; rate limit Redis; SDI/SDO + `pathParamSDI`; `EventPublisher` + `use-realtime-sync`; `testutil.DB`; notes; permission mirror; `MintToken` được mở rộng grant (không RoomAdmin).

## 3. Khoảng trống cần bổ sung

State machine, host, participants/invitations/grants/links/join requests, conference sessions, attendance, audit append-only, admission, RoomService, webhook, opaque identity, outbox worker, guest cookie, `project_id`, history + statistics, metrics meeting, LiveKit compose local.

## 4. Kiến trúc mục tiêu

UniWork = Meeting Control Plane (DB = SoT). LiveKit = Conference Provider.

```
Client → Chi handler → MeetingService
                      → AdmissionPolicyService → Postgres
                      → outbox_events → worker → ConferenceProvider → LiveKit
LiveKit webhook → verify → provider-neutral event → attendance/session sync (không đổi meetings.status)
MeetingService → EventPublisher → Redis/WS
```

## 5. Ranh giới Control Plane / LiveKit

LiveKit **không** quyết định: host, RSVP, grant, link còn hạn, join request, meeting canceled/ended.

LiveKit **được**: media room, join JWT (RoomJoin, đúng room/identity, TTL ngắn), RemoveParticipant, DeleteRoom, webhook phòng/attendance.

Webhook `room_started` / `room_finished` **không** chuyển SCHEDULED↔IN_PROGRESS↔ENDED.

## 6. ERD

Bảng 003 giữ nguyên. 008+ thêm cột `meetings` và bảng:

- `meeting_participants` (USER/GUEST, ATTENDEE/MODERATOR, ACTIVE/REMOVED). Không role HOST — host là `meetings.host_user_id`.
- `meeting_invitations` (PENDING/ACCEPTED/DECLINED/TENTATIVE)
- `meeting_access_grants` (ACTIVE/REVOKED/EXPIRED; CREATOR/DIRECT_INVITE/INVITE_LINK/JOIN_APPROVAL/ADMIN)
- `meeting_invite_links` (`secret_hash` SHA-256, không raw secret)
- `meeting_join_requests`
- `meeting_conference_sessions`
- `meeting_attendance_sessions`
- `meeting_audit_logs` (append-only)
- `outbox_events`
- `meeting_guests`
- `meeting_provider_events` (dedup webhook)

Backfill: `host_user_id = created_by`, status/type SCHEDULED, version 1, participant+grant CREATOR từ `meeting_attendees`. Không DROP `meeting_attendees`; service mới không ghi.

## 7. State machine

Cho phép: SCHEDULED→IN_PROGRESS, SCHEDULED→CANCELED, IN_PROGRESS→ENDED.

Cấm: IN_PROGRESS→CANCELED, mọi chuyển từ ENDED/CANCELED.

Không auto theo `starts_at`/`ends_at`. Conditional UPDATE + `version`. Mọi chuyển ghi audit + WS.

PATCH: không `status`/`host_user_id`. SCHEDULED: title, description, times, timezone, allow_join_request, project_id. IN_PROGRESS: title, description, allow_join_request — không sửa lịch dự kiến.

## 8. Sequence (tóm tắt)

**Start:** host|admin → row SCHEDULED + version → session PENDING → status IN_PROGRESS, actual_start_at, audit, outbox ensure → commit → EnsureSession (mạng) → WS `meeting.started`.

**Instant:** tạo INSTANT + host participant + CREATOR grant + MEETING_CREATED + cùng luồng start → IN_PROGRESS + MEETING_STARTED.

**Join:** luôn Evaluate mới. ADMIT → IssueJoinCredential + `Cache-Control: no-store`. WAITING_FOR_HOST / WAITING_APPROVAL / DENY không token.

**Remove:** không gỡ host hiện tại → REMOVED + revoke grants → commit → outbox RemoveParticipant. Không cấp token mới dù LiveKit lỗi.

**Transfer:** lock version → `host_user_id` mới (USER ACTIVE, member workspace) → audit HOST_TRANSFERRED. Join request PENDING không gắn host cũ.

**Invite link:** secret ≥32 byte crypto; hash SHA-256; raw một lần. Fragment `#secret=` phía FE. Revoke: `revoked_at` + revoke grant INVITE_LINK. `used_count` atomic khi cấp grant principal mới.

**Approve:** UPDATE PENDING→APPROVED một hàng; không tự reactivate REMOVED; grant JOIN_APPROVAL cùng tx.

**End:** IN_PROGRESS→ENDED, expire grants/join requests PENDING, outbox EndSession. Meeting vẫn ENDED nếu DeleteRoom lỗi.

## 9. API contract (`/api/v1`, snake_case)

| Method | Path | Auth |
| --- | --- | --- |
| GET/POST | `/workspaces/{workspaceID}/meetings` | member |
| POST | `/workspaces/{workspaceID}/meetings/instant` | member |
| GET | `/workspaces/{workspaceID}/meeting-statistics` | member |
| GET/PATCH | `/meetings/{meetingID}` | member |
| DELETE | `/meetings/{meetingID}` | host\|admin, = cancel nếu SCHEDULED |
| POST | `/meetings/{meetingID}/start\|end\|cancel\|host-transfer` | host\|admin |
| GET/POST | `/meetings/{meetingID}/participants` / invitations | member / host invite |
| PUT | `/meetings/{meetingID}/invitations/{invitationID}/response` | invitee |
| DELETE | `/meetings/{meetingID}/participants/{participantID}` | host\|admin |
| GET/POST | `/meetings/{meetingID}/invite-links` | host\|admin |
| POST | `/meetings/{meetingID}/invite-links/{linkId}/revoke` | host\|admin |
| POST | `/public/meeting-invite-links/resolve` | public, rate limit |
| POST/GET | `/meetings/{meetingID}/join-requests` | user / host list |
| POST | `/meeting-join-requests/{requestId}/approve\|reject\|cancel` | host / requester |
| POST | `/meetings/{meetingID}/join` | user hoặc guest cookie |
| GET | `/meetings/{meetingID}/activity` | member |
| GET/POST | notes (giữ) | member |
| POST | `/meetings/{meetingID}/token` | deprecated: cùng admission, envelope cũ `{token,url}` khi ADMIT |
| POST | `/integrations/livekit/webhook` | chữ ký LiveKit |

Join body: `invite_link_id`, `secret` optional.

Join ADMIT: `decision`, `meeting_status`, `conference_session_id`, `provider`, `server_url`, `participant_token`, `expires_at`.

Mã lỗi: `not_meeting_host`, `invalid_meeting_state`, `cannot_remove_current_host`, `invalid_host_transferee`, `participant_removed`, `invite_link_invalid|expired|revoked|limit_reached`, `join_request_already_decided`, `meeting_not_started|ended|canceled`, `provider_unavailable`, `livekit_not_configured`.

`pathParamSDI`: `participantID`, `invitationID`, `linkId`, `requestId`.

## 10. Database migration

008: ALTER `meetings` + CREATE bảng (không FK). 009+: từng unique/secondary index CONCURRENTLY. Down tương ứng. Truncate `testutil.DB`.

UTC trong timestamptz. `timezone` IANA cho hiển thị (mặc định `UTC`).

## 11. ConferenceProvider

```go
type ConferenceProvider interface {
  Key() string
  Capabilities(ctx context.Context) ConferenceCapabilities
  EnsureSession(ctx context.Context, req EnsureSessionRequest) (ProviderSessionRef, error)
  IssueJoinCredential(ctx context.Context, req IssueJoinCredentialRequest) (JoinCredential, error)
  RemoveParticipant(ctx context.Context, req RemoveProviderParticipantRequest) error
  UpdateParticipant(ctx context.Context, req UpdateProviderParticipantRequest) error
  EndSession(ctx context.Context, req EndProviderSessionRequest) error
}
```

Capabilities: TokenizedJoin, RemoveParticipant, UpdateParticipantPermissions, Webhooks, Recording, Transcription, DataChannel (cờ; Recording/Transcription false ở D08a).

## 12. LiveKit adapter

`github.com/livekit/server-sdk-go/v2` + protocol auth/webhook. Room `uw_mtg_{id}`, identity `uw_participant_{participant_id}`. Token: RoomJoin, CanSubscribe/Publish/PublishData, **không** RoomAdmin. TTL `LIVEKIT_TOKEN_TTL` mặc định 2 phút. Env: `MEETING_PROVIDER`, `LIVEKIT_*`. Fake provider cho unit test. Integration `LIVEKIT_INTEGRATION=1` skip CI.

Giới hạn: JWT cũ còn dùng được đến hết TTL sau khi remove; mitigation = RemoveParticipant ngay + không cấp token mới.

Transaction: commit nghiệp vụ trước; provider lỗi → `provider_sync_status` PENDING/FAILED + outbox retry. Không rollback ENDED vì DeleteRoom lỗi.

## 13. Admission

`Evaluate(ctx, AdmissionContext) AdmissionDecision` — ADMIT | WAITING_FOR_HOST | WAITING_APPROVAL | DENY.

Thuật toán theo brief (meeting scope workspace, ENDED/CANCELED deny, REMOVED deny, host scheduled → waiting_for_host, grant active, invite link AUTO_ADMIT/REQUEST_APPROVAL, allow_join_request). Mọi cấp credential gọi lại Evaluate.

## 14. Audit và outbox

Audit cùng tx; payload whitelist (id, status, không secret/token/cookie/Authorization).

Outbox: `topic` `provider.ensure_session` | `provider.remove_participant` | `provider.end_session`. Worker poll trong `main`, dừng trong chuỗi shutdown.

## 15. Webhook

Raw body. `webhook.ReceiveWebhookEvent`. Dedup `provider_event_id`. Map: room_started→ConferenceRoomStarted, v.v. Chỉ session/attendance/sync.

## 16. Realtime

WS workspace, payload id-only:

`meeting.created|updated|deleted|started|ended|canceled`, `participant.invited|removed`, `invitation.responded`, `join_request.created|approved|rejected`, `host.transferred`, `invite_link.revoked`.

`meeting.deleted` vẫn phát khi cancel (tương thích FE list invalidate); status trên API là CANCELED.

## 17. File cần tạo/sửa

Xem PR/implementation. Chính: `docs/meeting-livekit-implementation-plan.md`; migrations 008+; `pkg/db/queries/meeting_*.sql`; `internal/meetings/provider.go`, adapter, fake; `internal/service/meeting_*.go`; handlers/router/sdi/sdo; `internal/service/outbox.go`; frontend core/views/apps; `.env.example`; `docker-compose.livekit.yml`; `livekit.dev.yaml`.

## 18. Thứ tự triển khai

P0 docs → P1 schema/sqlc → P2 lifecycle → P3 participants → P4 admission/links → P5 join requests → P6 LiveKit → P7 webhook → P8 queries → P9 frontend → P10 quality.

## 19. Rủi ro

TTL JWT vs kick; EnsureSession vs DB fail (tên phòng deterministic); race approve/max_uses/start (conditional UPDATE); isolation workspace; breaking identity LiveKit so với dot-1.

## 20. Test plan

State machine; admission matrix; invitation RSVP; host transfer; join request concurrency; invite link hash/expiry/revoke/max_uses; fake adapter (room, identity, no roomAdmin); webhook chữ ký + không đổi status; cross-workspace; go test/vet/staticcheck; FE malformed + views; e2e smoke (join admission).

## 21. Tiêu chí nghiệm thu

Đúng Definition of Done trong brief D08a (state, audit, instant, RSVP, remove, transfer, link, join request, token sau admission, opaque ids, webhook, history isolation, lint/test).

## 22. Must / Should / Later

**Must:** bốn trạng thái, audit, scheduled+instant, invite+RSVP, add/remove+RemoveParticipant, transfer, invite link, join request, admission, token, EndSession, history+stats SQL, test trọng, OpenAPI, env, compose LiveKit dev, FE lobby+host tối thiểu.

**Should:** guest cookie hoàn chỉnh (có bản tối thiểu), attendance+webhook đầy đủ, worker retry backoff, Prometheus đủ bộ, Idempotency-Key header.

**Later:** calendar, recording, transcript, AI, breakout, recurring, multi-provider runtime, reactivate command (REMOVED → 409, host mời lại sau).

## Production notes

LiveKit production: TLS, TURN/UDP, secret manager, webhook reachable, không dùng secret compose. Không Egress/recording trong D08a.

## Observability

Counters: meeting created/started/ended/canceled, join decision, join request, livekit token/api/webhook. Log: request_id, meeting_id, workspace_id, actor_id, provider, operation — không token/secret.
