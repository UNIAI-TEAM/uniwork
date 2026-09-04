# UniWork — Notifications (in-app, push, email digest)

**Ngày:** 2026-09-04
**Trạng thái:** Đã duyệt (2026-09-04, quangpd — UNI-421). Câu hỏi mở đã chốt trong `docs/roadmap/OPEN_QUESTIONS.md`; ADR 0007–0010 accepted.
**Spec liên quan:** `2026-09-04-audit-domain-events-design.md` (outbox `Dispatcher`,
`Consumer`, catalogue — **điều kiện tiên quyết**), `2026-08-28-transactional-email-design.md`
(bảng `emails`, `mail.<Kind>`, worker gửi), `2026-08-27-workspace-permissions-design.md`
(effective role), `2026-08-24-uniwork-platform-design.md` (§5 realtime)
**Tham chiếu:** `server/internal/realtime/hub.go` (`SendToUser`, user scope tự
subscribe), `server/internal/service/events.go`, `packages/core/realtime/use-realtime-sync.ts`,
`packages/views/layout/app-sidebar.tsx`, `packages/views/layout/workspace-top-bar.tsx`,
`packages/core/paths/paths.ts`. Bản cũ (đối chiếu hành vi, không copy):
`../unidigiwork/src/lib/api/notifications.functions.ts`, `notif-prefs.functions.ts`,
`webpush.server.ts`, `push-dispatch.server.ts`, `docs/product/UNIWORK_INFORMATION_ARCHITECTURE_V2.md`
(mục "Inbox /notifications, badge chưa đọc").


> **Ghi chú số migration:** số `0NN_` trong spec này là **giữ chỗ**; số thật được cấp khi viết plan, theo thứ tự triển khai trong `docs/roadmap/FEATURE_ROADMAP.md` (audit/outbox → entitlement → tasks → notifications → …) và theo migration mới nhất trên `develop` lúc đó. Các spec cùng ngày có dải số trùng nhau là cố ý.

## 1. Mục tiêu

Người dùng biết **việc gì cần mình** mà không phải mở từng màn hình: được giao
task, được nhắc trong bình luận, được mời họp, họp sắp bắt đầu, được thêm vào
workspace. Vision §5.2 xếp Notification vào Foundation vì mọi bounded context khác
phát sự kiện vào đây, và vì "agent là đồng nghiệp" (V6) chỉ có nghĩa khi hành động
của agent đến được hộp thư của người.

Tính chất đo được:

1. **Không phát từ handler.** Notification sinh ra từ **outbox consumer**, đọc sự
   kiện domain đã commit. Handler và service nghiệp vụ không biết Notification tồn
   tại. Thêm loại notification mới không sửa Tasks/Meetings.
2. **Ba kênh, một nguồn.** In-app là bản ghi gốc; web push và email digest là
   cách **giao** cùng bản ghi đó, bật/tắt theo người dùng và theo loại.
3. **Badge đúng ngay.** Số chưa đọc trên sidebar cập nhật ≤ 1 s sau sự kiện qua
   user scope của relay hiện có; frame chỉ mang id, client refetch.
4. **Không spam.** Nhiều sự kiện cùng entity trong cửa sổ ngắn gộp thành một dòng;
   người tự gây ra sự kiện không nhận notification của chính mình; digest email tối
   đa 1 mail/ngày/người.
5. **Empty state trung thực.** Không có gì thì nói "Chưa có thông báo" và chỉ cách
   được thông báo (Vision §6.7).

**Ngoài phạm vi đợt này:** mobile push (APNs/FCM — chỉ có web push VAPID), thông
báo qua Zalo/Slack, notification cho guest meeting (không có account), "snooze",
nhắc việc theo due date (cần scheduler, chờ Tasks follow-up spec), notification do
agent tạo (cột `actor_kind` chừa sẵn).

## 2. Quyết định đã chốt

