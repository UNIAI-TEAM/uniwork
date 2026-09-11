# D08a — Meeting Control Plane + LiveKit adapter

Tài liệu triển khai. Specs/plans trong `docs/` viết tiếng Việt; comment trong code tiếng Anh.

**Tài liệu đồng bộ:** sơ đồ chi tiết và luồng runtime → `docs/meeting-livekit-architecture-diagrams.md`. Kế hoạch scale P4–P6 → `docs/meeting-scale-upgrade-plan.md`.

## Trạng thái triển khai (audit scale P0–P5, 2026-03)

| Phase | Nội dung chính | Trạng thái |
| --- | --- | --- |
| **D08a gốc** | Control plane, admission, LiveKit adapter, lobby cơ bản | ✅ |
| **P0** | WS-driven lobby; TTL 30m; outbox lease/dead-letter; `WAITING_FOR_PROVIDER`; LiveKit FE opts; prod config mẫu | ✅ |
| **P1** | Webhook inbox async; attendance reconcile; WS `version` + debounce 250ms; guest cookie; meeting metrics | ✅ |
| **P2** | Attendance idempotent; EmptyTimeout control-plane; provider desync reconcile; lag gauges; k6 load scripts | ✅ |
| **P3** | Guest public invite + `/invite/meeting/{id}/room`; guest cancel join-request; outbox concurrent test | ✅ |
| **P4** | Join read-only; `conference.session_ready`; guest lobby WS; jitter; rate limit per-route | ✅ |
| **P5** | Migration 034; desync auto-heal; worker 1s/batch 50/parallel webhook | ✅ |
| **P6** | Active speaker UI; attendance WS; pagination; partition | ⏳ Later |

Migrations bổ sung sau D08a: `030` outbox lease, `031–032` webhook inbox, `033` attendance open unique index, **`034` webhook inbox pending index**.

---

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

## 1. Hiện trạng repository (sau D08a + scale upgrade)

Modular monolith: Go 1.27, Chi, pgx/v5 + sqlc, Redis Streams + gorilla/websocket, Prometheus, OpenAPI từ `apiOp`.

Meetings **control plane đầy đủ** (migrations 008+, worker `RunWorkers`): lifecycle, admission, participants, invite links, join requests, conference sessions, attendance, audit, outbox production-grade, webhook inbox, guest cookie (`uw_guest`), meeting Prometheus metrics.

LiveKit: `github.com/livekit/server-sdk-go/v2`, room `uw_mtg_{id}`, identity `uw_participant_{id}`, adapter cache `RoomServiceClient`. Compose local: `docker-compose.livekit.yml`. Production mẫu: `livekit.production.yaml.example`.

Frontend: lobby WS-driven (`use-lobby-join-retry`) — workspace WS **hoặc** meeting lobby WS trên invite routes; `POST /join` read-only provider check (không sync LiveKit); jitter 0–3s trên WS-trigger; token refresh chỉ khi LiveKit disconnect bất thường; public invite guest không cần login.

Migration mới: **008+** và **030–034**; không `REFERENCES`, index `CREATE [UNIQUE] INDEX CONCURRENTLY` một statement/file.

## 2. Thành phần tái sử dụng

User/workspace/org ULID; `RequireMember`; `util.NewID`; `decode` + 1 MiB cap; rate limit Redis; SDI/SDO + `pathParamSDI`; `EventPublisher` + `use-realtime-sync`; `testutil.DB`; notes; permission mirror; `MintToken` được mở rộng grant (không RoomAdmin).

## 3. Khoảng trống (đã bổ sung)

Các hạng mục D08a ban đầu đã có: state machine, host, participants/invitations/grants/links/join requests, conference sessions, attendance, audit, admission, RoomService, webhook inbox, opaque identity, outbox worker, guest cookie, history + statistics, meeting metrics, LiveKit compose local.

**Còn lại (Later / P6):** role AUDIENCE subscribe-only, Idempotency-Key header, calendar/recording/transcript, multi-provider runtime, active speaker layout, attendance WS events, list pagination, DB partition.

## 4. Kiến trúc mục tiêu

UniWork = Meeting Control Plane (DB = SoT). LiveKit = Conference Provider.

