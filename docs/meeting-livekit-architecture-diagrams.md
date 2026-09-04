# Sơ đồ hoạt động: UniWork Meeting Control Plane + LiveKit

Tài liệu mô tả kiến trúc, luồng xử lý và tích hợp LiveKit trong module meetings của UniWork.
Bổ sung cho `meeting-livekit-implementation-plan.md`, `meeting-d08a-delivery.md` và `meeting-scale-upgrade-plan.md` (P4–P5).

**Nguyên tắc cốt lõi:** UniWork = Meeting Control Plane (Postgres là nguồn sự thật). LiveKit = Conference Provider (media plane). Hai bên giao tiếp qua `ConferenceProvider`, `RunWorkers` (outbox lease + webhook inbox) và webhook — **không** để LiveKit quyết định trạng thái cuộc họp, host hay quyền vào phòng.

---

## Mục lục

1. [Kiến trúc tổng thể](#1-kiến-trúc-tổng-thể)
2. [Ranh giới Control Plane vs LiveKit](#2-ranh-giới-control-plane-vs-livekit)
3. [State machine cuộc họp](#3-state-machine-cuộc-họp)
4. [Mô hình dữ liệu (ERD rút gọn)](#4-mô-hình-dữ-liệu-erd-rút-gọn)
5. [Luồng tạo họp lịch → Start → Mở phòng LiveKit](#5-luồng-tạo-họp-lịch--start--mở-phòng-livekit)
6. [Luồng Instant Meeting](#6-luồng-instant-meeting)
7. [Luồng Join / Admission](#7-luồng-join--admission)
8. [Luồng Invite Link (public)](#8-luồng-invite-link-public)
9. [Luồng Join Request (approve/reject)](#9-luồng-join-request-approvereject)
10. [Luồng Remove Participant](#10-luồng-remove-participant)
11. [Luồng End Meeting](#11-luồng-end-meeting)
12. [Luồng Webhook LiveKit → Attendance](#12-luồng-webhook-livekit--attendance)
13. [Outbox Worker (retry provider ops)](#13-outbox-worker-retry-provider-ops)
14. [Realtime WebSocket (Control Plane → Frontend)](#14-realtime-websocket-control-plane--frontend)
15. [Stack Frontend phòng họp](#15-stack-frontend-phòng-họp)
16. [Bảng tóm tắt API theo vai trò](#16-bảng-tóm-tắt-api-theo-vai-trò)
17. [Chạy local LiveKit](#17-chạy-local-livekit)
18. [Tham chiếu mã nguồn](#18-tham-chiếu-mã-nguồn)
19. [Production scale — observability & partition](#19-production-scale--observability--partition)

---



## 1. Kiến trúc tổng thể

```mermaid
flowchart TB
    subgraph Client["Client (Browser)"]
        FE["Next.js App<br/>packages/views/meetings/"]
        LKC["livekit-client<br/>@livekit/components-react"]
    end

    subgraph UniWork["UniWork API (Go)"]
        H["Chi Handler<br/>internal/handler/"]
        MS["MeetingService<br/>internal/service/"]
        WS["WorkspaceService<br/>RequireMember"]
        AP["Admission Evaluate → Join"]
        WK["RunWorkers<br/>outbox + webhook inbox 1s<br/>reconcile 5m"]
        WH["LiveKit Webhook<br/>enqueue → 200 OK"]
        EP["EventPublisher"]
    end

    subgraph Data["Persistence"]
        PG[("PostgreSQL<br/>meetings, participants,<br/>grants, sessions, outbox")]
        RD[("Redis Streams<br/>realtime relay")]
    end

    subgraph Media["Media Plane"]
        LK["LiveKit Server<br/>docker-compose.livekit.yml<br/>:7880 ws, :50000-50020 udp"]
    end

    FE -->|"REST /api/v1/*"| H
    FE -->|"WebSocket workspace hoặc lobby-ws"| RD
    FE -->|"WebRTC + DataChannel"| LKC
    LKC -->|"JWT + ws://"| LK

    H --> MS
    MS --> WS
    MS --> AP
    MS --> PG
    MS --> EP
    EP --> RD
    RD --> FE

    MS -->|"EnsureSession / IssueJoinCredential<br/>RemoveParticipant / EndSession"| LK
    WK -->|"retry provider ops"| LK
    LK -->|"signed webhook events"| WH
    WH -->|"InsertWebhookInbox"| PG
    WK -->|"ProcessWebhookInbox → HandleProviderEvent"| MS

    MS -.->|"enqueue after commit"| PG
    WK -.->|"ClaimPendingOutbox / WebhookInbox"| PG
```





### Thành phần hạ tầng


| Thành phần           | Vai trò                                                       |
| -------------------- | ------------------------------------------------------------- |
| **PostgreSQL**       | Nguồn sự thật: lifecycle, participants, grants, audit, outbox |
| **Redis**            | Rate limit, WS relay giữa các node API                        |
| **LiveKit** (`7880`) | Phòng media `uw_mtg_{meeting_id}`                             |
| **Outbox + webhook worker** | `RunWorkers`: claim SKIP LOCKED, lease, dead-letter; webhook inbox async |




### Layer backend

- Client → Chi handler → MeetingService → Postgres (SoT)
                      → outbox_events + webhook_inbox → RunWorkers → ConferenceProvider → LiveKit
LiveKit webhook → verify → inbox → worker → attendance/session sync (không đổi meetings.status)
MeetingService → EventPublisher (meeting_id + version) → Redis/WS

---



## 2. Ranh giới Control Plane vs LiveKit

```mermaid
flowchart LR
    subgraph CP["UniWork Control Plane — QUYẾT ĐỊNH"]
        A1["Trạng thái meeting<br/>SCHEDULED → IN_PROGRESS → ENDED/CANCELED"]
        A2["Host (host_user_id)"]
        A3["AccessGrant / InviteLink / JoinRequest"]
        A4["Admission: ADMIT | WAITING | DENY"]
        A5["Audit log append-only"]
        A6["Phát WS events sau commit"]
    end

    subgraph LK["LiveKit — THỰC THI MEDIA"]
        B1["CreateRoom / DeleteRoom"]
        B2["JWT join token<br/>RoomJoin, không RoomAdmin"]
        B3["RemoveParticipant trên SFU"]
        B4["WebRTC audio/video/screenshare"]
        B5["Webhook: room/participant events"]
    end

    CP -->|"ConferenceProvider API"| LK
    LK -->|"webhook (attendance only)"| CP
```





### LiveKit **không** quyết định

- Host, RSVP, grant, link còn hạn, join request
- Meeting canceled/ended
- Chuyển trạng thái `meetings.status`



### LiveKit **được** làm

- Media room, join JWT (`RoomJoin`, đúng room/identity, TTL ngắn)
- `RemoveParticipant`, `DeleteRoom`
- Webhook phòng/attendance



### Quy tắc quan trọng


| Quy tắc           | Chi tiết                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Webhook lifecycle | `room_started` / `room_finished` **không** đổi `meetings.status`                            |
| RSVP vs grant     | `DECLINED` **không** thu hồi grant — chỉ Remove / Revoke link / End meeting                 |
| JWT sau remove    | Token cũ vẫn valid đến hết TTL → mitigation: `RemoveParticipant` ngay + không cấp token mới |
| Transaction       | Commit DB trước; gọi LiveKit sau — không giữ transaction DB khi gọi mạng                    |


---



## 3. State machine cuộc họp

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED: Create scheduled
    [*] --> IN_PROGRESS: Create instant (skip SCHEDULED lobby)

    SCHEDULED --> IN_PROGRESS: POST /start (host|admin)
    SCHEDULED --> CANCELED: DELETE /cancel

    IN_PROGRESS --> ENDED: POST /end (host|admin)

    note right of SCHEDULED
        Join → WAITING_FOR_HOST
        (chưa có token LiveKit)
    end note

    note right of IN_PROGRESS
        Join + grant → ADMIT
        → IssueJoinCredential
    end note

    ENDED --> [*]
    CANCELED --> [*]

    note left of ENDED
        Cấm mọi chuyển từ ENDED/CANCELED
        Không auto theo starts_at/ends_at
    end note
```





### Chuyển trạng thái cho phép


| Từ          | Đến         | Trigger                                     |
| ----------- | ----------- | ------------------------------------------- |
| SCHEDULED   | IN_PROGRESS | `POST /meetings/{id}/start`                 |
| SCHEDULED   | CANCELED    | `DELETE /meetings/{id}` hoặc `POST /cancel` |
| IN_PROGRESS | ENDED       | `POST /meetings/{id}/end`                   |




### Cấm

- IN_PROGRESS → CANCELED
- Mọi chuyển từ ENDED / CANCELED

Mọi chuyển dùng **conditional UPDATE + version** trong cùng transaction với audit log.

---



## 4. Mô hình dữ liệu (ERD rút gọn)

```mermaid
erDiagram
    meetings ||--o{ meeting_participants : has
    meetings ||--o{ meeting_conference_sessions : has
    meetings ||--o{ meeting_audit_logs : has
    meeting_participants ||--o{ meeting_access_grants : has
    meeting_participants ||--o| meeting_invitations : has
    meetings ||--o{ meeting_invite_links : has
    meetings ||--o{ meeting_join_requests : has
    meeting_participants ||--o{ meeting_attendance_sessions : tracks

    meetings {
        text id PK
        text workspace_id
        text status "SCHEDULED|IN_PROGRESS|ENDED|CANCELED"
        text host_user_id
        int version
        text room_name "legacy uw_mtg_{id}"
    }

    meeting_conference_sessions {
        text id PK
        text meeting_id
        text provider_room_name "uw_mtg_{meeting_id}"
        text provider_sync_status "SYNCED|FAILED|PENDING"
        text status "PENDING|READY|ACTIVE|IDLE|ENDED"
    }

    meeting_access_grants {
        text participant_id
        text source_type "CREATOR|DIRECT_INVITE|INVITE_LINK|JOIN_APPROVAL"
        text status "ACTIVE|REVOKED|EXPIRED"
    }

    outbox_events {
        text topic "provider.ensure_session|remove|end"
        json payload
        text status "PENDING|PROCESSING|DONE|DEAD_LETTER"
        timestamptz locked_until
    }

    webhook_inbox {
        text provider_event_id
        json payload
        text status "PENDING|PROCESSING|DONE|DEAD_LETTER"
    }
```





### Định danh LiveKit (opaque)


| Khái niệm            | Giá trị                           | Hàm helper                          |
| -------------------- | --------------------------------- | ----------------------------------- |
| Room name            | `uw_mtg_{meeting_id}`             | `meetings.RoomNameForMeeting()`     |
| Participant identity | `uw_participant_{participant_id}` | `meetings.IdentityForParticipant()` |
| Token TTL            | mặc định 30 phút                  | env `LIVEKIT_TOKEN_TTL`             |


Nguồn sự thật phòng provider là `meeting_conference_sessions`, không phải cột legacy `meetings.room_name`.

---



## 5. Luồng tạo họp lịch → Start → Mở phòng LiveKit

```mermaid
sequenceDiagram
    actor Host as Host (member)
    participant FE as Frontend
    participant API as MeetingService
    participant DB as PostgreSQL
    participant WK as RunWorkers
    participant LK as LiveKit

    Host->>FE: Tạo họp lịch
    FE->>API: POST /workspaces/{ws}/meetings
    API->>DB: INSERT meetings (SCHEDULED)<br/>+ host participant + CREATOR grant
    API->>DB: audit MEETING_CREATED
    API->>FE: meeting SCHEDULED
    API-->>FE: WS meeting.created

    Note over Host,LK: Đến giờ họp — host bấm Start

    Host->>FE: Start meeting
    FE->>API: POST /meetings/{id}/start
    API->>API: requireHostOrAdmin
    API->>DB: BEGIN TX
    API->>DB: CreateConferenceSession (PENDING)<br/>provider_room_name = uw_mtg_{id}
    API->>DB: StartMeeting (SCHEDULED→IN_PROGRESS)<br/>actual_start_at, version++
    API->>DB: audit MEETING_STARTED
    API->>DB: enqueue outbox provider.ensure_session
    API->>DB: COMMIT
    API-->>FE: WS meeting.started

    par Ngay lập tức (sync best-effort)
        API->>LK: EnsureSession → CreateRoom
        LK-->>API: room SID
        API->>DB: UpdateConferenceSessionStatus SYNCED/READY
    and Retry nếu lỗi mạng
        WK->>DB: ClaimPendingOutbox SKIP LOCKED
        WK->>LK: EnsureSession (idempotent, ngoài TX)
        WK->>DB: mark DONE / retry / DEAD_LETTER
    end
```



**File liên quan:** `server/internal/service/meeting_lifecycle.go` — `Start()`, `ensureProviderSession()`

---



## 6. Luồng Instant Meeting

```mermaid
sequenceDiagram
    actor User as Member
    participant API as MeetingService
    participant DB as PostgreSQL
    participant LK as LiveKit

    User->>API: POST /workspaces/{ws}/meetings/instant
    API->>DB: BEGIN TX
    API->>DB: INSERT meeting (type=INSTANT, host=User)
    API->>DB: host participant + CREATOR grant
    API->>DB: CreateConferenceSession
    API->>DB: StartMeeting → IN_PROGRESS ngay
    API->>DB: audit MEETING_CREATED + MEETING_STARTED
    API->>DB: enqueue provider.ensure_session
    API->>DB: COMMIT
    API-->>User: WS meeting.created + meeting.started
    API->>LK: ensureProviderSession (sync)
    User->>API: POST /meetings/{id}/join
    Note over User,LK: Host được ADMIT ngay (IN_PROGRESS + grant CREATOR)
    API->>LK: IssueJoinCredential → JWT (TTL mặc định 30 phút)
    User->>LK: LiveKitRoom.connect(token)
```



**File liên quan:** `server/internal/service/meeting_lifecycle.go` — `CreateInstant()`

---



## 7. Luồng Join / Admission

Mọi cấp credential (kể cả route deprecated `POST .../token`) đều gọi `Evaluate` trước, rồi `IssueJoinCredential` khi `ADMIT`.

**P4 — hot path read-only:** `POST /join` **không** gọi sync `ensureProviderSession()`. Chỉ đọc `provider_sync_status`; nếu chưa `SYNCED` → `WAITING_FOR_PROVIDER`. Outbox worker (hoặc sync best-effort ở Start/Instant) đảm nhiệm ensure; khi session SYNCED, `recordConferenceEnsure` publish WS `conference.session_ready` để lobby retry ngay.

### Sơ đồ quyết định

```mermaid
flowchart TD
    START(["POST /meetings/{id}/join"]) --> AUTH{"Đã đăng nhập<br/>hoặc guest cookie?"}
    AUTH --> EVAL["Evaluate(AdmissionContext)"]

    EVAL --> S1{"meeting.status?"}
    S1 -->|ENDED| DENY1["DENY — meeting_ended"]
    S1 -->|CANCELED| DENY2["DENY — meeting_canceled"]
    S1 -->|SCHEDULED / IN_PROGRESS| S2

    S2{"Có invite_link_id?"}
    S2 -->|Có| LINK["verifyInviteLink<br/>SHA-256 secret, max_uses, revoked"]
    LINK --> LINKMODE{"access_mode?"}
    LINKMODE -->|AUTO_ADMIT| MAT["materialize participant<br/>+ INVITE_LINK grant"]
    LINKMODE -->|REQUEST_APPROVAL| JR1["ensureJoinRequest<br/>→ WAITING_APPROVAL"]

    S2 -->|Không| S3{"participant REMOVED?"}
    S3 -->|Có| DENY3["DENY — participant_removed"]
    S3 -->|Không| S4{"user == host_user_id?"}
    S4 -->|Có| STATUS1["decisionForStatus"]
    S4 -->|Không| S5{"có Active AccessGrant?"}
    S5 -->|Có| STATUS1
    S5 -->|Không| S6{"allow_join_request?"}
    S6 -->|Có| JR2["ensureJoinRequest<br/>→ WAITING_APPROVAL"]
    S6 -->|Không| DENY4["DENY — access_grant_not_found"]

    STATUS1 --> ST{"meeting.status?"}
    ST -->|SCHEDULED| WAIT["WAITING_FOR_HOST<br/>không token"]
    ST -->|IN_PROGRESS| ADMIT["ADMIT"]

    MAT --> STATUS1

    ADMIT --> SYNC{"conferenceSessionReady?<br/>provider_sync_status=SYNCED"}
    SYNC -->|Không| PREP["WAITING_FOR_PROVIDER"]
    SYNC -->|Có| CRED["IssueJoinCredential<br/>LiveKit JWT"]

    CRED --> RESP["Response:<br/>decision=ADMIT<br/>server_url, participant_token<br/>expires_at<br/>Cache-Control: no-store"]

    WAIT --> LOBBY["FE: MeetingLobby<br/>WS meeting.started / conference.session_ready<br/>/ join_request.approved<br/>fallback backoff nếu WS down"]
    PREP --> LOBBY
    JR1 --> LOBBY2["FE: chờ host approve<br/>WS join_request.approved"]
    JR2 --> LOBBY2
```





### Kết quả admission


| Decision           | Ý nghĩa                                 | Token LiveKit                      |
| ------------------ | --------------------------------------- | ---------------------------------- |
| `ADMIT`            | Được vào phòng                          | Có (`participant_token`, TTL mặc định 30 phút) |
| `WAITING_FOR_PROVIDER` | Provider chưa READY/SYNCED | Không |
| `WAITING_FOR_HOST` | Meeting SCHEDULED, chưa start | Không |
| `WAITING_APPROVAL` | Join request PENDING                    | Không                              |
| `DENY`             | Không có quyền / đã bị gỡ / đã kết thúc | Không                              |




### Frontend: kết nối phòng

```mermaid
sequenceDiagram
    participant RV as MeetingRoomView
    participant WS as WebSocket<br/>(workspace hoặc lobby-ws)
    participant API as POST /join
    participant LK as LiveKitRoom

    RV->>API: join (mount, once)
    alt decision != ADMIT
        WS-->>RV: meeting.started / conference.session_ready<br/>/ join_request.approved
        Note over RV: jitter 0–3s trước retry (tránh thundering herd)
        RV->>API: retry join (event-driven)
        Note over RV: fallback exponential backoff nếu WS chưa auth
    else ADMIT
        RV->>LK: connect(server_url, token)<br/>adaptiveStream + dynacast
        LK-->>RV: onDisconnected(unexpected)
        RV->>API: re-join chỉ khi shouldRefreshCredentialOnDisconnect
        LK-->>RV: onDisconnected(PARTICIPANT_REMOVED|ROOM_DELETED)
        RV->>RV: navigate away (shouldLeaveOnDisconnect)
    end
```



**File liên quan:**

- Backend: `server/internal/service/meeting_admission.go`, `meeting_guest.go`, `meeting_queries.go` (`recordConferenceEnsure`)
- Backend lobby WS: `server/internal/service/meeting_lobby.go`, `server/internal/realtime/meeting_lobby_ws.go`
- Frontend: `packages/views/meetings/room-view.tsx`, `meeting-lobby.tsx`, `use-lobby-join-retry.ts`, `room-connection.ts`
- Frontend lobby WS: `packages/core/realtime/meeting-lobby-provider.tsx`, `apps/web/app/invite/meeting/[linkId]/room/page.tsx`

---



## 8. Luồng Invite Link (public)

```mermaid
sequenceDiagram
    actor Guest as Khách (chưa login)
    participant FE as /invite/meeting/{linkId}#secret=
    participant API as MeetingService
    participant DB as PostgreSQL

    Note over Guest,DB: Host tạo link trước đó
    API->>DB: secret ≥32 bytes crypto → lưu SHA-256 hash<br/>raw secret trả 1 lần

    Guest->>FE: Mở URL + fragment secret
    FE->>API: POST /public/meeting-invite-links/resolve
    API->>API: EnsureGuestCookie (uw_guest) nếu anonymous
    API->>DB: verify hash, expiry, revoked, max_uses
    API-->>FE: meeting metadata (không token)

    alt Guest chưa login
        Guest->>FE: Nhập display_name → Join
    end
    Guest->>API: POST /meetings/{id}/join<br/>body: invite_link_id, secret, display_name
    alt AUTO_ADMIT + IN_PROGRESS + provider ready
        API->>DB: ConsumeInviteLinkUse (atomic)<br/>CreateParticipant + grant
        API->>LK: IssueJoinCredential
        API-->>Guest: ADMIT + token
        Guest->>FE: /invite/meeting/{linkId}/room (guest)<br/>hoặc workspace room (member)
    else REQUEST_APPROVAL
        API->>DB: CreateJoinRequest PENDING
        API-->>Guest: WAITING_APPROVAL
        API-->>Host: WS join_request.created (+ version)
    end
```



- Raw secret chỉ trả **một lần** khi tạo link; FE giữ ở URL fragment `#secret=`
- Revoke: `revoked_at` + revoke grant `INVITE_LINK`

**File liên quan:** `server/internal/service/meeting_links.go`, `meeting_guest.go`, `packages/views/meetings/public-invite-view.tsx`, `apps/web/app/invite/meeting/[linkId]/room/page.tsx`

---



## 9. Luồng Join Request (approve/reject)

```mermaid
sequenceDiagram
    actor Requester as Member/Guest
    actor Host as Host|Admin
    participant API as MeetingService
    participant DB as PostgreSQL

    Requester->>API: POST /join hoặc POST /join-requests<br/>(public, guest cookie + display_name)
    API->>DB: CreateJoinRequest PENDING (idempotent)
    API-->>Host: WS join_request.created

    Host->>API: POST /meeting-join-requests/{id}/approve
    API->>DB: BEGIN TX
    API->>DB: DecideJoinRequest PENDING→APPROVED (conditional)
    alt participant chưa tồn tại
        API->>DB: CreateParticipant + JOIN_APPROVAL grant
    else đã REMOVED
        API-->>Host: 409 participant_removed (không tự khôi phục)
    end
    API->>DB: audit JOIN_REQUEST_APPROVED
    API->>DB: COMMIT
    API-->>Requester: WS join_request.approved

    Requester->>API: POST /join
    API->>API: Evaluate → ADMIT (IN_PROGRESS + grant)
    API->>LK: IssueJoinCredential
```



---



## 10. Luồng Remove Participant

```mermaid
sequenceDiagram
    actor Host as Host|Admin
    participant API as MeetingService
    participant DB as PostgreSQL
    participant OB as Outbox
    participant LK as LiveKit
    participant User as Participant bị gỡ

    Host->>API: DELETE /participants/{participantID}
    API->>API: không gỡ host hiện tại
    API->>DB: BEGIN TX
    API->>DB: status → REMOVED
    API->>DB: RevokeGrantsForParticipant
    API->>DB: audit PARTICIPANT_REMOVED
    API->>DB: enqueue provider.remove_participant<br/>identity=uw_participant_{id}
    API->>DB: COMMIT
    API-->>Host: WS participant.removed

    OB->>LK: RemoveParticipant(room, identity)
    LK-->>User: disconnect PARTICIPANT_REMOVED
    User->>User: FE: shouldLeaveOnDisconnect → rời phòng

    Note over User,LK: JWT cũ vẫn valid đến hết TTL<br/>nhưng không cấp token mới + đã kick SFU
```



**File liên quan:** `server/internal/service/meeting_participants.go` — `RemoveParticipant()`

---



## 11. Luồng End Meeting

```mermaid
sequenceDiagram
    actor Host as Host|Admin
    participant API as MeetingService
    participant DB as PostgreSQL
    participant OB as Outbox
    participant LK as LiveKit

    Host->>API: POST /meetings/{id}/end
    API->>DB: BEGIN TX
    API->>DB: IN_PROGRESS → ENDED, actual_end_at
    API->>DB: RevokeGrantsForMeeting
    API->>DB: ExpirePendingJoinRequests
    API->>DB: EndConferenceSession
    API->>DB: enqueue provider.end_session
    API->>DB: audit MEETING_ENDED
    API->>DB: COMMIT
    API-->>Host: WS meeting.ended

    OB->>LK: DeleteRoom(uw_mtg_{id})
    Note over API,LK: Meeting vẫn ENDED dù DeleteRoom lỗi<br/>outbox retry sau
    LK-->>All: ROOM_DELETED → clients disconnect
```



Meeting vẫn `ENDED` nếu `DeleteRoom` lỗi — outbox worker retry sau.

---



## 12. Luồng Webhook LiveKit → Attendance

Webhook **không** thay đổi `meetings.status`. Handler enqueue inbox và trả 200 ngay; worker xử lý async.

```mermaid
sequenceDiagram
    participant LK as LiveKit Server
    participant WH as livekitWebhook handler
    participant IN as webhook_inbox
    participant WK as RunWorkers
    participant MS as HandleProviderEvent
    participant DB as PostgreSQL

    LK->>WH: POST /integrations/livekit/webhook<br/>(signed body)
    WH->>WH: webhook.ReceiveWebhookEvent (verify HMAC)
    WH->>IN: EnqueueProviderWebhook (dedup event id)
    WH-->>LK: 200 OK (ngay)

    WK->>IN: ClaimPendingWebhookInbox
    WK->>MS: processWebhookRow → HandleProviderEvent

    MS->>DB: InsertProviderEvent (dedup provider_event_id)
    alt duplicate
        MS-->>WK: skip
    end

    alt room_started
        MS->>DB: conference_session → ACTIVE
    else room_finished
        MS->>DB: conference_session → IDLE
        MS->>DB: CloseOpenAttendanceForConference
    else participant_joined
        MS->>DB: OpenAttendanceSession ON CONFLICT (idempotent)
    else participant_left / connection_aborted
        MS->>DB: CloseAttendanceSession
    end

    Note over MS,DB: meetings.status KHÔNG thay đổi<br/>ReconcileStaleAttendance sweeper 5m
```





### Map sự kiện LiveKit → neutral


| LiveKit event                    | ProviderNeutralEvent                        | Hành động DB                                  |
| -------------------------------- | ------------------------------------------- | --------------------------------------------- |
| `room_started`                   | `conference.room_started`                   | Session → ACTIVE                              |
| `room_finished`                  | `conference.room_finished`                  | Session → IDLE                                |
| `participant_joined`             | `conference.participant_joined`             | Open attendance                               |
| `participant_left`               | `conference.participant_left`               | Close attendance                              |
| `participant_connection_aborted` | `conference.participant_connection_aborted` | Close attendance (reason: connection_aborted) |


**File liên quan:**

- Handler: `server/internal/handler/meeting_token.go` — `livekitWebhook()`
- Worker: `server/internal/service/meeting_webhook.go` — `EnqueueProviderWebhook`, `ProcessWebhookInbox`, `ReconcileStaleAttendance`, `ReconcileProviderDesync`
- Service: `server/internal/service/meeting_queries.go` — `HandleProviderEvent()`

---



## 13. Outbox Worker (retry provider ops)

```mermaid
flowchart LR
    subgraph Triggers["Sau commit TX"]
        T1["Start / Instant → provider.ensure_session"]
        T2["RemoveParticipant → provider.remove_participant"]
        T3["End / Cancel → provider.end_session"]
    end

    subgraph Outbox["outbox_events"]
        PENDING["PENDING / PROCESSING<br/>lease locked_until"]
        DONE["DONE"]
        DL["DEAD_LETTER"]
    end

    subgraph Worker["RunWorkers (main.go)<br/>tick 1s, batch 50<br/>webhook parallel ×8"]
        CLAIM["ClaimPendingOutbox SKIP LOCKED"]
        APPLY["applyOutbox → LiveKit ngoài TX"]
        WH["ProcessWebhookInbox<br/>(bounded concurrency)"]
    end

    Triggers --> PENDING
    CLAIM --> APPLY
    APPLY -->|success| DONE
    APPLY -->|retry| PENDING
    APPLY -->|max attempts| DL
```

Worker khởi chạy trong `server/cmd/server/main.go`:

```go
go meetingSvc.RunWorkers(runCtx)
```

Env tunable (mặc định): `MEETING_WORKER_TICK=1s`, `MEETING_OUTBOX_BATCH=50`, `MEETING_WEBHOOK_BATCH=50`, `MEETING_WEBHOOK_CONCURRENCY=8`.

`ensureProviderSession()` vẫn được gọi **ngay sau commit** ở Start/Instant (best-effort sync); **không** gọi trên `POST /join` (P4). Outbox là nguồn retry, cập nhật `provider_sync_status`, và publish `conference.session_ready` khi SYNCED.

**P5 — desync auto-heal:** `ReconcileProviderDesync` (5m) enqueue `provider.ensure_session` khi meeting `IN_PROGRESS` nhưng room LiveKit IDLE.

**Migration 034:** index `(status, next_attempt_at) WHERE status = 'PENDING'` trên `webhook_inbox` — claim pending nhanh hơn.

---



## 14. Realtime WebSocket (Control Plane → Frontend)

```mermaid
flowchart LR
    MS["MeetingService<br/>pub.Publish after commit"] --> RD["Redis Streams<br/>workspace scope + meeting scope"]
    RD --> HUB["realtime Hub"]
    HUB --> WS1["Browser WS<br/>/api/v1/ws<br/>(workspace members)"]
    HUB --> WS2["Browser WS<br/>GET .../lobby-ws<br/>(guest / public invite)"]
    WS1 --> SYNC["use-realtime-sync.ts<br/>debounce 250ms + version skip"]
    WS2 --> LOBBY["MeetingLobbyWSProvider<br/>→ useLobbyJoinRetry"]
    SYNC --> RQ["TanStack Query refetch FROM API"]
    LOBBY --> RQ

    subgraph Events["Meeting WS events (lobby-safe)"]
        E1["meeting.* (+ version)"]
        E2["participant.* / invitation.* (+ version)"]
        E3["join_request.* (+ version)"]
        E4["host.transferred / invite_link.revoked"]
        E5["conference.session_ready"]
    end

    MS --> Events
```

**Dual publish:** lobby events (`meeting.started`, `join_request.approved`, `conference.session_ready`, …) được publish cả workspace scope lẫn meeting scope (`ScopeMeeting`) để guest route không cần workspace WS.

**Quy tắc:** payload WS mang `meeting_id` + `version`; cache không ghi trực tiếp từ frame — luôn refetch API. Lobby dùng WS events để trigger join (jitter 0–3s), không poll 4s. Guest lobby WS: `GET /api/v1/meetings/{meetingID}/lobby-ws` — rate limit 30 connect/min/IP.

**File liên quan:** `packages/core/realtime/use-realtime-sync.ts`, `invalidate-scheduler.ts`, `meeting-lobby-provider.tsx`, `packages/views/meetings/use-lobby-join-retry.ts`, `server/internal/realtime/meeting_lobby_ws.go`

---



## 15. Stack Frontend phòng họp

```mermaid
flowchart TB
    PAGE_WS["apps/web<br/>/{org}/{ws}/meetings/{id}/room"]
    PAGE_INV["apps/web<br/>/invite/meeting/{linkId}/room"]
    RV["MeetingRoomView"]
    LOBBY["MeetingLobby<br/>WAITING_* / DENY / PROVIDER"]
    RETRY["useLobbyJoinRetry<br/>workspace WS hoặc lobby-ws<br/>+ jitter 0–3s + backoff"]
    LKR["LiveKitRoom<br/>adaptiveStream, dynacast"]
    CONF["MeetingConference<br/>onlySubscribed tiles"]
    CORE["useJoinMeeting → POST /join"]

    PAGE_WS --> RV
    PAGE_INV --> RV
    RV --> CORE
    RV --> RETRY
    RV -->|not ADMIT| LOBBY
    RV -->|ADMIT| LKR
    LKR --> CONF
```





### Hành vi FE quan trọng


| Hành vi | Chi tiết |
| --- | --- |
| Join on mount | Gọi `POST /join` một lần khi vào phòng (read-only provider check) |
| Lobby retry | WS `meeting.started` / `conference.session_ready` / `join_request.approved` → retry join với jitter 0–3s; fallback backoff 10s→60s |
| Guest lobby WS | Route public `/invite/.../room` bọc `MeetingLobbyWSProvider` → `GET .../lobby-ws` |
| Token refresh | **Không** timer proactive; re-join chỉ khi LiveKit disconnect bất thường |
| LiveKit opts | `adaptiveStream`, `dynacast`, `onlySubscribed: true` |
| Disconnect | Rời trang khi `PARTICIPANT_REMOVED`, `ROOM_DELETED`, `ROOM_CLOSED` |
| Public guest | `/invite/meeting/{linkId}` → resolve + guest cookie → join → `/room` |
| Host panel | Start/end/cancel, invite, RSVP, join requests, remove, transfer, invite links |


---



## 16. Bảng tóm tắt API theo vai trò


| Vai trò | Hành động    | Endpoint                                    | LiveKit liên quan                      |
| ------- | ------------ | ------------------------------------------- | -------------------------------------- |
| Host    | Start        | `POST /meetings/{id}/start`                 | EnsureSession + outbox                 |
| Host    | End          | `POST /meetings/{id}/end`                   | DeleteRoom + outbox                    |
| Host    | Cancel       | `DELETE /meetings/{id}` (SCHEDULED)         | end_session nếu có session             |
| Host    | Remove       | `DELETE /meetings/{id}/participants/{id}`   | RemoveParticipant + outbox             |
| Host    | Approve join | `POST /meeting-join-requests/{id}/approve`  | User tự join sau                       |
| Member  | Join         | `POST /meetings/{id}/join`                  | IssueJoinCredential khi ADMIT (120/min/IP) |
| Public  | Resolve link | `POST /public/meeting-invite-links/resolve` | Mint `uw_guest` (60/min/IP) |
| Public  | Join         | `POST /meetings/{id}/join`                | IssueJoinCredential khi ADMIT (120/min/IP) |
| Public  | Join request | `POST /meetings/{id}/join-requests`       | Guest/member (60/min/IP) |
| Public  | Cancel request | `POST /meeting-join-requests/{id}/cancel` | Requester |
| Public  | Lobby WS     | `GET /meetings/{id}/lobby-ws`               | Guest listen-only; 30 connect/min/IP |
| Guest   | Room         | `/invite/meeting/{linkId}/room` (FE)      | LiveKitRoom + MeetingLobbyWSProvider |
| LiveKit | Webhook      | `POST /integrations/livekit/webhook`        | Enqueue inbox → worker |
| Legacy  | Token        | `POST /meetings/{id}/token` (deprecated)    | Header `Deprecation`; dùng `/join` |


---



## 17. Chạy local LiveKit

```bash
# Terminal 1 — LiveKit (tách khỏi Postgres/Redis chính)
docker compose -f docker-compose.livekit.yml up
```

Thêm vào `.env`:

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret_must_be_at_least_32_chars
MEETING_PROVIDER=livekit
LIVEKIT_TOKEN_TTL=30m
# Worker tuning (optional — defaults: 1s tick, batch 50, webhook ×8)
# MEETING_WORKER_TICK=1s
# MEETING_OUTBOX_BATCH=50
# MEETING_WEBHOOK_BATCH=50
# MEETING_WEBHOOK_CONCURRENCY=8
# Để trống (0) = control plane owns lifecycle; LiveKit empty timeout 24h
# LIVEKIT_ROOM_EMPTY_TIMEOUT=0
```

Production mẫu: `livekit.production.yaml.example`.

Restart API:

```bash
make start
```

Cấu hình LiveKit dev: `livekit.dev.yaml`. Port: `7880` (WS), `7881`, UDP `50000-50020`.

---



## 18. Tham chiếu mã nguồn


| Thành phần                    | Đường dẫn                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------- |
| ConferenceProvider interface  | `server/internal/meetings/provider.go`                                       |
| LiveKit adapter               | `server/internal/meetings/livekit.go`                                        |
| Fake provider (tests)         | `server/internal/meetings/fake.go`                                           |
| MeetingService                | `server/internal/service/meeting.go`                                         |
| Lifecycle (start/end/instant) | `server/internal/service/meeting_lifecycle.go`                               |
| Admission / join              | `server/internal/service/meeting_admission.go`                               |
| Participants / RSVP / remove  | `server/internal/service/meeting_participants.go`                            |
| Invite links                  | `server/internal/service/meeting_links.go`                                   |
| Guest cookie                  | `server/internal/meetings/guest_cookie.go`                                   |
| Webhook inbox + workers       | `server/internal/service/meeting_webhook.go`                               |
| Reconcile / metrics           | `server/internal/service/meeting_reconcile.go`, `meeting_metrics.go`         |
| Meeting lobby WS              | `server/internal/service/meeting_lobby.go`, `realtime/meeting_lobby_ws.go` |
| Meeting metrics (Prometheus)  | `server/internal/metrics/meetings.go`, `meeting_lag.go`                      |
| Webhook + outbox + stats      | `server/internal/service/meeting_queries.go`                                 |
| WS event payloads + version   | `server/internal/service/meeting_events.go`                                  |
| HTTP routes                   | `server/internal/handler/router/meetings.go`                                 |
| Webhook handler               | `server/internal/handler/meeting_token.go`                                   |
| Worker bootstrap              | `server/cmd/server/main.go` (`RunWorkers`)                                   |
| Migrations D08a + scale       | `008_*` … `029_*`, `030_outbox_events_lease`, `031–033_webhook/attendance`, `034_webhook_inbox_pending_idx` |
| FE public invite              | `packages/views/meetings/public-invite-view.tsx`                             |
| FE guest room route           | `apps/web/app/invite/meeting/[linkId]/room/page.tsx`                           |
| FE room view                  | `packages/views/meetings/room-view.tsx`                                      |
| FE lobby retry                | `packages/views/meetings/use-lobby-join-retry.ts`                            |
| FE lobby                      | `packages/views/meetings/meeting-lobby.tsx`                                  |
| FE conference UI              | `packages/views/meetings/meeting-conference.tsx`                             |
| FE hooks / API                | `packages/core/meetings/hooks.ts`, `packages/core/api/endpoints/meetings.ts` |
| Realtime sync                 | `packages/core/realtime/use-realtime-sync.ts`, `invalidate-scheduler.ts`     |
| Guest lobby WS (FE)           | `packages/core/realtime/meeting-lobby-provider.tsx`                          |
| Load test (k6)                | `scripts/load/`                                                              |
| Kế hoạch triển khai           | `docs/meeting-livekit-implementation-plan.md`                                |
| Kế hoạch scale P4–P6          | `docs/meeting-scale-upgrade-plan.md`                                         |
| Báo cáo nghiệm thu D08a       | `docs/meeting-d08a-delivery.md`                                              |

---

## 19. Production scale — observability & partition

### Prometheus metrics (control plane)

| Metric | Type | Ý nghĩa |
| --- | --- | --- |
| `uniwork_meeting_join_decisions_total{decision}` | counter | ADMIT / WAITING_* / DENY |
| `uniwork_meeting_outbox_oldest_pending_seconds` | gauge | Tuổi job outbox cũ nhất (alert > 30s) |
| `uniwork_meeting_webhook_inbox_oldest_pending_seconds` | gauge | Tuổi webhook inbox cũ nhất |
| `uniwork_meeting_provider_desync_total` | counter | Meeting IN_PROGRESS nhưng room LiveKit IDLE |

### Grafana alert gợi ý

- Outbox lag > 30s trong 5 phút → page on-call
- Webhook inbox lag > 60s → kiểm tra worker / DB lock
- `provider_desync` tăng → kiểm tra `LIVEKIT_ROOM_EMPTY_TIMEOUT` (nên để 0 = control plane owns lifecycle)

### Partition strategy (khi volume cao)

Chưa partition trong D08a. Khi `meeting_audit_logs` hoặc `meeting_attendance_sessions` vượt ~50M rows/workspace lớn:

1. **Range partition theo tháng** trên `joined_at` / `created_at` (attendance, audit).
2. Giữ hot path (meetings, participants, grants) không partition — workspace-scoped, index B-tree đủ.
3. Archive cold partitions sang object storage trước khi DROP partition cũ.
4. Chạy benchmark trước khi bật — `scripts/load/meeting-join.k6.js`.

### Load test

Xem `scripts/load/README.md` — k6 scenarios cho `/join` admission và lobby wait.

---

## ConferenceProvider interface (tóm tắt)

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

Token LiveKit: `RoomJoin`, `CanSubscribe` / `CanPublish` / `CanPublishData`, **không** `RoomAdmin`.