| # | Quyết định | Vì sao |
|---|-----------|--------|
| 1 | Notification là **bản ghi per-user** (`notifications`), không per-workspace rồi filter | Đã đọc/lưu trữ là trạng thái cá nhân; query "của tôi" là 1 index |
| 2 | Nguồn duy nhất là `NotificationConsumer` của outbox | Không mất sự kiện; không dual-write; xem audit spec §4.4 |
| 3 | **Gộp theo `(user_id, group_key)`** trong cửa sổ 10 phút: cùng entity, cùng loại → cập nhật dòng cũ (`count`, `updated_at`, `read_at = NULL`) thay vì tạo dòng mới | Chống spam khi ai đó sửa task 5 lần |
| 4 | Web push dùng **VAPID chuẩn**, thư viện Go `SherClockHolmes/webpush-go` (một dependency, có lý do: RFC 8291 mã hóa aes128gcm không nên tự viết) | Bản cũ tự viết bằng Web Crypto; không lặp lại |
| 5 | Email digest **tái dùng `emails` outbox** với kind `notification_digest`; không gửi email từng notification | Đã có worker/retry/lịch sử; mail từng cái là spam |
| 6 | Preferences mặc định: in-app bật tất cả; push bật `mention`, `assigned`, `meeting_starting`; email digest bật, giờ gửi 08:00 theo `users.timezone` (thêm cột nếu chưa có) | Ít nhiễu nhất mà vẫn không bỏ lỡ |
| 7 | Không có "notification center" cấp org cho admin gửi thông báo tay đợt này | Không có use case đã xác nhận; bản cũ có `createNotification` public là lỗ hổng (đã phải vá) |
| 8 | Route `/{org}/{ws}/inbox` (không phải `/notifications`) | IA V2 gọi là Inbox; slug `inbox` thêm vào reserved |

## 3. Dữ liệu

Số migration nối tiếp audit spec (`065`+), lấy số thật lúc implement.

### 3.1 `065_notifications`

```sql
-- Bản ghi gốc, per-user. Không FK: notification sống sót khi task/meeting bị xóa
-- (hiển thị "đã xóa"), và lịch sử phải giữ cho digest đã gửi.
CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,                 -- ULID
  user_id         TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  workspace_id    TEXT,                             -- NULL cho sự kiện cấp org
  kind            TEXT NOT NULL,                    -- xem §4.1
  group_key       TEXT NOT NULL,                    -- "task:01H...:updated"
  resource_type   TEXT NOT NULL,                    -- 'task' | 'meeting' | 'workspace' | 'organization' | 'chat_room'
  resource_id     TEXT NOT NULL,
  actor_kind      TEXT NOT NULL,                    -- 'human' | 'agent' | 'system'
  actor_id        TEXT NOT NULL,
  title_key       TEXT NOT NULL,                    -- i18n key, render ở client
  params          TEXT NOT NULL DEFAULT '{}',       -- JSON: {actor_name, task_title, ...}
  count           INTEGER NOT NULL DEFAULT 1,       -- số sự kiện đã gộp
  correlation_id  TEXT,
  read_at         TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  pushed_at       TIMESTAMPTZ,                      -- đã gửi web push
  digested_at     TIMESTAMPTZ,                      -- đã vào một email digest
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Tiêu đề **không lưu chuỗi đã render** — lưu `title_key` + `params`, client render
bằng `t()` theo locale hiện tại (đổi ngôn ngữ thì inbox đổi theo). Email digest
render phía server bằng cùng key qua i18n Go (`mail` package đã có template vi/en;
thêm hàm map `title_key → template`). `params` chứa tên hiển thị tại thời điểm sự
kiện (snapshot), không chứa email hay nội dung bình luận đầy đủ (chỉ 140 ký tự đầu).

### 3.2 Index (`066`–`068`, mỗi cái một file)

```sql
-- 066: inbox của tôi, mới nhất trước, lọc chưa đọc
CREATE INDEX CONCURRENTLY idx_notifications_user_time
  ON notifications (user_id, created_at DESC) WHERE archived_at IS NULL;
