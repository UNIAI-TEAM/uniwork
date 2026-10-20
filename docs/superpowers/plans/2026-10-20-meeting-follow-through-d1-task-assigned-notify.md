# Đợt 1 (UNI-1996): báo người được giao khi task tạo sẵn người phụ trách — kế hoạch triển khai

> **Trạng thái:** in-progress — kế hoạch ngày 2026-10-20, triển khai trên nhánh `feature/UNI-1996-meetings-sau-hop-dot-1-bao-nguoi-duoc-gi`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task tạo ra đã có người phụ trách thì người đó nhận thông báo, ở mọi đường tạo task. Một lần tạo giao nhiều task cho cùng một người thì người đó nhận đúng một thông báo.

**Architecture:** Thêm rule `task.created` vào `server/internal/notification/rules.go`. Rule gom các task **tạo trong cùng một transaction** bằng các dòng audit `task.created` có cùng `correlation_id` và cùng `xact_id` (cột `xid8` mặc định `pg_current_xact_id()`, migration 9991791830000300). Nhóm, task đại diện và người nhận chỉ đọc từ các dòng audit này (bất biến), không từ người phụ trách hiện tại của task. Mỗi nhóm (cùng người phụ trách) chỉ task có id nhỏ nhất phát thông báo. Thêm kind `tasks_assigned` cho nhóm từ hai task trở lên.

**Tech Stack:** Go (pgx, sqlc), PostgreSQL; TypeScript (zod, React, vitest); i18n JSON.

**Spec:** `docs/superpowers/specs/2026-10-20-meeting-follow-through-design.md` §8.3 (đợt 1), §13.1 (đợt 1).

## Global Constraints

- Không migration (index `idx_audit_events_correlation` đã có, migration 061).
- Query mới chạm `audit_events` (bảng có `organization_id`), nên mang dòng `-- tenant: system` như `GetAuditEventByCorrelation` (`TestEveryQueryNamesItsTenant`).
- Không đổi payload hay catalogue sự kiện: `task.created` vẫn `{task_id, workspace_id}`.
- Kind mới phải có mặt ở đủ: `kinds.go` (`Kinds`), `prefs.go` (`DefaultPrefs`), `titles.go` (vi, en), `packages/core/i18n/locales/{vi,en}.json` (`notifications.kind.*` và nhãn ma trận cài đặt), `packages/core/types/notification.ts` (`NOTIFICATION_KINDS`), và các bảng `Record<Kind, …>` phía views. `titles_test.go` so tiêu đề server với JSON.
- Tiêu đề vi: `{{actor}} đã giao bạn {{count}} việc`; en: `{{actor}} assigned you {{count}} tasks`. Nhãn ma trận vi: `Được giao nhiều việc một lúc`; en: `Assigned several tasks at once`.
- `tasks_assigned` đẩy mặc định (như `task_assigned`), trong app và email bật.
- Chạy test lọc theo tên; không chạy full suite cục bộ (CI chạy). Vitest cục bộ cần `NODE_OPTIONS=--no-experimental-webstorage`.

## Review Focus

1. Task bị xoá trước khi sự kiện được xử lý: nhóm vẫn tính theo dòng audit (bất biến). Task đầu bị xoá thì không phát gì; không được phát hai lần.
2. Request có hai transaction cùng `correlation_id` (MCP gọi nhiều lệnh): mỗi transaction là một nhóm riêng, không gộp chéo, không làm mất thông báo.
3. Người phụ trách là agent, hoặc là chính người tạo: không phát.
4. Người phụ trách đã rời workspace khi sự kiện được xử lý: `recipients.add` bỏ qua (gate thành viên).
5. Sự kiện không có `correlation_id`: mỗi task một nhóm.

---

### Task 1: Query đọc các task tạo cùng transaction

**Files:**
- Modify: `server/pkg/db/queries/audit.sql` (thêm sau `GetAuditEventByCorrelation`)
- Regenerate: `server/pkg/db/generated/*` (`make sqlc`)

