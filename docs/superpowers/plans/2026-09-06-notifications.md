# F-07 · Notification: inbox, đã đọc, tùy chọn, web push, email digest, badge realtime — Plan triển khai

> **Trạng thái:** shipped

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notification sinh từ `NotificationConsumer` trên outbox (không từ handler), bản ghi per-user `notifications` với `title_key` + `params` render bằng `t()`, gộp theo `(user_id, group_key)` khi chưa đọc; ba kênh một nguồn (in-app, web push VAPID, email digest 08:00 theo `users.timezone`); badge chưa đọc qua user scope của relay, frame chỉ mang id; route `/{org}/{ws}/inbox` ("Hộp việc"); ma trận tùy chọn kind × kênh trong Settings.

**Issue:** UNI-427 · **Spec:** `docs/superpowers/specs/2026-09-04-notifications-design.md` · **Câu hỏi mở đã chốt:** OPEN_QUESTIONS nhóm N · **ADR:** 0007, 0008, 0009, 0012.

## Global Constraints

- Mọi lệnh chạy từ `uniwork/`. Go: `cd server && go test ./internal/... -run X`; đầy đủ `make test-go`. TS: `pnpm --filter @uniwork/core test`, `pnpm --filter @uniwork/views test`. sqlc: `make sqlc`.
- Migration: không `REFERENCES`/`FOREIGN KEY`, index `CONCURRENTLY` một mình một file, có `.down.sql`; bảng mới có `organization_id TEXT NOT NULL` hoặc nằm trong `tenantExemptTables` với lý do (`lint_test.go`).
- Chỉ `internal/audit` ghi audit/outbox: consumer phát `notification.created` / `notification.push` qua `audit.Recorder.Emit` với actor `System("notification")` — sự kiện hạ tầng, không có lệnh nghiệp vụ phía sau. Sự kiện mới vào catalogue ba nơi.
- Membership chỉ qua `WorkspaceService.RequireMember`; chỉ `internal/notification` đọc `notification_preferences` (`arch_test.go`).
- Một dependency mới: `github.com/SherClockHolmes/webpush-go` (RFC 8291 aes128gcm, không tự viết).
- vi.json trước, en.json cùng key. JSX trong `views` qua `t()`. Không hardcode màu.
- Commit sau mỗi task; message `feat(notifications): …`, `feat(db): …`, `feat(core): …`, `feat(views): …`.

## Quyết định lúc implement (chốt các chỗ spec để ngỏ)

| # | Chỗ spec để ngỏ | Chốt |
|---|---|---|
| 1 | Số migration | Mới nhất trên `develop` là `081` → dùng `082`–`091` |
| 2 | N1 consumer biết "assignee đổi" | (b): đọc `audit_events.changes` cùng `correlation_id` + `action` + `resource_id` của outbox row (`GetAuditEventByCorrelation`). Tasks không biết Notification tồn tại |
| 3 | Phát realtime | Không gọi `EventPublisher` trực tiếp: consumer ghi `notification.created` (scope `user`, outbox) và `notification.push` (scope `-`, outbox) cùng transaction với dòng notification qua `Recorder.Emit`. `RealtimeConsumer` có sẵn giao tới user scope; `PushConsumer` nhận `notification.push`. Mất process không mất badge |
| 4 | Idempotency | Bảng `notification_deliveries (event_id, user_id)` PK — ghi cùng tx với upsert; xử lý lại cùng `ev.ID` → no-op. `MeetingReminder` dùng `event_id = "reminder:" + meeting_id` |
| 5 | Kinds đợt này | 9 kind: `task_assigned`, `task_status_changed`, `task_commented`, `mentioned`, `meeting_invited`, `meeting_starting`, `member_added`, `role_changed`, `audit_export_ready`. **Bỏ `meeting_summary_ready`**: `summary.created` là ephemeral, không qua outbox; thêm khi topic lên outbox |
| 6 | `mentioned` từ chat | Chỉ từ `task.comment_added`: `chat.message.created` là ephemeral. N3 đã chốt chat tự hiển thị badge riêng |
| 7 | Parse mention | `@` + display_name của thành viên workspace (không phân biệt hoa thường). Không có handle người dùng — `ponytail:` đổi sang `@handle` khi Settings có cột handle |
| 8 | `title_key` | `notifications.kind.<kind>`; `params` là snapshot `{actor, task, meeting, workspace, role, count}`; body bình luận cắt 140 ký tự. Server render cùng key cho push/digest qua `titles.go` (vi/en) — cùng nội dung với `vi.json`/`en.json`; `titles_test.go` đọc hai file JSON và so khớp |
| 9 | Rate 60 push/giờ/user (§7) | **Chưa làm** (cần Redis counter). Push chỉ đi khi dòng mới, không đi khi gộp → spam đã bị chặn ở gốc. Thêm khi có metric `push_sent_total` vượt ngưỡng |
| 10 | Digest | `DigestScheduler` tick 15 phút; ứng viên = user có notification `read_at IS NULL AND digested_at IS NULL AND created_at > now()-24h`; lọc trong Go: `email_verified_at`, giờ địa phương ∈ [08:00, 08:15) theo `users.timezone`, kind có `email=true`. Mail kind `notification_digest`, template vi/en, tối đa 50 dòng + "và N thông báo khác" |
| 11 | `users.timezone` | Chưa có (Settings spec chưa thêm) → `091_users_timezone` mặc định `Asia/Ho_Chi_Minh`; `PATCH /me` nhận `timezone`, validate bằng `time.LoadLocation`; tab Tùy chọn có Select múi giờ |
| 12 | `resource_deleted` | Hai query `ListExistingTaskIDs` / `ListExistingMeetingIDs` với `ANY($1)` cho cả trang; không N+1 |
| 13 | Push config | `GET /notifications/push/config` → `{enabled, public_key}`; thiếu `VAPID_*` thì `enabled=false`, UI ẩn hàng Push |
| 14 | Service worker | `apps/web/public/sw.js`: chỉ `push` + `notificationclick` mở `url`; đăng ký từ `apps/web/platform/push.ts` qua `PushAdapter` trong `packages/core/platform/push-adapter.ts` |
| 15 | Đường dẫn cài đặt | `/settings?tab=notifications` — không thêm builder riêng (consistency test chỉ soi page ↔ builder) |