-- 067: đếm badge
CREATE INDEX CONCURRENTLY idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL AND archived_at IS NULL;
-- 068: gộp
CREATE UNIQUE INDEX CONCURRENTLY uidx_notifications_open_group
  ON notifications (user_id, group_key) WHERE read_at IS NULL AND archived_at IS NULL;
```

Index 068 là cơ chế gộp: consumer `INSERT ... ON CONFLICT (user_id, group_key) WHERE
read_at IS NULL AND archived_at IS NULL DO UPDATE SET count = count + 1, params = EXCLUDED.params,
updated_at = now()`. Đã đọc rồi thì sự kiện mới tạo dòng mới (đúng ý người dùng:
"có gì mới sau khi tôi xem").

### 3.3 `069_notification_preferences`

```sql
-- Một dòng mỗi (user, kind); thiếu dòng = mặc định trong Go (§2 #6).
CREATE TABLE notification_preferences (
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  in_app      BOOLEAN NOT NULL DEFAULT true,
  push        BOOLEAN NOT NULL DEFAULT false,
  email       BOOLEAN NOT NULL DEFAULT false,      -- vào digest
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
```

Ngoại lệ quy ước "trạng thái là timestamp": ba cột boolean ở đây là **cài đặt**,
không phải trạng thái vòng đời; ghi rõ trong migration comment.

### 3.4 `070_push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,                          -- 410 Gone từ push service
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`071`: `CREATE UNIQUE INDEX CONCURRENTLY uidx_push_subscriptions_endpoint ON
push_subscriptions (endpoint) WHERE revoked_at IS NULL;`
`072`: `CREATE INDEX CONCURRENTLY idx_push_subscriptions_user ON push_subscriptions
(user_id) WHERE revoked_at IS NULL;`

### 3.5 `073_users_timezone`

`ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';`
(bỏ qua nếu cột đã có từ Settings spec — kiểm tra `2026-08-27-settings-design.md`).

## 4. Mô hình trong Go

### 4.1 Kinds và quy tắc sinh

Package mới `server/internal/notification`. Mỗi `kind` là một hằng + một hàm
`rule(ev outbox.Row) []Draft` thuần (không I/O ngoài đọc DB để lấy tên/người nhận):

| Kind | Từ topic | Người nhận | `group_key` | Push mặc định |
|---|---|---|---|---|
| `task_assigned` | `task.updated` khi `changes.assignee_id.to = me` (consumer đọc audit cùng `correlation_id` để biết trường đổi, hoặc payload thêm `assignee_changed=1` — chọn cách 2, xem §11) | assignee mới | `task:{id}:assigned` | bật |
| `task_status_changed` | `task.updated` khi `status` đổi | assignee + người tạo (trừ actor) | `task:{id}:status` | tắt |
| `task_commented` | `task.comment_added` | assignee, người tạo, người đã bình luận trước đó (trừ actor) | `task:{id}:commented` | tắt |
| `mentioned` | `task.comment_added`, `chat.message.created` khi body có `@{user}` (parse ở consumer từ nội dung đọc DB) | người được nhắc | `{resource}:{id}:mention:{comment_id}` (không gộp) | bật |
| `meeting_invited` | `participant.invited` | người được mời | `meeting:{id}:invited` | bật |
| `meeting_starting` | job `MeetingReminder` mỗi phút: meeting bắt đầu trong 10 phút, chưa nhắc | participants đã chấp nhận | `meeting:{id}:starting` | bật |
| `meeting_summary_ready` | `summary.created` | participants | `meeting:{id}:summary` | tắt |
| `member_added` | `member.joined`, `workspace_member.added` | người được thêm | `workspace:{id}:added` | tắt |
| `role_changed` | `member.role_changed`, `workspace_member.role_changed` | người bị đổi | `{scope}:{id}:role` | tắt |
| `audit_export_ready` | `audit.exported` | người yêu cầu | `export:{id}` | tắt |

Quy tắc chung: **bỏ qua nếu người nhận = actor**; bỏ qua nếu người nhận không còn
là member (kiểm qua `WorkspaceService.RequireMember` — arch test giữ luật).

### 4.2 Consumer

```go
type Consumer struct{ q *db.Queries; pool; publisher service.EventPublisher; push PushSender; metrics }
func (c *Consumer) Topics() []string  // mọi topic ở §4.1
func (c *Consumer) Handle(ctx, ev outbox.Row) error {
    drafts := rulesFor(ev.Topic)(ctx, c.q, ev)
    for _, d := range drafts {
        if !prefs(d.UserID, d.Kind).InApp { continue }
        n, merged := c.upsert(ctx, d)               // §3.2 ON CONFLICT
        c.publisher.SendToUser(ctx, d.UserID, service.Event{
            Type: "notification.created", Payload: map[string]string{"notification_id": n.ID}})
        if prefs.Push && !merged { c.enqueuePush(ctx, n) }   // outbox topic "notification.push"
    }
    return nil
}
```

- Idempotent: `upsert` khóa theo `group_key`; chạy lại cùng `ev.ID` → có cột
  `last_event_id` trong `notifications`? **Không thêm cột**: dùng bảng nhỏ
  `notification_deliveries (event_id, user_id, PRIMARY KEY)` ở migration `074` để
  chống xử lý hai lần. Đơn giản, đúng.
- Push đi qua outbox topic riêng `notification.push` với consumer `PushConsumer`, để
  lỗi push service không làm retry việc tạo notification.

### 4.3 Web push

- `PushSender` interface; implement bằng `webpush-go`; `LogPushSender` cho dev/test
  như `LogSender` của mail.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; thiếu → push tắt
  toàn cục, UI ẩn nút bật push (endpoint `GET /notifications/push/config` trả
  `enabled=false`).
- 404/410 từ push service → `revoked_at = now()`. Payload push: `title` đã render
  theo `users.locale` (server-side i18n), `url` deep link, `tag = group_key` (trình
  duyệt tự thay thông báo cũ cùng tag).
- Service worker: `apps/web/public/sw.js` — chỉ `push` + `notificationclick` mở
  `url`. Không offline cache trong đợt này.

### 4.4 Email digest

- Job `DigestScheduler` mỗi 15 phút: tìm user có `email = true` ở ít nhất một kind,
  giờ địa phương trong [08:00, 08:15), có notification `digested_at IS NULL AND
  read_at IS NULL` tạo trong 24 h → render `mail.NotificationDigest(DigestData)` →
  `emails` outbox → set `digested_at`. Một mail gom mọi workspace, nhóm theo
  workspace rồi theo kind, tối đa 50 dòng + "và N thông báo khác".
- Không gửi nếu không có gì. Không gửi cho user chưa `email_verified_at`.
- Link "Tắt email này" → `/settings/notifications` (không unsubscribe token đợt
  này; đã đăng nhập).

### 4.5 MeetingReminder

Job mỗi 60 s (cùng goroutine với `RunAutoEnd`): meeting `SCHEDULED`, `starts_at`
trong (now, now+10m], chưa có dòng `notification_deliveries(event_id =
"reminder:"+meeting_id)` → tạo draft `meeting_starting` cho participants đã accept.
Không phát outbox event vì đây là chính consumer.

## 5. API

Tag `Notifications`, SDI/SDO trong `dto/{sdi,sdo}/notification.go`, route trong
`router/notification.go`. Mọi route dưới `/me/...` vì per-user, không cần workspace
trong path; lọc workspace bằng query.

| Method & path | Mô tả |
|---|---|
| `GET /me/notifications?workspace_id=&unread=1&before=<ulid>&limit=50` | Danh sách, cursor. SDO có `resource_deleted: bool` nếu resource không còn |
| `GET /me/notifications/unread-count?workspace_id=` | `{total, by_workspace: {ws_id: n}}` — một query, cho badge sidebar và switcher |
| `POST /me/notifications/read` body `{ids: []}` hoặc `{all: true, workspace_id?}` | Đánh dấu đã đọc |
| `POST /me/notifications/unread` body `{ids: []}` | Bỏ đánh dấu |
| `POST /me/notifications/archive` body `{ids: []}` | Lưu trữ (ẩn khỏi inbox) |
| `GET|PUT /me/notification-preferences` | Ma trận kind × kênh; PUT toàn bộ, validate kind trong danh sách |
| `GET /notifications/push/config` | `{enabled, public_key}` |
| `POST /me/push-subscriptions` body `{endpoint, keys: {p256dh, auth}}` | Đăng ký (upsert theo endpoint) |
| `DELETE /me/push-subscriptions` body `{endpoint}` | Hủy |

Quyền: tất cả là của chính người gọi (`user_id` từ JWT). Không có endpoint đọc
notification của người khác. Không có endpoint tạo notification tay (§2 #7).

Lỗi: `mapServiceError` thêm `ErrNotificationNotFound` → 404 (ids không thuộc user
cũng là 404, không lộ tồn tại).

## 6. Frontend

### 6.1 File map

| Path | Trách nhiệm |
|---|---|
| `packages/core/types/notification.ts` | `Notification`, `NotificationKind` (union + `NOTIFICATION_KINDS`), schema lenient |
| `packages/core/api/endpoints/notifications.ts` (+ `.test.ts`) | 9 hàm §5, `parseWithFallback`, malformed test cho mỗi hàm |
| `packages/core/notifications/hooks.ts` | `notificationKeys` factory (`list(wsId?, filter)`, `unreadCount()`, `prefs()`), `useNotifications`, `useUnreadCount`, `useMarkRead` (optimistic — thỏa 4 điều kiện CLAUDE.md: đoán được, cùng màn hình, hiếm lỗi, rollback = restore cache), `useNotificationPrefs` |
| `packages/core/notifications/push.ts` | `subscribePush()` / `unsubscribePush()` dùng `StorageAdapter` để nhớ đã hỏi quyền chưa; **không** đụng `window` ngoài `platform/` — phần `navigator.serviceWorker` đặt trong `packages/core/platform/push-adapter.ts` với interface, web implement ở `apps/web/platform/push.ts` |
| `packages/core/realtime/use-realtime-sync.ts` | case `notification.created` → invalidate `notificationKeys.list()` + `unreadCount()`; sự kiện đến trên **user scope** (relay đã auto-subscribe) |
| `packages/core/types/events.ts` | thêm `"notification.created"` |
| `packages/core/paths/paths.ts` | `workspace(org, ws).inbox()` → `/{org}/{ws}/inbox`; `settings.notifications()` |
| `packages/views/notifications/inbox-view.tsx` | Danh sách: nhóm "Chưa đọc" / "Trước đó", dòng = icon kind + tiêu đề `t(title_key, params)` + `count > 1` → "và 4 thay đổi khác" + thời gian tương đối; click → `AppLink` tới resource và mark read; phím `j/k/e/r` |
| `packages/views/notifications/inbox-empty.tsx` | Empty state: "Chưa có thông báo. Bạn sẽ nhận khi được giao việc, được nhắc hoặc được mời họp." + link cài đặt |
| `packages/views/notifications/notification-row.tsx` | Một dòng; `resource_deleted` → mờ + "đã xóa" |
| `packages/views/notifications/kind-icon.tsx` | Map kind → icon `packages/ui` |
| `packages/views/settings/components/notification-preferences.tsx` | Ma trận kind × (In-app, Push, Email); hàng push disabled + tooltip khi `enabled=false` |
| `packages/views/layout/app-sidebar.tsx` | Mục "Hộp việc" (`nav.inbox`) dưới Home, badge `unread.by_workspace[ws]`; `workspace-switcher.tsx` chấm đỏ nếu ws khác có unread |
| `packages/views/layout/workspace-top-bar.tsx` | Nút chuông mở popover 10 dòng mới nhất + "Xem tất cả" |
| `apps/web/app/[orgSlug]/[workspaceSlug]/inbox/page.tsx` | Shell mỏng render `InboxView` |
| `apps/web/public/sw.js`, `apps/web/platform/push.ts` | Service worker + đăng ký |

### 6.2 i18n

Keys `notifications.*` trong `vi.json` trước, `en.json` sau (`parity.test`). Tiêu đề
theo kind, ví dụ `notifications.kind.task_assigned = "{{actor}} đã giao bạn việc
“{{task}}”"`. Số nhiều: `notifications.merged_other = "và {{count}} thay đổi khác"`.
Giọng văn theo `docs/conventions.md` §3: đồng nghiệp, không dấu chấm than.

### 6.3 Hành vi

- Mở inbox không tự mark all read; đọc từng dòng khi click, có nút "Đánh dấu tất cả
  đã đọc" theo workspace hiện tại.
- Badge đọc `unread-count` với `staleTime` 30 s, invalidate bởi realtime; không
  polling.
- Reduced motion: badge không nhấp nháy. Dark/light qua token, không hardcode.

## 7. Bảo mật & riêng tư

- `params` không chứa email, không chứa nội dung bình luận đầy đủ; snapshot tên là
  `display_name` tại thời điểm đó.
- Push payload đi qua push service của trình duyệt (mã hóa E2E theo RFC 8291),
  vẫn giữ tối thiểu: tiêu đề + url, không mô tả task.
- Người bị remove khỏi workspace: notification cũ giữ (là của họ) nhưng link mở →
  403 ở resource; consumer không tạo mới cho họ.
- Rate: một user không thể bị đẩy > 60 push/giờ; vượt thì chỉ in-app (đếm trong
  Redis nếu có, fail-open như rate limit hiện tại).

## 8. Testing

### 8.1 Go

1. `TestRuleTaskAssigned`: `task.updated` với `assignee_changed=1` → 1 draft cho
   assignee, 0 cho actor nếu tự giao mình.
2. `TestMergeWithinWindow`: hai `task.updated` cùng task, chưa đọc → 1 dòng,
   `count=2`; đọc rồi sự kiện thứ ba → dòng mới.
3. `TestConsumerIdempotent`: `Handle` hai lần cùng `ev.ID` → 1 dòng, 1 push.
4. `TestPrefsGate`: `in_app=false` → không tạo; `push=false` → tạo nhưng không push.
5. `TestDigestOncePerDay`: chạy scheduler ba lần trong 15 phút → 1 mail; set
   `digested_at`; không mail khi rỗng; không mail khi chưa verify email.
6. `TestPushGone`: sender trả 410 → `revoked_at` set, không retry.
7. `TestMeetingReminderOnce`: meeting bắt đầu sau 8 phút → 1 notification/participant;
   tick tiếp không tạo thêm.
8. `TestIsolation`: `POST /me/notifications/read` với id của user khác → 404, không
   đổi gì.
9. Arch: chỉ `internal/notification` đọc `notification_preferences`; chỉ
   `WorkspaceService.RequireMember` quyết membership (đã có).

### 8.2 Frontend

- Malformed-response test cho 9 endpoint.
- `hooks.test.tsx`: optimistic mark-read rollback khi API lỗi.
- `inbox-view.test.tsx`: render nhóm, `count>1`, `resource_deleted`, empty state.
- `use-realtime-sync.test.tsx`: `notification.created` invalidate đúng hai key.
- `parity.test`, `paths/consistency.test` (page `inbox` ↔ builder).

### 8.3 E2E (Playwright, thêm vào `e2e/`)

User A giao task cho B → B thấy badge = 1 trong ≤ 2 s không reload → mở inbox →
click → tới task → badge = 0.

## 9. Kế thừa & bỏ

| Bản cũ | Xử lý |
|---|---|
| Kinds `mention, task, meeting, document, workflow, system, email` | Thay bằng kinds hành động cụ thể (§4.1); `document/workflow` thêm khi có module |
| `PREF_KEYS` phẳng `email_task`, `email_daily_digest`… | Thay bằng ma trận kind × kênh |
| Web push tự viết bằng Web Crypto | Bỏ; dùng thư viện |
| `createNotification` public từ client | **Bỏ hẳn** (từng là lỗ hổng giả mạo thông báo) |
| Archive/restore/delete | Giữ archive; bỏ delete (không cần, lưu trữ đủ) |
| IA V2: Inbox dưới Home, badge chưa đọc, chuông top bar | Kế thừa nguyên |
| `use-unread-counts.ts` gom N+1 → 1 RPC (PERF-002) | Kế thừa bài học: một endpoint `unread-count` trả theo workspace |

## 10. Definition of Done (Vision §6.9)

- [ ] Audit/outbox spec đã merge (`Dispatcher`, `Consumer`, catalogue).
- [ ] Migration `065`–`074` up/down qua `lint_test.go`.
- [ ] Package `notification` + `PushConsumer` + `DigestScheduler` + `MeetingReminder`, test §8.1 xanh, coverage floor không giảm.
- [ ] `webpush-go` thêm vào `go.mod` với dòng lý do trong plan; `govulncheck` sạch.
- [ ] API §5 với SDI/SDO, Swagger test xanh; FE endpoints + malformed tests.
- [ ] UI §6: inbox, popover chuông, badge sidebar/switcher, preferences; vi/en, sáng/tối, bàn phím, mobile ≥ 44 px; empty state trung thực.
- [ ] Service worker + đăng ký push; ẩn khi VAPID chưa cấu hình.
- [ ] Reserved slug `inbox` thêm vào `reserved_slugs.json`, chạy `pnpm generate:reserved-slugs`.
- [ ] Catalogue: `notification.created`, `notification.push` thêm ở ba nơi, test khớp.
- [ ] Metric: `notifications_created_total{kind}`, `notifications_merged_total`, `push_sent_total{result}`, `digest_sent_total`.
- [ ] E2E §8.3 xanh trong CI.
- [ ] `docs/conventions.md` §2 glossary: "Hộp việc" = Inbox, "thông báo" = notification, "nhắc" = mention.

## 11. Câu hỏi mở (chủ sở hữu sản phẩm quyết)

1. **Cách consumer biết "assignee đổi".** (a) service thêm `assignee_changed=1`
   vào payload `task.updated` — đơn giản, hơi rò rỉ ý đồ notification vào Tasks;
   (b) consumer đọc `audit_events.changes` cùng `correlation_id` — sạch hơn, thêm
   một query. Đề xuất (b) vì audit đã là nguồn "cái gì đổi".
2. **Giờ digest cố định 08:00 hay người dùng chọn?** Đề xuất cố định đợt này, thêm
   cột `digest_hour` sau nếu có yêu cầu.
3. **Chat DM có tạo notification không** khi người nhận không mở chat? Đề xuất: chỉ
   `mentioned` trong đợt này; "tin nhắn mới" để chat tự hiển thị badge riêng (đã
   có `chat.room.activity`), tránh hộp việc bị chat nhấn chìm.
4. **Push mặc định bật cho `meeting_starting`** có làm phiền không? Đề xuất bật,
   vì đây là notification có giá trị thời điểm cao nhất; người dùng tắt được.
5. **Tên tiếng Việt của Inbox**: "Hộp việc" (bản cũ) hay "Thông báo"? Ảnh hưởng
   `nav.inbox` và glossary.