**Interfaces:**
- Produces: `q.ListAuditEventsInTransaction(ctx, db.ListAuditEventsInTransactionParams{CorrelationID string, Action string, ResourceID string}) ([]db.AuditEvent, error)`

- [ ] **Step 1: Thêm query**

```sql
-- name: ListAuditEventsInTransaction :many
-- tenant: system
-- The notification consumer groups what one transaction did: the rows of
-- this action written by the transaction (xact_id) that wrote this
-- resource's row. One correlation id may span several transactions (an MCP
-- call), so xact_id is what tells them apart.
SELECT t.* FROM audit_events t
WHERE t.correlation_id = sqlc.arg(correlation_id) AND t.action = sqlc.arg(action)
  AND t.xact_id = (SELECT a.xact_id FROM audit_events a
                   WHERE a.correlation_id = sqlc.arg(correlation_id) AND a.action = sqlc.arg(action)
                     AND a.resource_id = sqlc.arg(resource_id)
                   ORDER BY a.occurred_at LIMIT 1)
ORDER BY t.resource_id;
```

- [ ] **Step 2: `cd server && make sqlc`** (hoặc `make sqlc` ở gốc), rồi `go build ./...`. Kỳ vọng: build sạch.

- [ ] **Step 3: Commit** `feat(notification): query audit rows of one transaction` (gộp với Task 2 nếu muốn một commit cho server).

### Task 2: Rule `task.created` và kind `tasks_assigned` (server)

**Files:**
- Modify: `server/internal/notification/rules.go` (bảng `rules`; hàm mới cạnh `ruleTaskUpdated`)
- Modify: `server/internal/notification/kinds.go`, `prefs.go`, `titles.go`
- Modify: `server/internal/handler/dto/sdo/notification.go` (chuỗi `description` của `Kind` liệt kê thêm `tasks_assigned`)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (`notifications.kind.tasks_assigned` và nhãn ma trận cạnh `"task_assigned": "Được giao việc"`), để `titles_test.go` xanh
- Test: `server/internal/notification/task_created_test.go` (mới)

**Interfaces:**
- Consumes: `ListAuditEventsInTransaction` (Task 1); `newRecipients`, `drafts`, `actorName`, `orgOf` (đã có).
- Produces: `KindTasksAssigned = "tasks_assigned"`; `ruleTaskCreated(ctx, e env, ev outbox.Row, p map[string]string) ([]Draft, error)`; `rules["task.created"] = ruleTaskCreated`.

- [ ] **Step 1: Viết test hỏng** trong `task_created_test.go`, dùng `newFixture`. Thêm helper tạo task có người phụ trách qua `f.tasks.Create` / `f.tasks.CreateManyWith` với `service.CreateTaskInput{Title, AssigneeID: &id, OriginType, OriginID}`; batch chạy dưới `audit.WithRequest(f.ctx, audit.RequestInfo{CorrelationID: "corr-…"})`. Cần người thứ ba: thêm helper `f.addMember(t, email, name) db.User` theo đúng cách `newFixture` thêm `member`. Các test:

