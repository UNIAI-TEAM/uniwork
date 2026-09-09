# UniWork — Chat Work Hub (kênh hạng nhất, thread, tin nhắn ↔ công việc)

> **Trạng thái:** in-progress — Đề xuất, chờ duyệt (chủ sở hữu sản phẩm + kiến trúc sư trưởng). Spec chung cho ba lát cắt đầu của C-13.

**Ngày:** 2026-09-09
**Issue:** UNI-506 · C-13 · Bounded context Chat & Collaboration · P1 — spec này phủ ba lát đầu: UNI-507 (kênh), UNI-508 (thread), UNI-509 (tin nhắn ↔ công việc)
**Parent:** UNI-416 · Giai đoạn C — Collaboration
**Phụ thuộc đã có:** chat native (migration 046–056, 143–151, 159), F-05 Tasks + Projects (`tasks.origin_type`/`origin_id`, `task_comments`, `projects`), F-07 Notifications, F-08 audit + outbox (`internal/audit`, catalogue ba nơi), F-11 feature flag theo org, F-02 entitlement.
**Spec liên quan:** `2026-09-07-tasks-work-management-parity-design.md` (Projects, TaskSurface, comment suite), `2026-09-08-projects-suite-design.md` (route `/projects`, flag `tasks_work_management_parity`), `2026-09-04-notifications-design.md` (kind mới), `2026-09-04-audit-domain-events-design.md` (catalogue, outbox consumer), `2026-08-27-workspace-permissions-design.md` (effective role), `2026-09-08-documents-design.md` (khuôn spec, `chat_message_links` sẽ nhận `document` ở đợt sau).
**Tham chiếu mã:** `server/internal/service/chat.go` (`sendMessage`, `authorizeWorkspaceRoom`, `listMessages`), `chat_rooms.go` (`createChatRoom`, `authorizeRoom`, `ListChatRooms`, `roomUnread`), `chat_room_permissions.go` (`ChatRoomMemberPermissions`, `canModerateChatRoom`), `server/internal/realtime/chat_authorizer.go`, `server/internal/handler/router/chat.go`, `server/internal/outbox/catalogue.go`, `server/internal/audit/actions.go:100-121`, `server/internal/service/task.go` (`Create`, `AddComment`), `server/internal/service/task_collaboration.go` (`AddCommentSuite`), `packages/core/chat/`, `packages/views/chat/`, `packages/core/realtime/use-chat-room-scopes.ts`.
**Tham chiếu sản phẩm:** ClickUp Chat (https://clickup.com/features/chat) — đối chiếu hành vi, không copy giao diện.

> **Ghi chú số migration:** số `1NN_` trong spec là **giữ chỗ** nối tiếp `159` trên `develop` ngày 2026-09-09; số thật cấp khi viết plan.

## 1. Mục tiêu

Chat UniWork hiện là messenger đầy đủ (DM, nhóm, reaction, poll, nhắc hẹn, ghi chú, tin nhắn thoại, gọi LiveKit, GIF, sticker, chặn người). Nó thiếu đúng một thứ: **quan hệ với công việc**. Hội thoại và công việc nằm ở hai nơi, nên quyết định trong chat không để lại dấu vết trong task, và task không có ngữ cảnh vì sao nó tồn tại.

Ba lát cắt này đóng khoảng cách đó. Tính chất đo được:

1. **Kênh là nơi làm việc, không phải phòng chat lẻ.** Một kênh có thể gắn với một Project; mở Project thấy kênh của nó, mở kênh thấy Project của nó. Kênh công khai trong workspace ai cũng tìm và tham gia được; kênh riêng chỉ người được mời.
2. **Thread giữ hội thoại thẳng hàng.** Trả lời một tin nhắn tạo thread có người theo dõi và số chưa đọc riêng; dòng chính không bị chèn bởi mười câu trả lời của một chủ đề phụ.
3. **Một tin nhắn thành một task trong một thao tác.** Task sinh ra giữ liên kết ngược tới tin nhắn gốc (`tasks.origin_type = 'chat_message'`), tin nhắn hiển thị thẻ task cập nhật theo thời gian thực.
4. **Task đã có gắn được vào hội thoại.** Dán hoặc chọn một task để nó nở ra thành thẻ trong kênh, không phải một chuỗi id trần.
5. **Thread và bình luận task là một cuộc trò chuyện.** Khi một thread được nối với task, trả lời trong thread thành bình luận task và ngược lại, mỗi chiều đúng một lần, không nhân đôi thông báo.
6. **Không phá thứ đang chạy.** DM, nhóm, gọi thoại, poll, sticker giữ nguyên hành vi và nguyên hợp đồng API; toàn bộ phần mới nằm sau flag `chat_work_hub` theo tổ chức, mặc định tắt.

**Ngoài phạm vi ba lát này** (đã có issue riêng ở C-13): đính kèm tệp và soạn thảo giàu (UNI-510), Posts (UNI-511), FollowUps (UNI-512), AI CatchUp / Ask UNI / agent trong kênh (UNI-513), tóm tắt cuộc gọi (UNI-514), tìm kiếm toàn cục và nháp (UNI-515), audit/k6/i18n gate cuối (UNI-516). Cũng ngoài phạm vi: khách ngoài tổ chức vào kênh, kênh liên tổ chức, Work Graph edges (C-11 — spec này chỉ để lại `chat_message_links` làm nguồn), mobile (C-08).

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|-----------|--------|
| 1 | **`channel` là `kind` thứ tư của `chat_rooms`**, không tạo bảng mới | Thành viên, quyền, tin nhắn, unread, scope realtime, LiveKit đã chạy trên bảng này; bảng thứ hai nghĩa là hai đường quyền và hai đường realtime |
| 2 | **UniWork không có "Space".** Cấp tương đương ClickUp Space là **workspace**; kênh gắn tùy chọn vào **một Project** (`chat_rooms.project_id`) | Thêm một tầng phân cấp thứ tư chỉ để giống tên gọi của ClickUp là nợ vĩnh viễn; workspace đã là ranh giới quyền và ranh giới điều hướng |
| 3 | **Phòng `workspace` hiện có trở thành kênh mặc định** (`kind = 'channel'`, `is_default = true`) bằng migration dữ liệu; endpoint `/chat/room` và `/chat/messages` giữ nguyên, chuyển tiếp sang kênh mặc định | Không có "phòng chung" nào khác biệt về hành vi; giữ hai loại chỉ để tránh một migration là để lại hai nhánh mã mãi mãi |
| 4 | **Hai mức hiển thị: `public` (mọi thành viên workspace thấy, đọc và tự tham gia) và `private` (chỉ người được mời)** | Đúng hai mức có hành vi khác nhau; mức thứ ba không có hành vi đi kèm là mức giả |
| 5 | **Đọc kênh public không cần dòng `chat_room_members`; gửi tin thì phải tham gia** | Khám phá kênh phải xem được trước khi vào, nhưng unread, thông báo và danh sách thành viên chỉ có nghĩa với người đã tham gia |
| 6 | **Thread là cột `thread_root_id` trên `chat_messages`, không phải bảng riêng** | Một thread là một tập tin nhắn cùng gốc; bảng riêng chỉ nhân đôi khóa và làm hỏng phân trang sẵn có |
| 7 | **`chat_thread_followers` giữ luôn `last_read_at`** — theo dõi và chưa đọc là một dòng | Hai bảng cho hai thuộc tính của cùng một quan hệ (người ↔ thread) là chi phí không đổi lấy gì |
| 8 | **Thread bật cho `channel` và `group`, không bật cho DM** | DM hai người không có vấn đề chèn dòng; bật ở đó chỉ thêm một chỗ để tin nhắn lạc (câu hỏi mở §12.1) |
| 9 | **Task tạo từ tin nhắn dùng `tasks.origin_type = 'chat_message'` + `origin_id`** (cột đã có) và **cũng** ghi một dòng `chat_message_links` | Cột origin trả lời "task này từ đâu ra"; bảng link trả lời "tin nhắn này dính tới cái gì" (nhiều-nhiều, gồm cả task đã có) — hai câu hỏi khác nhau, đọc một chiều mỗi bên |
| 10 | **`chat_message_links` là bảng chung có `target_type`** (`task` ở lát này; `document`, `meeting` mở sau) | Cấu trúc giống nhau, hành vi khác nhau ở lớp service; ba bảng gần giống nhau là ba lần sửa cho mỗi thay đổi |
| 11 | **Đồng bộ thread ↔ bình luận task chạy qua outbox consumer `chat_task_sync`, không chạy trong transaction gửi tin** | Gửi tin phải nhanh và không được hỏng vì phía task lỗi; outbox đã có retry, DLQ và runbook |
| 12 | **Chống vòng lặp bằng nguồn gốc, không bằng cờ thời gian:** bản sao ở phía task mang `task_comments.chat_message_id`, bản sao ở phía chat mang `chat_messages.mirrored_from_comment_id`; consumer bỏ qua mọi bản ghi đã có nguồn ở phía kia | So thời gian hoặc đếm vòng là cách hỏng lúc 3 giờ sáng; nguồn gốc là dữ liệu, kiểm được bằng test |
| 13 | **Bản sao không sinh thông báo thứ hai:** notification consumer bỏ qua sự kiện mang `mirrored` | Một câu trả lời không được nổ hai lần trong inbox của cùng một người |
| 14 | **Thread reply là sự kiện phù du (`chat` scope) như mọi tin nhắn; chỉ thread ĐÃ nối task mới phát thêm một sự kiện outbox** | Giữ khối lượng outbox tỉ lệ với số thread có liên kết, không tỉ lệ với lưu lượng chat |
| 15 | **Feature flag `chat_work_hub` theo tổ chức, mặc định tắt, `Public: true`** | Đúng luật rollout (FEATURE_WORKFLOW bước 4 và 7); FE ẩn toàn bộ UI kênh/thread/liên kết khi tắt |
| 16 | **Không đụng DM, nhóm, gọi thoại, poll, nhắc hẹn, ghi chú, sticker** | Chúng đang chạy và người dùng nội bộ đang dùng; phạm vi ba lát này là lớp công việc |

## 3. Dữ liệu

Không FK, index `CONCURRENTLY` một câu lệnh một file (ADR 0001); id ULID `TEXT` (ADR 0002); bảng mới có `organization_id` (ADR 0008) và cặp `_kind` cho `created_by` (ADR 0007).

### 3.1 `160_chat_rooms_channel` — mở rộng `chat_rooms`

```sql
ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_kind_check;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_kind_check
  CHECK (kind IN ('workspace', 'group', 'dm', 'channel'));
ALTER TABLE chat_rooms
  ADD COLUMN visibility      TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN project_id      TEXT,                 -- NULL = kênh không gắn Project
  ADD COLUMN topic           TEXT NOT NULL DEFAULT '',   -- ≤ 280 ký tự, mô tả một dòng
  ADD COLUMN is_default      BOOLEAN NOT NULL DEFAULT false, -- kênh chung của workspace
  ADD COLUMN created_by_kind TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN archived_at     TIMESTAMPTZ,
  ADD COLUMN archived_by     TEXT;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_visibility_check
  CHECK (visibility IN ('public', 'private'));
```

`member_set_key` chỉ dùng cho `dm`/`group` (khóa duy nhất theo tập thành viên); kênh luôn `NULL` — kênh cùng tên khác nhau là hợp lệ, `member_set_key` không tham gia.

### 3.2 `161_chat_rooms_workspace_visibility_idx`

```sql
CREATE INDEX CONCURRENTLY idx_chat_rooms_ws_kind_visibility
  ON chat_rooms (workspace_id, kind, visibility) WHERE archived_at IS NULL;
```

### 3.3 `162_chat_rooms_project_idx`

```sql
CREATE INDEX CONCURRENTLY idx_chat_rooms_project ON chat_rooms (project_id)
  WHERE project_id IS NOT NULL;
```

### 3.4 `163_chat_rooms_default_uidx`

```sql
CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_rooms_default_per_workspace
  ON chat_rooms (workspace_id) WHERE is_default;
```

### 3.5 `164_chat_rooms_workspace_to_channel` — migration dữ liệu

```sql
UPDATE chat_rooms
   SET kind = 'channel', visibility = 'public', is_default = true,
       name = CASE WHEN name = '' THEN 'chung' ELSE name END
 WHERE kind = 'workspace';
```

`down` đảo lại theo `is_default`. Sau migration này không còn hàng `kind = 'workspace'`; `chatRoomKindWorkspace` bị xóa khỏi `chat.go` cùng đợt.

### 3.6 `165_chat_messages_thread` — mở rộng `chat_messages`

```sql
ALTER TABLE chat_messages
  ADD COLUMN thread_root_id TEXT,          -- NULL = tin nhắn ở dòng chính
  ADD COLUMN reply_count    INTEGER NOT NULL DEFAULT 0,   -- chỉ có nghĩa trên tin gốc
  ADD COLUMN last_reply_at  TIMESTAMPTZ;                  -- chỉ có nghĩa trên tin gốc
```

Bất biến do service giữ (test): `thread_root_id` trỏ tới một tin nhắn cùng `room_id` và bản thân nó có `thread_root_id IS NULL` — thread một cấp, không có thread trong thread. `reply_count`/`last_reply_at` cập nhật trong cùng transaction với việc chèn câu trả lời.

### 3.7 `166_chat_messages_thread_idx`

```sql
CREATE INDEX CONCURRENTLY idx_chat_messages_thread
  ON chat_messages (thread_root_id, created_at) WHERE thread_root_id IS NOT NULL;
```

Truy vấn dòng chính đổi thành `WHERE room_id = $1 AND thread_root_id IS NULL`; index `idx_chat_messages_room` hiện có vẫn phục vụ nó.

### 3.8 `167_chat_thread_followers`

```sql
CREATE TABLE chat_thread_followers (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  thread_root_id  TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  reason          TEXT NOT NULL,          -- 'author' | 'replied' | 'mentioned' | 'manual'
  muted           BOOLEAN NOT NULL DEFAULT false,
  last_read_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_thread_followers_reason_check
    CHECK (reason IN ('author', 'replied', 'mentioned', 'manual'))
);
```

Tự theo dõi khi: gửi tin gốc (`author`), trả lời trong thread (`replied`), bị nhắc tên trong thread (`mentioned`). Bỏ theo dõi ghi `muted = true` chứ không xóa dòng, để không tự theo dõi lại ở câu trả lời kế tiếp.

### 3.9 `168_chat_thread_followers_uidx`

```sql
CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_thread_followers
  ON chat_thread_followers (thread_root_id, user_id);
```

### 3.10 `169_chat_message_links`

```sql
CREATE TABLE chat_message_links (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  target_type     TEXT NOT NULL,          -- 'task' (lát này); 'document' | 'meeting' mở sau
  target_id       TEXT NOT NULL,
  relation        TEXT NOT NULL,          -- 'created_from' (task sinh từ tin) | 'mentions' (gắn task đã có)
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_message_links_target_check CHECK (target_type IN ('task')),
  CONSTRAINT chat_message_links_relation_check CHECK (relation IN ('created_from', 'mentions'))
);
```

Mở `target_type` cho `document`/`meeting` là một migration đổi CHECK, không phải bảng mới.

### 3.11 `170_chat_message_links_message_idx` và `171_chat_message_links_target_idx` (hai file, mỗi file một câu lệnh)

```sql
CREATE INDEX CONCURRENTLY idx_chat_message_links_message ON chat_message_links (message_id);
CREATE INDEX CONCURRENTLY idx_chat_message_links_target  ON chat_message_links (target_type, target_id);
```

### 3.12 `172_chat_message_links_uidx`

```sql
CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_message_links_pair
  ON chat_message_links (message_id, target_type, target_id);
```

Gắn lại cùng một task vào cùng một tin nhắn là no-op 200, không phải lỗi.

### 3.13 `173_chat_thread_task_links` — thread nối task (đồng bộ hai chiều)

```sql
CREATE TABLE chat_thread_task_links (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  thread_root_id  TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  direction       TEXT NOT NULL DEFAULT 'both',  -- 'both' | 'chat_to_task'
  created_by      TEXT NOT NULL,
  created_by_kind TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_thread_task_links_direction_check CHECK (direction IN ('both', 'chat_to_task'))
);
```

### 3.14 `174_chat_thread_task_links_uidx` và `175_chat_thread_task_links_task_idx` (hai file, mỗi file một câu lệnh)

```sql
CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_thread_task_links_thread
  ON chat_thread_task_links (thread_root_id);          -- một thread nối tối đa một task
CREATE INDEX CONCURRENTLY idx_chat_thread_task_links_task
  ON chat_thread_task_links (task_id);
```

### 3.15 `176_task_comments_chat_message_id` và `177_task_comments_chat_message_uidx`

```sql
ALTER TABLE task_comments ADD COLUMN chat_message_id TEXT;   -- bản sao của một tin nhắn thread
CREATE UNIQUE INDEX CONCURRENTLY uidx_task_comments_chat_message
  ON task_comments (chat_message_id) WHERE chat_message_id IS NOT NULL;
```

### 3.16 `178_chat_messages_mirrored_from` và `179_chat_messages_mirrored_from_uidx`

```sql
ALTER TABLE chat_messages ADD COLUMN mirrored_from_comment_id TEXT;  -- bản sao của một bình luận task
CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_messages_mirrored_from
  ON chat_messages (mirrored_from_comment_id) WHERE mirrored_from_comment_id IS NOT NULL;
```

Hai cột này là toàn bộ cơ chế chống vòng lặp và chống ghi hai lần: mỗi bản sao mang id của bản gốc ở phía kia, và unique index biến "consumer chạy lại" thành no-op ở tầng DB thay vì ở tầng mã. Không đọc JSONB `metadata` cho việc này — nó không có index và không kiểm được bằng ràng buộc.

## 4. Quyền

Nền: `WorkspaceService.RequireMember` là cổng duy nhất quyết định thành viên workspace (org owner/admin là admin workspace ngầm). Quyền trong phòng đọc từ `chat_room_members.role` + `chat_rooms.member_permissions` như hiện tại.

| Hành động | Ai làm được |
|---|---|
| Thấy kênh `public` trong danh sách khám phá | mọi effective member của workspace |
| Đọc tin nhắn kênh `public` | mọi effective member; không cần dòng thành viên |
| Tham gia kênh `public` | mọi effective member (tự tham gia, tạo dòng `active`) |
| Thấy / đọc kênh `private` | chỉ thành viên phòng đang `active` |
| Tạo kênh (public hoặc private) | mọi effective member |
| Gửi tin trong kênh | thành viên `active` và `member_permissions.allow_send_messages` (hoặc admin phòng) |
| Mời vào kênh `private` | admin phòng, người tạo phòng, hoặc ws owner/admin |
| Đổi tên / topic / Project gắn kèm | admin phòng hoặc `allow_change_profile` |
| Đổi `visibility` | admin phòng hoặc ws owner/admin — **không** có ở kênh mặc định |
| Lưu trữ kênh | admin phòng hoặc ws owner/admin; kênh mặc định không lưu trữ được |
| Trả lời trong thread | như gửi tin trong phòng |
| Theo dõi / bỏ theo dõi thread | ai đọc được thread |
| Tạo task từ tin nhắn | đọc được tin nhắn **và** tạo được task trong workspace đích |
| Gắn task đã có vào tin nhắn | đọc được tin nhắn **và** đọc được task |
| Nối thread với task | như trên, thêm quyền bình luận trên task |

Hai điểm phải có test cách ly: (1) người không thuộc workspace không đọc được kênh `public`; (2) người thuộc workspace nhưng không thuộc kênh `private` nhận 404, không phải 403 — id không được rò rỉ (CLAUDE.md § Backend ID Rules).

Riêng chặn người (`chat_blocks`) giữ nguyên ngữ nghĩa DM: nó không ảnh hưởng kênh.

## 5. API

Tất cả dưới `/api/v1`, `auth: true`, đăng ký trong `server/internal/handler/router/chat.go`, SDI/SDO trong `handler/dto/`. Ghi mới đi qua `chatWriteLimit` như các endpoint gửi tin hiện có.

### 5.1 Kênh (lát 1)

| Method | Path | SDI → SDO | Ghi chú |
|---|---|---|---|
| POST | `/workspaces/{workspaceID}/chat/channels` | `CreateChatChannelSDI{name, visibility, topic?, project_id?, member_user_ids?}` → `ChatRoomSDO` | tên 1–80 ký tự |
| GET | `/workspaces/{workspaceID}/chat/channels` | `?scope=mine\|discoverable&project_id=&q=` → `ChatChannelListSDO` | `discoverable` chỉ trả kênh `public` chưa tham gia |
| PATCH | `/workspaces/{workspaceID}/chat/channels/{roomID}` | `UpdateChatChannelSDI{name?, topic?, visibility?, project_id?}` → `ChatRoomSDO` | `project_id: null` = gỡ liên kết |
| POST | `/workspaces/{workspaceID}/chat/channels/{roomID}/join` | — → `ChatRoomSDO` | chỉ kênh `public` |
| POST | `/workspaces/{workspaceID}/chat/channels/{roomID}/archive` | — → `StatusSDO` | lưu trữ; khôi phục bằng `DELETE` trên cùng path |
| GET | `/workspaces/{workspaceID}/projects/{projectID}/chat/channels` | — → `ChatChannelListSDO` | kênh của một Project, cho màn Project |

Rời kênh dùng `POST /chat/rooms/{roomID}/leave` đã có. Thành viên kênh dùng bộ `/chat/rooms/{roomID}/members` đã có.

### 5.2 Thread (lát 2)

| Method | Path | SDI → SDO |
|---|---|---|
| GET | `/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages` | `?limit=&before=` → `ChatMessageListSDO` |
| POST | `/workspaces/{workspaceID}/chat/rooms/{roomID}/threads/{messageID}/messages` | `SendChatMessageSDI` (có `client_msg_id`) → `ChatMessageSDO` |
| POST | `/workspaces/{workspaceID}/chat/threads/{messageID}/follow` | — → `StatusSDO` |
| DELETE | `/workspaces/{workspaceID}/chat/threads/{messageID}/follow` | — → `StatusSDO` |
| POST | `/workspaces/{workspaceID}/chat/threads/{messageID}/read` | — → `StatusSDO` |
| GET | `/workspaces/{workspaceID}/chat/threads` | `?unread=1` → `ChatThreadListSDO` | thread tôi theo dõi, cho panel "Thread của tôi" |

`ChatMessageSDO` thêm `thread_root_id`, `reply_count`, `last_reply_at`, `thread_unread` — trường mới, tương thích ngược (schema client lenient theo CLAUDE.md § API Compatibility).

### 5.3 Tin nhắn ↔ công việc (lát 3)

| Method | Path | SDI → SDO |
|---|---|---|
| POST | `/workspaces/{workspaceID}/chat/messages/{messageID}/tasks` | `CreateTaskFromMessageSDI{title?, project_id?, assignee_id?, assignee_kind?, due_date?, sync_thread?}` → `TaskSDO` |
| POST | `/workspaces/{workspaceID}/chat/messages/{messageID}/links` | `CreateChatMessageLinkSDI{target_type, target_id}` → `ChatMessageLinkSDO` |
| DELETE | `/workspaces/{workspaceID}/chat/messages/{messageID}/links/{linkID}` | — → `StatusSDO` |
| GET | `/workspaces/{workspaceID}/chat/messages/{messageID}/links` | — → `ChatMessageLinkListSDO` |
| POST | `/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync` | `SyncThreadTaskSDI{task_id, direction}` → `StatusSDO` |
| DELETE | `/workspaces/{workspaceID}/chat/threads/{messageID}/task-sync` | — → `StatusSDO` |

`title` bỏ trống thì lấy 120 ký tự đầu của thân tin nhắn, cắt theo ranh giới từ; thân đầy đủ vào `description` kèm dòng "Từ chat #<kênh> lúc <thời điểm>".

### 5.4 Mã lỗi ổn định

| Mã | HTTP | Khi nào |
|---|---|---|
| `chat_channel_name_invalid` | 422 | tên rỗng hoặc > 80 ký tự |
| `chat_channel_private` | 404 | tham gia/đọc kênh `private` khi không phải thành viên |
| `chat_channel_default_immutable` | 422 | đổi visibility hoặc lưu trữ kênh mặc định |
| `chat_not_member` | 403 | gửi tin khi chưa tham gia kênh public |
| `chat_send_not_allowed` | 403 | `allow_send_messages = false` (đã có) |
| `chat_thread_invalid_root` | 422 | trả lời vào một tin nhắn vốn đã là câu trả lời |
| `chat_thread_not_found` | 404 | tin gốc không tồn tại hoặc ngoài quyền |
| `chat_link_target_not_found` | 404 | task không tồn tại hoặc ngoài quyền người gọi |
| `chat_thread_already_synced` | 409 | thread đã nối một task khác |
| `project_not_found` | 404 | `project_id` ngoài workspace |

## 6. Sự kiện, realtime, worker

### 6.1 Catalogue (thêm ở ba nơi: `docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`)

| Topic | v | Payload | Scope | Delivery |
|---|---|---|---|---|
| `chat.channel.created` | 1 | `room_id`, `workspace_id` | workspace | outbox |
| `chat.channel.updated` | 1 | `room_id`, `workspace_id` | workspace | ephemeral |
| `chat.channel.archived` | 1 | `room_id`, `workspace_id` | workspace | outbox |
| `chat.thread.replied` | 1 | `room_id`, `thread_root_id`, `message_id` | chat | ephemeral |
| `chat.thread.linked` | 1 | `room_id`, `thread_root_id`, `task_id` | room | outbox |
| `chat.message.linked` | 1 | `room_id`, `message_id`, `target_type`, `target_id` | room | outbox |
| `chat.thread.reply_linked` | 1 | `thread_root_id`, `message_id`, `task_id` | `-` | outbox |

Ba dòng cần giải thích:

- `chat.channel.created` là outbox (durable) vì nó sinh thông báo và là dấu vết quản trị; `chat.channel.updated` phù du vì mất một lần đổi topic không tốn của ai cái gì (CLAUDE.md § Audit and Events).
- `chat.thread.replied` phù du như mọi tin nhắn: UI cập nhật, mất thì lần đọc kế tiếp bù.
- `chat.thread.reply_linked` chỉ phát khi thread có dòng `chat_thread_task_links`; đó là đầu vào của consumer đồng bộ. Scope `-` vì đây là sự kiện hạ tầng không có người nhận trên WS (`events-catalogue.test.mjs` cho phép scope `-` với sự kiện infra; phải là gạch nối ASCII).

Chiều ngược lại dùng `task.comment_added` đã có trong catalogue.

### 6.2 Consumer `chat_task_sync` (`server/internal/service/chat_task_sync.go`)

Topics: `chat.thread.reply_linked`, `task.comment_added`.

- **chat → task**: đọc tin nhắn; nếu `mirrored_from_comment_id` có giá trị thì bỏ qua (bản sao). Ngược lại `AddCommentSuite` với actor là người gửi, `origin = 'chat'`, `chat_message_id = <message_id>`; unique index chặn ghi hai lần khi consumer chạy lại.
- **task → chat**: đọc bình luận; nếu `chat_message_id` có giá trị thì bỏ qua. Ngược lại chèn một tin nhắn vào thread với `sender_id` là tác giả bình luận và `mirrored_from_comment_id = <comment_id>`; unique index §3.16 chặn bản thứ hai khi consumer chạy lại.
- Chỉ đồng bộ `direction = 'both'`; `chat_to_task` bỏ qua nhánh thứ hai.
- Consumer đăng ký trong chuỗi khởi động/`shutdown` của `main.go` như các consumer khác; lỗi phía task (task đã xóa) → gỡ dòng link và ghi một tin nhắn hệ thống trong thread, không retry vô hạn.

### 6.3 Notification (F-07)

Kind mới: `chat_thread_reply` — người theo dõi thread (`muted = false`), trừ tác giả câu trả lời. Bản sao (`mirrored`) không sinh thông báo, để một câu trả lời không nổ hai lần khi thread đã nối task. `chat_channel_invite` dùng lại `member_added` hiện có.

### 6.4 Audit

Dùng lại `ActionChatRoomCreated`, `ActionChatRoomMemberAdded`, `ActionChatRoomMemberRemoved`. Thêm vào `server/internal/audit/actions.go`:

```go
ActionChatChannelUpdated   = "chat.channel.updated"    // đổi visibility, project, tên, topic
ActionChatChannelArchived  = "chat.channel.archived"
ActionChatMessageLinked    = "chat.message.linked"
ActionChatThreadTaskLinked = "chat.thread.task_linked"
```

Mỗi action thêm một dòng trong `server/internal/service/audit_coverage_test.go` cùng đợt, nếu không test đỏ. Trả lời trong thread **không** audit — cùng lý do tin nhắn thường không audit (khối lượng; `chat_messages` đã là lịch sử).

### 6.5 Realtime

`ChatScopeAuthorizer` đổi: kênh `public` cho phép mọi effective member subscribe `chat:{roomId}`, kênh `private` giữ luật thành viên hiện tại. Thread không có scope riêng — nó đi trên `chat:{roomId}` của phòng, client lọc theo `thread_root_id`. Trần subscription đồng thời của client (`lazy-chat-scopes.ts`) giữ nguyên: mở panel thread không tốn thêm scope.

## 7. Frontend

### 7.1 File map

**`packages/core/`**

```
api/endpoints/chat-channels.ts       # list/create/update/join/archive + schema + malformed test
api/endpoints/chat-threads.ts        # thread messages, follow, read
api/endpoints/chat-links.ts          # message links, task từ tin nhắn, thread task-sync
chat/chat-keys.ts                    # + channels, discoverable, thread, threadList, links
chat/channels-store.ts               # danh sách kênh của tôi + kênh khám phá (đã lọc)
chat/channel-hooks.ts                # useChatChannels/useCreateChannel/useJoinChannel/…
chat/thread-store.ts                 # thread đang mở, chưa đọc theo thread
chat/thread-hooks.ts                 # useThreadMessages/useSendThreadReply/useFollowThread
chat/message-links.ts                # thuần: gộp link vào ChatMessage, suy tiêu đề task từ body
chat/realtime-cache.ts               # + nhánh chat.thread.replied, chat.message.linked
```

**`packages/views/chat/`**

```
create-channel-dialog.tsx            # tên, visibility, Project, thành viên đầu tiên
channel-directory-sheet.tsx          # khám phá + tham gia kênh public
channel-settings-sheet.tsx           # topic, Project, visibility, lưu trữ (dùng lại group-settings-sheet)
chat-sidebar-channels.tsx            # nhóm "Kênh" trong sidebar, gom theo Project
chat-thread-panel.tsx                # panel phải: tin gốc + câu trả lời + composer (lazy)
chat-thread-summary-row.tsx          # "12 trả lời · mới nhất 5 phút trước" dưới tin gốc
chat-thread-list-sheet.tsx           # thread tôi theo dõi
message-task-card.tsx                # thẻ task nở ra trong dòng tin nhắn
create-task-from-message-dialog.tsx  # tiêu đề, Project, người nhận, hạn, "đồng bộ thread"
link-task-dialog.tsx                 # chọn task đã có
```

**`apps/web/`** — không thêm route: `/{org}/{ws}/chat` nhận `?room=&thread=` để deep link; màn Project (`/projects/[projectId]`) thêm một thẻ "Kênh chat" khi flag bật.

Ràng buộc bundle: route chat giữ trần 150 KB gzip. Panel thread và ba dialog nạp động (`next/dynamic`), như bài học enum LiveKit kéo cả SDK vào route mời họp.

### 7.2 i18n

Khóa mới dưới `chat.channel.*`, `chat.thread.*`, `chat.link.*` trong `packages/core/i18n/locales/{vi,en}.json`, đủ cả hai ngôn ngữ trong cùng PR. Glossary (`docs/conventions.md` §2) thêm ba dòng: **kênh** = channel, **thread** = thread (giữ nguyên, không dịch "luồng" — người dùng nội bộ nói "thread"), **gắn** = link. "Workspace" giữ nguyên như hiện tại.

### 7.3 Hành vi

- Sidebar chat có bốn nhóm: **Kênh** (gom theo Project, kênh không gắn Project xếp cuối), **Tin nhắn**, **Nhóm**, và nút khám phá kênh.
- Tin nhắn có câu trả lời hiện một dòng tóm tắt thread; bấm mở panel phải, không rời dòng chính. Đóng panel bằng `Esc`.
- Chưa đọc: badge phòng đếm tin ở dòng chính; badge thread đếm riêng và hiện trên dòng tóm tắt.
- Tạo task từ tin nhắn: menu ngữ cảnh của tin nhắn → dialog điền sẵn tiêu đề → sau khi tạo, tin nhắn hiện thẻ task ngay (optimistic, khớp `merge-optimistic-chat-messages.ts` hiện có).
- Thẻ task cập nhật theo realtime `task.updated` trên scope workspace đã có.
- Empty state trung thực: kênh chưa có tin nói cách bắt đầu; danh sách khám phá rỗng nói "chưa có kênh công khai nào", không hiện kênh giả.
- Flag tắt: không nhóm "Kênh", không dòng thread, không menu tạo task — chat giữ nguyên hình dạng hôm nay.

## 8. Chỗ để dành cho AI và agent (lát 7, không làm ở đây)

Ba lát này chỉ để lại điểm nối, không gọi mô hình: `chat_message_links` là nơi AI ghi đề xuất liên kết; `chat_thread_task_links` là nơi CatchUp tóm tắt theo thread; task do AI đề xuất từ hội thoại đi qua `agent_action_proposals` (ADR 0010), không ghi thẳng — đúng luật F-10. Không thêm cột `ai_*` nào ở đợt này.

## 9. Kiểm thử bắt buộc

### 9.1 Go (Postgres thật, `-race`)

- `chat_channels_test.go`: tạo kênh public/private; kênh mặc định không đổi visibility và không lưu trữ được; tham gia kênh public tạo đúng một dòng thành viên; `discoverable` không trả kênh đã tham gia; gắn/gỡ Project.
- **Cách ly**: người ngoài workspace → 404 mọi endpoint kênh; thành viên workspace không thuộc kênh private → 404 (không phải 403); người bị vô hiệu hóa (`deactivated_at`) → 403 `member_deactivated` qua cả hai cổng.
- `chat_threads_test.go`: trả lời vào câu trả lời → 422; `reply_count`/`last_reply_at` đúng sau N câu trả lời song song (chạy `-race`); tự theo dõi theo ba lý do; `muted` không bị bật lại; chưa đọc theo thread.
- `chat_task_sync_test.go`: chat → task tạo đúng một bình luận; chạy lại consumer không tạo bản thứ hai; task → chat tạo đúng một tin nhắn; bản sao không sinh vòng lặp (chạy 10 vòng, đếm hàng); task bị xóa → gỡ link + tin nhắn hệ thống.
- `audit_coverage_test.go`: bốn action mới có dòng.
- Migration lint: mọi index `CONCURRENTLY` một câu lệnh; bảng mới có `organization_id` và `created_by_kind`.
- Arch test hiện có phải vẫn xanh: chỉ `internal/audit` ghi `audit_events`/`outbox_events`; chỉ `WorkspaceService.RequireMember` quyết định thành viên.

### 9.2 Frontend (vitest)

- `chat-channels.test.ts`, `chat-threads.test.ts`, `chat-links.test.ts`: malformed-response cho từng endpoint mới (bắt buộc theo § API Compatibility).
- `message-links.test.ts`: suy tiêu đề task từ thân tin nhắn (cắt theo từ, emoji, tin nhắn một dòng dài).
- `realtime-cache.test.ts`: sự kiện thread và link cập nhật đúng cache, không làm mất tin nhắn optimistic.
- `chat-thread-panel.test.tsx`, `create-task-from-message-dialog.test.tsx`: hành vi + a11y (focus trap, `Esc`).
- `scripts/events-catalogue.test.mjs` xanh với bảy topic mới.

### 9.3 E2E (Playwright)

- `e2e/chat-channels.spec.ts`: tạo kênh → thấy trong sidebar → người thứ hai khám phá và tham gia → gửi tin → người thứ nhất nhận realtime.
- `e2e/chat-threads.spec.ts`: trả lời thread → dòng chính không đổi → badge thread → đánh dấu đã đọc.
- `e2e/chat-task-link.spec.ts`: tạo task từ tin nhắn → thẻ task hiện → mở task thấy nguồn gốc → bình luận trên task → câu trả lời xuất hiện trong thread.
- Dùng `{ exact: true }` cho `getByLabel`, không `getByRole("alert")` (bài học đã ghi trong repo).

### 9.4 Hiệu năng

Kênh 5.000 tin nhắn: dòng chính trang đầu < 150 ms p95 ở DB dev; panel thread 200 câu trả lời < 150 ms. k6 realtime để ở lát 10 (UNI-516), không làm ở đây.

## 10. Kế thừa từ chat hiện tại và cái gì bỏ

**Giữ nguyên, không đụng:** DM, nhóm, reaction, ghim, sửa/xóa, tìm trong phòng, poll, nhắc hẹn, ghi chú, tin nhắn thoại, gọi thoại/video LiveKit, GIF/sticker, biệt danh, chặn người, typing, outbox gửi lại khi mất mạng, `client_msg_id` chống trùng.

**Bỏ:** `kind = 'workspace'` như một loại phòng riêng (thành kênh mặc định, §3.5) và hằng `chatRoomKindWorkspace` cùng nhánh mã đi kèm trong `chat.go`/`chat_rooms.go`. Endpoint `/chat/room` và `/chat/messages` **giữ nguyên hợp đồng** và chuyển tiếp sang kênh mặc định; đánh dấu deprecated trong OpenAPI, gỡ ở lát 10 sau khi web và mobile đã đổi.

**Không port:** không có gì để port — bản cũ (unidigiwork) không có kênh gắn công việc; ClickUp là tham chiếu hành vi, không phải nguồn mã.

## 11. Phân rã delivery

Mỗi lát một plan trong `docs/superpowers/plans/`, mỗi task lớn của plan là một sub-issue dưới issue của lát đó (luật 5, `UNIAI_TRACKING.md`).

| Lát | Issue | Nội dung | Migration | Xong khi |
|---|---|---|---|---|
| 1 | UNI-507 | Kênh: schema §3.1–3.5, quyền §4, API §5.1, sự kiện kênh, sidebar + khám phá + settings, flag `chat_work_hub` | 160–164 | tạo/tham gia/khám phá kênh chạy thật; phòng workspace cũ đã thành kênh mặc định; e2e kênh xanh |
| 2 | UNI-508 | Thread: §3.6–3.9, API §5.2, sự kiện thread, panel thread, chưa đọc theo thread, notification `chat_thread_reply` | 165–168 | trả lời thread không chèn dòng chính; badge đúng; e2e thread xanh |
| 3 | UNI-509 | Tin nhắn ↔ công việc: §3.10–3.16, API §5.3, consumer `chat_task_sync`, thẻ task, dialog tạo task | 169–179 | tạo task từ tin nhắn và đồng bộ hai chiều chạy thật, không nhân đôi; e2e task-link xanh |

Thứ tự bắt buộc: 1 → 2 → 3. Lát 4 (UNI-510, đính kèm) chạy song song được với lát 2 vì không chạm cùng bảng.

## 12. Câu hỏi mở (chủ sở hữu sản phẩm quyết trước khi duyệt)

1. **Thread trong DM.** Spec đang tắt (§2 quyết định 8). Bật sau nếu người dùng nội bộ kêu, hay chốt tắt vĩnh viễn?
2. **"Gửi cả ra kênh" khi trả lời thread** (Slack có, ClickUp không nổi bật). Đang bỏ. Thêm sau hay không bao giờ?
3. **Kênh mặc định khi tạo Project**: tự tạo kênh cho mọi Project mới, hay để người tạo tick chọn? Spec đang giả định **tick chọn, mặc định không tạo** — kênh rỗng hàng loạt là rác.
4. **Chiều đồng bộ mặc định** khi nối thread với task: `both` (spec đang chọn) hay `chat_to_task` cho an toàn? `both` làm bình luận task hiện trong chat của những người không theo dõi task.
5. **Ai được tạo kênh public**: mọi thành viên (spec đang chọn) hay chỉ ws admin? Ảnh hưởng trực tiếp tới lộn xộn ở tổ chức 200 người.
6. **Deprecate `/chat/room` và `/chat/messages`**: gỡ ở lát 10 như spec, hay giữ tới khi mobile C-08 lên?