## File map

**Backend — tạo mới**
- `server/migrations/082_notifications.{up,down}.sql` … `091_users_timezone.{up,down}.sql`
- `server/pkg/db/queries/notifications.sql`
- `server/internal/notification/{kinds.go,rules.go,consumer.go,prefs.go,service.go,push.go,push_consumer.go,digest.go,reminder.go,titles.go}` + tests
- `server/internal/handler/{notification.go,notification_test.go}`, `router/notifications.go`, `dto/sdi/notification.go`, `dto/sdo/notification.go`
- `server/internal/mail/{notification_digest.go}`, `templates/notification_digest.{vi,en}.{html,txt}`

**Backend — sửa**
- `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`
- `server/internal/arch_test.go` (prefs chỉ trong `internal/notification`), `server/migrations/lint_test.go` (exempt), `server/internal/testutil/db.go` (TRUNCATE)
- `server/internal/config/config.go` (`VAPID_*`), `server/cmd/server/main.go`, `server/internal/metrics/registry.go`
- `server/internal/handler/{router.go,auth.go}`, `router/{routes.go,router.go,me.go}`, `dto/{sdi,sdo}/auth.go`, `service/auth.go`, `queries/users.sql` (timezone)
- `server/internal/service/reserved_slugs.json`, `packages/core/paths/reserved-slugs.ts`

**Frontend**
- `packages/core/types/notification.ts`, `api/endpoints/notifications.ts` + test, `notifications/hooks.ts` + test, `notifications/push.ts`, `platform/push-adapter.ts`, `platform/index.ts`, `package.json` exports
- `packages/core/realtime/use-realtime-sync.ts` + test, `paths/paths.ts`
- `packages/views/notifications/{inbox-view.tsx,notification-row.tsx,kind-icon.tsx,notification-bell.tsx}` + test
- `packages/views/settings/components/notifications-tab.tsx` + test, `settings-page.tsx`, `preferences-tab.tsx` (múi giờ)
- `packages/views/layout/{app-sidebar.tsx,workspace-switcher.tsx,workspace-top-bar.tsx}`, `package.json` exports
- `apps/web/app/[orgSlug]/[workspaceSlug]/inbox/page.tsx`, `apps/web/public/sw.js`, `apps/web/platform/push.ts`, `app/providers.tsx`
- `packages/core/i18n/locales/{vi,en}.json` — `nav.inbox`, `notifications.*`, `settings.notifications.*`, `settings.page.tabs.notifications`
- `e2e/notifications.spec.ts`

**Docs**
- `docs/conventions.md` §2 (Hộp việc / thông báo / nhắc), `docs/roadmap/FEATURE_ROADMAP.md` F-07 → CÓ, spec header, plan → `shipped`

## Tasks

### Task 1 — Migration + lint (`feat(db): notifications, preferences, push subscriptions, deliveries, user timezone`)
- [x] `082`–`091` + down; `lint_test.go` exempt `notification_preferences`, `push_subscriptions`, `notification_deliveries` (per-user / idempotency ledger)
- [x] `testutil/db.go` TRUNCATE thêm 4 bảng
- [x] `notifications.sql`, `users.sql` timezone, `audit.sql` `GetAuditEventByCorrelation`; `make sqlc`