```go
// One task created for the member: one task_assigned, the creator hears nothing.
func TestRuleTaskCreatedNotifiesTheAssignee(t *testing.T)
//   want: inbox(member) == 1, Kind == KindTaskAssigned, GroupKey "task:<id>:assigned",
//         ResourceType "task"; inbox(owner) == 0
func TestRuleTaskCreatedSkipsSelfAndAgentAssignees(t *testing.T)
//   owner assigns self → 0 rows; agent assignee (AddWorkspaceAgentMember as in
//   service/task_catalog_test.go) → 0 rows
func TestRuleTaskCreatedGroupsOneTransaction(t *testing.T)
//   one CreateManyWith under corr "corr-batch": 3 tasks → member, 1 → member2
//   handle every task.created of the call → member: 1 row Kind KindTasksAssigned,
//   Params count "3", GroupKey "tasks:<smallest task id>:assigned"; member2: 1 row
//   KindTaskAssigned
//   reset the inbox, handle the same events in reverse order → same rows
//   handle the leader event a second time → still one row each (delivery idempotency)
func TestRuleTaskCreatedKeepsTransactionsApart(t *testing.T)
//   two CreateManyWith calls under the SAME correlation id, 2 tasks → member each
//   → member has 2 tasks_assigned rows, each count "2"
func TestRuleTaskCreatedPointsAMeetingBatchAtTheMeeting(t *testing.T)
//   2 tasks → member with OriginType "meeting", OriginID &meetingID (create the
//   meeting with f.meetings like other tests) → ResourceType "meeting", ResourceID meetingID
func TestRuleTaskCreatedWithoutCorrelationIsOnePerTask(t *testing.T)
//   CreateMany without WithRequest (Record makes one correlation per command),
//   2 tasks → member → 2 task_assigned rows
func TestRuleTaskCreatedLeaderDeletedSendsNothing(t *testing.T)
//   batch of 2 → member; delete the smaller-id task before handling; handle both
//   events → member has 0 rows (no double send, no promotion of the second task)
```

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `cd server && go test ./internal/notification/ -run 'TestRuleTaskCreated' -count=1`
Expected: FAIL (`KindTasksAssigned` undefined).

- [ ] **Step 3: Thêm kind.**
  - `kinds.go`: `KindTasksAssigned = "tasks_assigned"`, đặt ngay sau `KindTaskAssigned` trong `Kinds`.
  - `prefs.go`: thêm vào điều kiện `push` của `DefaultPrefs`.
  - `titles.go`: tiêu đề vi/en theo Global Constraints.
  - Hai file JSON: cùng chuỗi, cộng nhãn ma trận.
  - SDO: thêm vào chuỗi mô tả.

- [ ] **Step 4: Viết `ruleTaskCreated`** trong `rules.go`.
  1. `ev.CorrelationID` không hợp lệ thì `nil, nil`. Ngược lại `ListAuditEventsInTransaction(corr, audit.ActionTaskCreated, task_id)`; decode `changes` từng dòng thành `map[string]audit.Change`.
  2. Người phụ trách lấy từ dòng audit của chính task này: `assignee_kind.To == "human"` và có `assignee_id.To`; không có (vd. task chào mừng onboarding, dòng audit không có `changes`) thì `nil, nil`.
  3. `ids` = `resource_id` các dòng cùng transaction có cùng người phụ trách người đó (đã xếp theo `resource_id`). `leader := ids[0]`; `task_id != leader` thì `nil, nil`.
  4. `GetTask(task_id)` chỉ để kiểm còn tồn tại (không có thì `nil, nil`), lấy tiêu đề và kiểm nguồn họp. Tự giao đã bị `newRecipients` loại (người tạo là actor); task chào mừng dừng ở bước 2.
  5. Người nhận: `newRecipients(...).add(assignee)` — người phụ trách theo audit, không theo task hiện tại. Hàm này loại actor và người không còn là thành viên.
  6. `len(ids) == 1`: `drafts(orgID, KindTaskAssigned, "task:"+task.ID+":assigned", "task", task.ID, {"actor", "task"})`, cùng params với `ruleTaskUpdated`.
  7. Ngược lại: `drafts(orgID, KindTasksAssigned, "tasks:"+leader+":assigned", resType, resID, {"actor", "count": strconv.Itoa(len(ids))})`. `resType/resID` là `"meeting"`/`origin_id` khi **mọi** task còn đọc được trong `ids` có `origin_type == "meeting"` và cùng `origin_id`; còn lại là `"task"`/`leader`. Đọc bằng `GetTask` từng id, tối đa 50.

  Đăng ký `"task.created": ruleTaskCreated` cạnh `"task.updated"`. Comment giải thích vì sao gom theo `correlation_id + xact_id` và chỉ đọc audit. `tasks_assigned` trỏ tới cuộc họp mở `?section=summary` (client `resource-href.ts` và `ResourceURL` của push), nơi chứa việc cần làm cho tới UNI-1998.

- [ ] **Step 5: Chạy test**