```
Client → Chi handler → MeetingService → Postgres (SoT)
                      → outbox_events + webhook_inbox → RunWorkers → ConferenceProvider → LiveKit
LiveKit webhook → verify → enqueue inbox → 200 OK → worker → HandleProviderEvent (attendance/session)
MeetingService → EventPublisher (payload meeting_id + version) → Redis/WS
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
- `webhook_inbox` (async xử lý webhook LiveKit)
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

**Join:** luôn Evaluate mới. ADMIT → **chỉ đọc** `conferenceSessionReady` (không gọi LiveKit trên HTTP path) → `IssueJoinCredential` khi SYNCED/READY|ACTIVE. `WAITING_FOR_PROVIDER` khi session chưa sync — client retry qua WS `conference.session_ready` / backoff. Ensure room: Start/Instant sync best-effort + outbox worker + desync reconcile auto-enqueue.

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
| POST | `/public/meeting-invite-links/resolve` | public (`OptionalAuth`, mint `uw_guest` nếu anonymous) |
| POST | `/meetings/{meetingID}/join` | public (`OptionalAuth`, 120 req/min/IP) |
| GET | `/meetings/{meetingID}/lobby-ws` | public (guest cookie hoặc JWT; 30 connect/min/IP; off OpenAPI) |
| POST | `/meetings/{meetingID}/join-requests` | public (`OptionalAuth`, body `display_name` cho guest) |
| GET | `/meetings/{meetingID}/join-requests` | host list (member) |
| POST | `/meeting-join-requests/{requestId}/approve\|reject` | host (member) |
| POST | `/meeting-join-requests/{requestId}/cancel` | public (requester user hoặc guest cookie) |
| GET | `/meetings/{meetingID}/activity` | member |
| GET/POST | notes (giữ) | member |
| POST | `/meetings/{meetingID}/token` | deprecated (`Deprecation` header → dùng `/join`) |
| POST | `/integrations/livekit/webhook` | chữ ký LiveKit → inbox, 200 ngay |

Join body: `invite_link_id`, `secret`, `display_name` (guest bắt buộc khi chưa login).

Join ADMIT: `decision`, `meeting_status`, `conference_session_id`, `provider`, `server_url`, `participant_token`, `expires_at`.

Admission thêm: `WAITING_FOR_PROVIDER` (phòng provider chưa READY/SYNCED).

Mã lỗi: `not_meeting_host`, `invalid_meeting_state`, `cannot_remove_current_host`, `invalid_host_transferee`, `participant_removed`, `invite_link_invalid|expired|revoked|limit_reached`, `join_request_already_decided`, `meeting_not_started|ended|canceled`, `provider_unavailable`, `livekit_not_configured`, `guest_unavailable`.

`pathParamSDI`: `participantID`, `invitationID`, `linkId`, `requestId`.

## 10. Database migration

008: ALTER `meetings` + CREATE bảng (không FK). 009–029: index CONCURRENTLY. **030:** outbox lease. **031–032:** `webhook_inbox` + unique. **033:** unique open attendance per participant. **034:** `idx_webhook_inbox_pending (status, next_attempt_at) WHERE PENDING`. Down tương ứng.

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

`github.com/livekit/server-sdk-go/v2` + protocol auth/webhook. Room `uw_mtg_{id}`, identity `uw_participant_{participant_id}`. Token: RoomJoin, grants qua `MediaPermissionsForRole` (MODERATOR/ATTENDEE full media; hook cho AUDIENCE sau), **không** RoomAdmin. TTL `LIVEKIT_TOKEN_TTL` mặc định **30 phút**. `LIVEKIT_ROOM_EMPTY_TIMEOUT=0` (mặc định) → adapter dùng 24h — control plane owns lifecycle qua `EndMeeting`, không để LiveKit auto-close desync.

Giới hạn: JWT cũ còn dùng được đến hết TTL sau khi remove; mitigation = RemoveParticipant ngay + không cấp token mới.

Transaction: commit nghiệp vụ trước; provider lỗi → `provider_sync_status` PENDING/FAILED + outbox retry. Không rollback ENDED vì DeleteRoom lỗi.

## 13. Admission

`Evaluate` → ADMIT | WAITING_FOR_HOST | WAITING_APPROVAL | **WAITING_FOR_PROVIDER** | DENY.

Thuật toán theo brief (meeting scope workspace, ENDED/CANCELED deny, REMOVED deny, host scheduled → waiting_for_host, grant active, invite link AUTO_ADMIT/REQUEST_APPROVAL, allow_join_request). Mọi cấp credential gọi lại Evaluate.

## 14. Audit và outbox

Audit cùng tx; payload whitelist (id, status, không secret/token/cookie/Authorization).

Outbox: claim `SKIP LOCKED` + lease 120s; LiveKit **ngoài** transaction; exponential backoff; `DEAD_LETTER` sau 10 attempts. Worker `RunWorkers` trong `main.go`: mặc định tick **1s**, outbox/webhook batch **50**, webhook xử lý song song (**8** goroutines, env `MEETING_*`); attendance + provider desync reconcile mỗi 5 phút (desync → auto-enqueue `provider.ensure_session`). Sau ensure SYNCED → WS `conference.session_ready`.

## 15. Webhook

Raw body. `webhook.ReceiveWebhookEvent`. Handler **enqueue** `webhook_inbox`, trả 200 ngay. Worker dedup + `HandleProviderEvent`: session/attendance; `room_finished` đóng attendance mở; dedup `provider_event_id` + inbox unique. Không đổi `meetings.status`.

## 16. Realtime

WS workspace (`/api/v1/ws`) + **meeting lobby WS** (`/api/v1/meetings/{id}/lobby-ws`) cho guest/invite; payload gồm `meeting_id` + **`version`**. Publisher dual-fanout lobby events sang scope `meeting:{id}`.

Frontend `use-realtime-sync`: debounce 250ms; version skip trên meeting detail. Lobby retry: `meeting.started`, `join_request.approved`, **`conference.session_ready`** — jitter 0–3s; fallback backoff 10s→60s khi WS chưa auth. Invite routes dùng `MeetingLobbyWSProvider`.

## 17. File cần tạo/sửa

Xem PR/implementation. Chính: `docs/meeting-livekit-implementation-plan.md`; migrations 008+; `pkg/db/queries/meeting_*.sql`; `internal/meetings/provider.go`, adapter, fake; `internal/service/meeting_*.go`; handlers/router/sdi/sdo; `internal/service/outbox.go`; frontend core/views/apps; `.env.example`; `docker-compose.livekit.yml`; `livekit.dev.yaml`.

## 18. Thứ tự triển khai (lịch sử)

D08a: P0 docs → schema → lifecycle → participants → admission → LiveKit → webhook → frontend → quality.

Scale upgrade (2026-03): P0–P3 lobby/token/outbox/inbox/guest → **P4** join hot path + lobby WS + jitter → **P5** worker throughput + migration 034 + desync heal.

## 19. Rủi ro

TTL JWT vs kick; EnsureSession vs DB fail (tên phòng deterministic); race approve/max_uses/start (conditional UPDATE); isolation workspace; breaking identity LiveKit so với dot-1.

## 20. Test plan

State machine; admission matrix (WAITING_FOR_PROVIDER, join không gọi provider); invitation RSVP; host transfer; join request + guest cancel; invite link; fake adapter; webhook inbox; attendance idempotent + reconcile; outbox lease/dead-letter/concurrent claim; **AllowLobbyListen**; go test -race; FE lobby jitter + `conference.session_ready`; k6 load (`scripts/load/`).

## 21. Tiêu chí nghiệm thu

Đúng Definition of Done trong brief D08a (state, audit, instant, RSVP, remove, transfer, link, join request, token sau admission, opaque ids, webhook, history isolation, lint/test).

## 22. Must / Should / Later

**Must:** bốn trạng thái, audit, scheduled+instant, invite+RSVP, add/remove+RemoveParticipant, transfer, invite link, join request, admission, token, EndSession, history+stats SQL, test trọng, OpenAPI, env, compose LiveKit dev, FE lobby+host tối thiểu.

**Should (đã có):** guest cookie + public invite room + **meeting lobby WS**; webhook inbox + worker parallel; Prometheus meeting counters + lag gauges; attendance reconcile sweeper; **desync auto-heal**; join read-only hot path.

**Later (P6+):** calendar, recording, transcript, AI, breakout, recurring, multi-provider, AUDIENCE role, Idempotency-Key header, active speaker UI, list pagination, DB partition.

## Production notes

LiveKit production: TLS, TURN/UDP, secret manager, webhook reachable. Mẫu: `livekit.production.yaml.example`. Không Egress/recording trong D08a.

## Observability

Prometheus (`internal/metrics/meetings.go`, `meeting_lag.go`):

- `uniwork_meeting_join_decisions_total{decision}`
- `uniwork_meeting_outbox_*` / `uniwork_meeting_webhook_*` counters
- `uniwork_meeting_outbox_oldest_pending_seconds` / `uniwork_meeting_webhook_inbox_oldest_pending_seconds` (gauge)
- `uniwork_meeting_provider_desync_total`

Load test staging: `scripts/load/README.md`. Worker env: `MEETING_WORKER_TICK`, `MEETING_OUTBOX_BATCH`, `MEETING_WEBHOOK_BATCH`, `MEETING_WEBHOOK_CONCURRENCY`. Chi tiết alert/partition → `meeting-livekit-architecture-diagrams.md` §19; kế hoạch P4–P6 → `meeting-scale-upgrade-plan.md`.