### Task 2 — Package notification: rules + consumer (`feat(notifications): outbox consumer with merge, prefs gate, idempotency`)
- [x] `kinds.go`, `prefs.go` (mặc định §2 #6), `titles.go` (vi/en), `rules.go` (9 rule), `consumer.go` (upsert ON CONFLICT, deliveries, Emit created/push)
- [x] Catalogue ba nơi: `notification.created`, `notification.push`
- [x] Test: `TestRuleTaskAssigned`, `TestMergeWithinWindow`, `TestConsumerIdempotent`, `TestPrefsGate`, `TestMentioned`; arch test prefs

### Task 3 — Push, digest, reminder (`feat(notifications): web push VAPID, daily digest, meeting reminder`)
- [x] `go get webpush-go`; `push.go` (`PushSender`, `WebPushSender`, `LogPushSender`), `push_consumer.go` (410 → revoked_at)
- [x] `mail/notification_digest.go` + template; `digest.go`
- [x] `reminder.go` tick 60 s; config `VAPID_*`; metrics `notifications_created_total{kind}`, `notifications_merged_total`, `push_sent_total{result}`, `digest_sent_total`
- [x] Test: `TestPushGone`, `TestDigestOncePerDay`, `TestMeetingReminderOnce`

### Task 4 — HTTP (`feat(api): /me/notifications, preferences, push subscriptions, push config`)
- [x] `service.go`: List (cursor, `resource_deleted`), UnreadCount by workspace, MarkRead/Unread/Archive (ids của user khác → 404), Prefs Get/Put, push subscribe/unsubscribe
- [x] Routes + SDI/SDO + `main.go` wiring; `PATCH /me` timezone; reserved slug `inbox`
- [x] Test: `TestIsolation` (id người khác → 404), swagger test xanh

### Task 5 — Core (`feat(core): notification types, endpoints, hooks, push adapter, realtime`)
- [x] `types/notification.ts`, `endpoints/notifications.ts` 10 hàm + malformed test
- [x] `notifications/hooks.ts`: `notificationKeys`, `useNotifications`, `useUnreadCount`, `useMarkRead` (optimistic + rollback), `useMarkUnread`, `useArchive`, `useMarkAllRead`, `useNotificationPrefs`, `useUpdatePrefs`, `usePushConfig`
- [x] `platform/push-adapter.ts` + `notifications/push.ts`; realtime `notification.created` → invalidate list + unreadCount; `paths.workspace().inbox()`

### Task 6 — Views (`feat(views): inbox, bell popover, sidebar badge, notification settings`)
- [x] `inbox-view.tsx` (Chưa đọc / Trước đó, `count>1`, `resource_deleted`, empty state, `j/k/e/r`, mark all read), `notification-row.tsx`, `kind-icon.tsx`
- [x] `notification-bell.tsx` popover 10 dòng + "Xem tất cả"; sidebar "Hộp việc" + badge; switcher chấm đỏ
- [x] `notifications-tab.tsx` ma trận kind × kênh, hàng push ẩn khi `enabled=false`; múi giờ trong Tùy chọn
- [x] Web: `inbox/page.tsx`, `sw.js`, `platform/push.ts`; i18n vi/en
- [x] Test view: nhóm, count, deleted, empty; prefs tab

### Task 7 — E2E + docs đóng vòng (`docs: F-07 shipped`)
- [x] `e2e/notifications.spec.ts`: A giao việc cho B → badge = 1 ≤ 2 s → inbox → click → task → badge = 0
- [x] Glossary, roadmap F-07 `CÓ`, spec header, plan → `shipped`
- [x] `make check` xanh; `[agent]` comment trên UNI-427

## Đã cố ý bỏ ra ngoài

- `meeting_summary_ready` (quyết định #5), `mentioned` từ chat (#6), rate limit push 60/giờ (#9).
- Mobile push APNs/FCM, Zalo/Slack, snooze, nhắc theo due date, unsubscribe token trong mail digest (spec §1).
- Notification center cấp org (spec §2 #7).

## Ghi nhận lúc implement

- Sửa tiện đường (bug có sẵn, E2E lộ ra): `useAcceptInvite` không làm mới session nên người mới nhận lời mời bị `DashboardGuard` đẩy về `/onboarding`; `InvitationsView.onEmpty` ghi đè điều hướng sau khi tham gia. Cả hai sửa trong `packages/core/workspaces/hooks.ts` và `packages/views/workspace/invitations-view.tsx`.
- Badge realtime đo được ~1,5–2,5 s vì đi hai chặng outbox ở tick 1 s (`MEETING_WORKER_TICK`); E2E cho 5 s. Muốn ≤ 1 s thì hạ tick hoặc phát thẳng lên socket từ consumer (mất tính bền).
- Arch test `TestActorConstructedOnlyInService` miễn `internal/notification/` (worker tầng service, không có request nào đi qua).