Run: `cd server && go test ./internal/notification/ -run 'TestRuleTaskCreated|TestTitles|TestRuleTaskAssigned' -count=1`
Expected: PASS. Sau đó chạy `go vet ./internal/notification/ && go tool staticcheck ./internal/notification/`.

- [ ] **Step 6: Chạy các test chạm thông báo task ở handler**

Run: `cd server && go test ./internal/handler/ -run 'TestHome|TestNotification' -count=1`
Expected: PASS. `home_test.go` đếm đúng một dòng sau khi giao: task tạo không người phụ trách rồi PATCH, nên rule mới không thêm dòng. Nếu một test đếm thông báo mà tạo task **có** người phụ trách, sửa kỳ vọng và ghi lý do trong commit.

- [ ] **Step 7: Commit** `feat(notification): notify the assignee of a task created already assigned` (body: lý do, gom theo transaction, cố ý không thông báo cho agent).

### Task 3: Kind `tasks_assigned` phía client

**Files:**
- Modify: `packages/core/types/notification.ts` (`NOTIFICATION_KINDS`, sau `"task_assigned"`)
- Modify: `packages/views/settings/components/notifications-matrix.tsx` (danh sách hàng, cạnh `"task_assigned"`; `PUSH_BY_DEFAULT`)
- Modify: `packages/views/notifications/kind-icon.tsx` (cùng icon `UserRoundCheck`), `kind-tone.ts` (`moduleTone("tasks")`), `notification-category.ts` (`"assigned"`)
- Test: `packages/views/notifications/notification-title.test.ts`, `kind-tone.test.ts`, `packages/views/settings/components/notifications-tab.test.tsx` (thêm case), `packages/core/api/endpoints/notifications.test.ts` (schema nhận kind mới)

**Interfaces:**
- Consumes: khoá i18n đã thêm ở Task 2.
- Produces: `"tasks_assigned"` là một `NotificationKind` hợp lệ.

- [ ] **Step 1: Viết test hỏng.**
  - `notification-title.test.ts`: một thông báo `{kind: "tasks_assigned", params: {actor: "An", count: "3"}, resource_type: "meeting"}` render ra `An đã giao bạn 3 việc`.
  - `kind-tone.test.ts`: tone của `tasks_assigned` bằng tone của `task_assigned`.
  - `notifications-tab.test.tsx`: ma trận có hàng `Được giao nhiều việc một lúc`, đẩy bật mặc định.
  - `notifications.test.ts`: phản hồi có kind `tasks_assigned` parse không rơi về fallback.

- [ ] **Step 2: Chạy, xác nhận hỏng**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/views exec vitest run notifications/notification-title.test.ts notifications/kind-tone.test.ts settings/components/notifications-tab.test.tsx --coverage.enabled=false`
Expected: FAIL.

- [ ] **Step 3: Thêm kind vào các bảng trên.** Typecheck sẽ chỉ ra mọi `Record<Kind, …>` còn thiếu.

- [ ] **Step 4: Chạy lại test (kể cả core) và typecheck**

Run:
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/core exec vitest run api/endpoints/notifications.test.ts --coverage.enabled=false`
- lệnh vitest ở Step 2
- `pnpm --filter @uniwork/core --filter @uniwork/views typecheck`

Expected: PASS.

- [ ] **Step 5: Commit** `feat(views): tasks_assigned notification kind` (body: một thông báo cho một lần giao nhiều việc).

### Task 4: Kiểm cuối và mở PR

- [ ] **Step 1:** `node --test scripts/governance.test.mjs` và `pnpm --filter @uniwork/core --filter @uniwork/views lint`. Lỗi lint có sẵn trên develop (ghi chú trong bộ nhớ dự án) thì báo là có sẵn, không sửa.
- [ ] **Step 2:** `cd server && gofmt -l ./internal/notification && go vet ./internal/notification/`.
- [ ] **Step 3:** Cập nhật dòng trạng thái của kế hoạch này thành `shipped` khi merge (không phải bây giờ). Mở PR bằng `make issue-pr KEY=UNI-1996`. Body PR có: thay đổi, lệnh đã chạy, "Đã bỏ qua: full suite — CI", và hai spec đi kèm.
