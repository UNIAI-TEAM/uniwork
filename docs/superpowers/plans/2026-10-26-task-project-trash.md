# Thùng rác cho task và dự án — Implementation Plan

> **Trạng thái:** in-progress — chờ chủ sản phẩm duyệt kế hoạch; spec đã duyệt 2026-10-26 (`docs/superpowers/specs/2026-10-26-ask-uni-full-actions-design.md` §8.1); issue: sub-issue của UNI-2170, tạo khi bắt đầu.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xoá task hay dự án chuyển vào thùng rác. Khôi phục được trong 30 ngày, rồi tự xoá vĩnh viễn. Task của một dự án nằm trong thùng rác vẫn sống, và trông như không thuộc dự án nào cho tới khi dự án được khôi phục.

**Architecture:**
- **Đánh dấu thay vì xoá hàng.** Mỗi task và mỗi dự án có cột thùng rác (`trashed_at`, `trashed_by`, `purge_after`). Task có thêm `trash_batch_id` và `trashed_project_id`.
- **Đọc:** mọi chỗ đọc bỏ qua hàng đã vào thùng rác.
- **Lệnh:**
  - Xoá chuyển cả cây task con vào một lô.
  - Khôi phục trả cả lô.
  - Xoá vĩnh viễn chạy đúng đường xoá hàng hôm nay.
- **Dự án vào thùng rác:**
  - Task của nó được gỡ liên kết thật, và nhớ dự án cũ ở `trashed_project_id`. Nhờ vậy không cần che `project_id` ở từng chỗ đọc.
  - Khôi phục thì nối lại.
- **Dọn rác:** một worker mỗi giờ xoá vĩnh viễn hàng quá hạn, theo mẫu `PurgeExpired` của tài liệu.

**Tech Stack:**
- Go: Chi, pgx, sqlc, `server/pkg/db/tablequery`.
- TypeScript, React 19, TanStack Query, zod; primitive `packages/ui`.

**Spec:** `docs/superpowers/specs/2026-10-26-ask-uni-full-actions-design.md` §8.1, §8.2 (chủ sản phẩm chốt: task của dự án trong thùng rác vẫn sống). Mẫu: thùng rác tài liệu, `server/internal/service/document_lifecycle.go`.

## Điều kiện trước khi làm

- Chủ sản phẩm duyệt kế hoạch này.
- **Nhánh:** cắt từ develop mới nhất, qua `make issue-sub PARENT=UNI-2170 TITLE="Thùng rác cho task và dự án"`, rồi `make issue-start KEY=<key mới>`. Một nhánh, một PR. Kế hoạch B (Hỏi UNI) dùng các lệnh ở đây cho tool xoá.
- `.env.worktree` đã có (`make worktree-env`).
- Không `make check`, không `go test ./...`, không sweep TS toàn bộ trước Task 9 (CI chạy).

## Quyết định khi viết kế hoạch

Mỗi mục ghi quyết định và cái giá nếu sai. Mục nào spec đã chốt thì ghi rõ.

- **T-R1 — Cột** (migration `999<unix-ms>_task_project_trash.up/.down.sql`, tiền tố lấy lúc viết):
  - `tasks`: `trashed_at TIMESTAMPTZ`, `trashed_by TEXT`, `purge_after TIMESTAMPTZ`, `trash_batch_id TEXT`, `trashed_project_id TEXT`.
  - `projects`: `trashed_at TIMESTAMPTZ`, `trashed_by TEXT`, `purge_after TIMESTAMPTZ`.
  - Không thêm cặp `_kind`: luật ADR 0007 chỉ áp cho `created_by`, và `documents.archived_by` cũng không có.
- **T-R2 — Index:** mỗi index một file, `CREATE INDEX CONCURRENTLY IF NOT EXISTS`:
  - `idx_tasks_trash_purge ON tasks (purge_after) WHERE trashed_at IS NOT NULL`
  - `idx_tasks_trash_list ON tasks (workspace_id, trashed_at DESC) WHERE trashed_at IS NOT NULL`
  - `idx_tasks_trash_batch ON tasks (workspace_id, trash_batch_id) WHERE trash_batch_id IS NOT NULL`
  - `idx_tasks_trashed_project ON tasks (trashed_project_id) WHERE trashed_project_id IS NOT NULL`
  - `idx_projects_trash_purge ON projects (purge_after) WHERE trashed_at IS NOT NULL`
  - `idx_projects_trash_list ON projects (workspace_id, trashed_at DESC) WHERE trashed_at IS NOT NULL`
- **T-R3 — Thời hạn:** `trashRetention = 30 * 24 * time.Hour` trong `server/internal/service/trash.go` (spec, người viết spec quyết, giống tài liệu).
- **T-R4 — Lô:**
  - Xoá một task gom chính nó và mọi task con chưa vào thùng rác (`ListDescendantTaskIDs`) vào một `trash_batch_id` mới. Tối đa `taskTrashMaxNodes = 1000`; vượt thì `CodedError{Code: "trash_too_large", Status: 422}`.
  - `BatchDeleteTasks` (tối đa 100 id như hôm nay) dùng **một** lô cho cả lần gọi. Nút "Hoàn tác" trên toast chỉ cần một lần khôi phục.
  - Khôi phục một task là khôi phục cả lô của nó.
  - Thành viên nào có task cha vẫn nằm trong thùng rác thì về gốc (`parent_task_id = NULL`), như tài liệu.
- **T-R5 — Sự kiện** (catalogue ba nơi, payload chỉ id, phạm vi workspace, làn realtime):
  - `task.trashed`, `task.restored` `{task_id, workspace_id}`;
  - `project.trashed`, `project.restored` `{project_id, workspace_id}`.
  - `task.deleted` và `project.deleted` từ nay **chỉ** phát khi xoá vĩnh viễn.
  - Một hàng một sự kiện, như tài liệu.
  - Gỡ hay nối lại liên kết task–dự án phát `task.updated` cho từng task, như `ClearTasksProjectID` hôm nay.
- **T-R6 — Audit:**
  - `task.trashed`, `task.restored`, `project.trashed`, `project.restored` là mới.
  - `task.deleted` và `project.deleted` giữ tên, nay chỉ cho xoá vĩnh viễn. Actor là người bấm, hoặc `audit.System("tasks.purge")` / `audit.System("projects.purge")` khi worker dọn.
- **T-R7 — Quyền:** giữ đúng như xoá hôm nay.
  - Task: thành viên workspace được xoá, khôi phục và xoá vĩnh viễn (`TaskService.authorize`).
  - Dự án: `authorizeProjectEdit` (người tạo, người phụ trách, quản trị viên workspace).
  - Cái giá: một thành viên vẫn xoá vĩnh viễn được task của người khác, như hôm nay họ xoá hẳn được.
- **T-R8 — Đọc** (danh sách đủ ở Task 2): mọi query đọc task hay dự án thêm `trashed_at IS NULL`.
  - `GetTask`, `GetTaskInWorkspace`, `GetProject` cũng lọc, nên mọi lệnh ghi đi qua `authorize` tự từ chối hàng đã vào thùng rác.
  - Lệnh khôi phục và xoá vĩnh viễn dùng biến thể mới `…IncludingTrashed`.
  - Ngoại lệ có chủ ý:
    - `CountTasksInOrganization` (hạn mức) **vẫn đếm** task trong thùng rác, để không xoá rồi khôi phục để lách hạn mức;
    - `ListAttachmentFileHolds` vẫn giữ file tới khi xoá vĩnh viễn;
    - `FileBackfillScanTaskDescriptionRefs` vẫn quét;
    - bản xuất dữ liệu tổ chức vẫn chứa hàng trong thùng rác.
- **T-R9 — Dự án vào thùng rác** (chủ sản phẩm chốt):
  - **Vào thùng rác:** `UPDATE tasks SET trashed_project_id = project_id, project_id = NULL, revision = revision + 1 WHERE project_id = $1 AND organization_id = $2 RETURNING id`.
  - **Khôi phục:** chỉ task còn `project_id IS NULL` được nối lại. Task đã được chuyển sang dự án khác giữ dự án mới. Mọi task bỏ `trashed_project_id`.
  - **Xoá vĩnh viễn:** bỏ `trashed_project_id`.
  - **Tài nguyên dự án, chế độ xem theo dự án, ghim dự án:**
    - Giữ nguyên khi vào thùng rác, xoá khi xoá vĩnh viễn, như `DeleteProject` hôm nay.
    - Trong lúc vào thùng rác, query danh sách ghim và chế độ xem bỏ qua những cái của dự án đó (join `projects` với `trashed_at IS NULL`).
- **T-R10 — Route:**
  - `DELETE /api/v1/tasks/{taskID}` và `POST /workspaces/{workspaceID}/tasks/batch-delete` giữ đường dẫn, đổi nghĩa thành chuyển vào thùng rác. Đáp thêm `batch_id`.
  - Mới:
    - `POST /api/v1/tasks/{taskID}/restore`, `POST /api/v1/tasks/{taskID}/purge`;
    - `GET /api/v1/workspaces/{workspaceID}/tasks/trash` (chỉ hàng gốc của mỗi lô, kèm `batch_size`; con trỏ keyset trên `trashed_at, id`; 50 hàng mỗi trang).
  - Dự án:
    - `DELETE /api/v1/workspaces/{workspaceID}/projects/{projectID}` đổi nghĩa thành vào thùng rác;
    - mới `POST …/projects/{projectID}/restore`, `POST …/projects/{projectID}/purge`, `GET /api/v1/workspaces/{workspaceID}/projects/trash`.
  - Không tham số đường dẫn mới, nên `pathParamSDI` không đổi.
- **T-R11 — MCP:** `TestMcpToolsCallNoDelete` (`server/internal/arch_test.go`) thêm `Trash` và `Purge` vào regex cấm. MCP không đổi bề mặt.
- **T-R12 — Giao diện:**
  - **Trang thùng rác:** route `/[orgSlug]/[workspaceSlug]/tasks/trash` và `/projects/trash`, với builder `paths…tasksTrash()` và `paths…projectsTrash()`. Mỗi trang có nút "Thùng rác" (icon `Trash`) trên header của trang Công việc và trang Dự án.
  - **Hộp xác nhận xoá:** đổi chữ thành "Chuyển vào thùng rác?" / "Có thể khôi phục trong 30 ngày."
  - **Toast sau khi xoá:** "Đã chuyển vào thùng rác", có nút "Hoàn tác".
  - **Xoá vĩnh viễn:** có hộp xác nhận riêng, ghi "Không hoàn tác được".

## Global Constraints

- **Luật `CLAUDE.md`:**
  - **Migration:** không FK; mỗi index `CONCURRENTLY` một file; tên `999<unix-ms>_…`.
  - **Query sqlc:** có tham số tenant hoặc dòng `-- tenant:`.
  - **Audit:** mỗi lệnh đổi trạng thái có audit cùng transaction, và một dòng trong `audit_coverage_test.go`.
  - **Sự kiện:** khai ở ba nơi, `scripts/events-catalogue.test.mjs` giữ.
  - **Route mới:** tự vào `TestIsolationMatrix`; route gắn id phải được phân loại trong `isolation_routes_test.go` nếu không tự suy được; trường `*_ids` trong body có case `isoReferences`.
  - **Endpoint client:** qua `parseWithFallback`, có test response hỏng.
  - **TS:** file `.ts/.tsx` ≤ 500 dòng; chuỗi qua `t()`; icon theo `docs/conventions.md` (Lucide nét 1.5, cỡ trên thang).
  - **Trang mới:** có builder trong `packages/core/paths` (`consistency.test.ts`).
- 30 ngày trong thùng rác. Lô xoá tối đa 1000 task. Xoá hàng loạt tối đa 100 id.
- Khôi phục trả đúng trạng thái trước khi xoá (spec §8.1). Không task nào mất theo dự án.
- Chữ cố định: "Thùng rác", "Chuyển vào thùng rác?", "Có thể khôi phục trong 30 ngày.", "Đã chuyển vào thùng rác", "Hoàn tác", "Khôi phục", "Xoá vĩnh viễn", "Không hoàn tác được".
- **Lệnh test:**
  - Go: `set -a && . ./.env.worktree && set +a && cd server && go test <pkg> -run '<regex>' -count=1`.
  - TS: `pnpm --filter @uniwork/<core|views> exec vitest run <file>`.

## Review Focus

1. **Khôi phục task con khi task cha vẫn trong thùng rác.** Task con trở thành task gốc, không trỏ tới cha đã mất. Test ở Task 3: `TestRestoreChildWhoseParentStaysTrashedBecomesRoot`.
2. **Dự án vào thùng rác, một task của nó được chuyển sang dự án khác, rồi dự án được khôi phục.** Task đã chuyển giữ dự án mới; task còn lại nối lại. Test ở Task 4: `TestRestoreProjectRelinksOnlyTasksStillUnlinked`.
3. **Worker dọn rác chạy đúng lúc người dùng bấm khôi phục.** Hàng bị khoá. Bên nào sau thấy hàng không còn hợp lệ thì bỏ qua: khôi phục nhận 404, hoặc worker không xoá. Test ở Task 5: `TestPurgeSkipsRowRestoredUnderLock`.
4. **Task trong thùng rác mở bằng đường dẫn trực tiếp, thông báo cũ, liên kết chat, tìm kiếm, `get_task` của Hỏi UNI hay MCP.** Đều trả không tìm thấy, không lộ tiêu đề. Test ở Task 2: `TestTrashedTaskIsHiddenFromEveryReader`.
5. **Xoá hàng loạt 100 id gồm cha và con.** Có một id không tồn tại thì cả lô thất bại, không hàng nào vào thùng rác. Lô thành công thì khôi phục một lần trả đủ. Test ở Task 3: `TestBatchTrashIsOneBatchAndRestoresTogether`.

## Bản đồ file

| File | Việc |
|---|---|
| `server/migrations/999<ms>_task_project_trash.*`, sáu file index | cột, index |
| `server/pkg/db/queries/task_trash.sql` (mới), `tasks.sql`, `projects.sql`, `calendar.sql`, `home.sql`, `notifications.sql`, `meeting_action_items.sql`, `chat_links.sql`, `document_sources.sql`, `task_properties.sql`, `task_collaboration.sql`, `graph_sources.sql`, `task_pins.sql`, `task_views.sql` | đọc bỏ qua thùng rác, query thùng rác |
| `server/pkg/db/tablequery/build.go` | `tenant()` thêm `trashed_at IS NULL` |
| `server/internal/service/trash.go` (mới) | hằng số, kiểu kết quả |
| `server/internal/service/task_trash.go` (mới), `task.go`, `task_mutations.go` | xoá vào thùng rác, khôi phục, xoá vĩnh viễn, danh sách |
| `server/internal/service/project_trash.go` (mới), `project.go` | như trên cho dự án |
| `server/internal/service/trash_worker.go` (mới), `server/cmd/server/main.go` | worker dọn rác |
| `server/internal/audit/actions.go`, `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`, `server/internal/graph/projector/refs.go` | action, sự kiện |
| `server/internal/handler/task_trash.go` (mới), `task.go`, `task_mutations.go`, `project.go`, `router/tasks.go`, `router.go`, `router/routes.go`, `dto/sdi/task.go`, `dto/sdo/task.go` | API |
| `server/internal/handler/isolation_routes_test.go`, `isolation_references_test.go`, `server/internal/service/audit_coverage_test.go`, `server/internal/arch_test.go` | luật giữ |
| `packages/core/api/endpoints/tasks.ts`, `tasks-suite.ts`, `projects.ts`, `tasks-trash.ts` (mới), `packages/core/tasks/hooks.ts`, `hooks-suite.ts`, `hooks-projects.ts`, `hooks-trash.ts` (mới), `cache-coordinator.ts`, `packages/core/realtime/use-realtime-sync.ts`, `should-invalidate-calendar.ts`, `packages/core/paths/paths.ts` | client |
| `packages/views/trash/trash-list.tsx` (mới), `packages/views/tasks/trash/tasks-trash-page.tsx` (mới), `packages/views/projects/projects-trash-page.tsx` (mới), các file hộp xoá, `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/trash/page.tsx`, `projects/trash/page.tsx` | giao diện |
| `packages/core/i18n/locales/{vi,en}.json` | chữ |

---

### Task 1: Migration, query thùng rác, action audit, sự kiện

**Files:**
- Create: migration T-R1, sáu file index T-R2, `server/pkg/db/queries/task_trash.sql`
- Modify: `server/internal/audit/actions.go`, `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`, `server/internal/graph/projector/refs.go`
- Test: `server/migrations/lint_test.go`, `server/migrations/query_scope_test.go`, `scripts/events-catalogue.test.mjs`

**Interfaces:**
- **Produces, sqlc (`make sqlc`), tham số gồm `organization_id` và `workspace_id`:**
  - Task:
    - `TrashTasks(ids []string, trashedBy, batchID string, purgeAfter time) []string`
    - `ListTaskTrashBatch(batchID) []Task`
    - `RestoreTaskBatch(batchID) []string`
    - `GetTaskIncludingTrashed(id) Task`
    - `ListTaskTrashPage(workspaceID, beforeTrashedAt, beforeID, limit)`, chỉ hàng gốc của lô, có `batch_size`
    - `ListTasksForPurge(now, afterPurgeAfter, afterID, limit)`, với `-- tenant: system`
    - `LockTaskForPurge(id)`
    - `UnparentRestoredOrphans(batchID)`
  - Dự án:
    - `TrashProject(id, trashedBy, purgeAfter)`
    - `RestoreProject(id)`
    - `GetProjectIncludingTrashed(id)`
    - `ListProjectTrashPage(…)`
    - `ListProjectsForPurge(…)`
    - `UnlinkTasksForProjectTrash(projectID) []string`
    - `RelinkTasksForProjectRestore(projectID) []string`
    - `ClearTrashedProjectLinks(projectID)`
- **Produces, audit:** `audit.ActionTaskTrashed`, `ActionTaskRestored`, `ActionProjectTrashed`, `ActionProjectRestored`. `ActionTaskDeleted` và `ActionProjectDeleted` giữ nguyên.
- **Produces, sự kiện:** `task.trashed`, `task.restored`, `project.trashed`, `project.restored` (T-R5). `refs.go` coi bốn sự kiện mới là "đánh dấu node bẩn" để projector đọc lại nguồn.

- [ ] **Step 1:** Viết migration, index và query theo T-R1, T-R2. Chạy `make sqlc`.
- [ ] **Step 2:** Khai báo bốn action và bốn sự kiện ở ba nơi. Thêm bốn sự kiện vào `refs.go`.
- [ ] **Step 3:** Chạy `go test ./migrations -run 'TestMigration|TestEveryQueryNamesItsTenant' -count=1` và `node --test scripts/events-catalogue.test.mjs`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(tasks): trash columns, queries, audit actions and events`.

### Task 2: Mọi chỗ đọc bỏ qua task và dự án trong thùng rác

**Files:**
- Modify:
  - Query trong `tasks.sql`: `ListTasksByWorkspace`, `GetTask`, `GetTaskInWorkspace`, `GetWelcomeTask`, `QueryTasks`, `CountTasks`, `CountOpenTasksByAssignee`, `ListTasksByIdentifier`, `GetTaskInWorkspaceByIdentifier`, `ListMyTasks`, `CountMyTasks`, `ListChildTasks`, `ListChildrenByParents`, `ChildTaskProgress`, `FindActiveDuplicateTask`.
  - Query trong các file khác:
    - `calendar.sql` (5 query), `home.sql` (`ListHomeMyWork`, `CountHomeMyWork`);
    - `notifications.sql` (`ListExistingTaskIDs`, `ListMeetingsWithPendingItems`, `ListMeetingTasksDue`);
    - `meeting_action_items.sql` (các query join `tasks`);
    - `chat_links.sql` (`ListChatRoomLinkedTasks`), `document_sources.sql` (`ListDocumentSourceTaskFiles`), `task_properties.sql` (`ListTaskProperties`), `task_collaboration.sql` (`ListTaskSubscribers`);
    - `graph_sources.sql` (bốn query).
  - `projects.sql`: `ListProjects`, `SearchProjects`, `CountSearchProjects`, `GetProject`, `ListProjectTitlesForDuplicateCheck`, `GetProjectTaskStats` (bỏ task trong thùng rác).
  - `task_pins.sql`, `task_views.sql`: danh sách bỏ ghim và chế độ xem của dự án trong thùng rác.
  - `server/pkg/db/tablequery/build.go`: `tenant(alias)`.
- Test: `server/internal/service/task_trash_read_test.go` (mới), `server/pkg/db/tablequery/build_test.go`

**Interfaces:**
- Consumes: cột Task 1.
- Produces: `GetTask`, `GetTaskInWorkspace`, `GetProject` không trả hàng đã vào thùng rác. Mọi lệnh ghi đi qua `authorize` hay `authorizeProjectEdit` tự trả `ErrNotFound` cho hàng đó.

- [ ] **Step 1: Viết test hỏng** `TestTrashedTaskIsHiddenFromEveryReader`.
  - Tạo task bằng service, rồi đặt `trashed_at` bằng SQL trực tiếp.
  - Kiểm rằng mỗi đường đọc sau không thấy nó:
    - `Tasks.Get` trả `ErrNotFound`;
    - `Tasks.List`, `QueryTasks`, `ListMyTasks`;
    - bảng (`TaskTableService` rows và groups);
    - lịch, trang chủ;
    - `ListExistingTaskIDs` không chứa id;
    - `ListChildTasks` của cha;
    - đếm việc theo người (`CountOpenTasksByAssignee`);
    - `McpToolService.Search` và `GetTask`.
  - Thêm `TestTrashedProjectIsHiddenFromEveryReader` cho `GetProject`, `ListProjects`, `SearchProjects`, ghim và chế độ xem của dự án.
  - Thêm `TestTrashedTasksStillCountForQuota`: `CountTasksInOrganization` vẫn đếm.
- [ ] **Step 2: Chạy** `go test ./internal/service -run 'TestTrashed' -count=1`. Expected: FAIL.
- [ ] **Step 3:** Thêm `trashed_at IS NULL` vào từng query ở danh sách Files và vào `tenant()`. Chạy `make sqlc`.
- [ ] **Step 4: Chạy** `go test ./internal/service -run 'TestTrashed|TestTask|TestProject|TestCalendar|TestHome|TestTaskTable' -count=1` và `go test ./pkg/db/tablequery -count=1`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): readers skip trashed tasks and projects`.

### Task 3: Lệnh thùng rác cho task

**Files:**
- Create: `server/internal/service/trash.go`, `server/internal/service/task_trash.go`, `server/internal/service/task_trash_test.go`
- Modify: `server/internal/service/task.go` (`Delete` thành chuyển vào thùng rác; tách phần xoá hàng của `deleteTaskInTx` thành `purgeTaskInTx`), `server/internal/service/task_mutations.go` (`BatchDeleteTasks`), `server/internal/service/audit_coverage_test.go`
- Test: `task_trash_test.go`; sửa `task_test.go:215-235` và `task_mutations_test.go:114-135` theo nghĩa mới

**Interfaces:**
- **Produces, `trash.go`:**
  - `const trashRetention = 30 * 24 * time.Hour`
  - `const taskTrashMaxNodes = 1000`
  - `type TrashResult struct { BatchID string; IDs []string }`
  - `type TrashPage[T any] struct { Items []T; NextCursor string }`
  - `type TaskTrashRow struct { ID, Identifier, Title, TrashedBy string; TrashedAt, PurgeAfter time.Time; BatchSize int }`; `ProjectTrashRow` tương tự, với `TaskCount` thay cho `BatchSize`
- **Produces, `TaskService`:**
  - `Trash(ctx, actor Actor, taskID string) (TrashResult, error)`; `Delete` gọi hàm này.
  - `TrashMany(ctx, actor Actor, workspaceID string, ids []string) (TrashResult, error)`; `BatchDeleteTasks` gọi hàm này.
  - `Restore(ctx, actor Actor, taskID string) (TrashResult, error)`
  - `Purge(ctx, actor Actor, taskID string) error`
  - `ListTrash(ctx, actorID, workspaceID string, cursor string) (TrashPage[TaskTrashRow], error)`
  - `purgeTaskInTx(ctx, q *db.Queries, task db.Task, actor audit.Actor) error`: đúng các bước của `deleteTaskInTx` hôm nay. Task 5 dùng nó.
- `Actor` là `service.Actor` hiện có (ADR 0007).

- [ ] **Step 1: Viết test hỏng:**
  - `TestTrashTaskMovesItsSubtreeInOneBatch`: cha và hai con có chung `trash_batch_id` và `purge_after` bằng now + 30 ngày. Ba audit `task.trashed`, ba sự kiện `task.trashed`. `Get` trả `ErrNotFound`.
  - `TestRestoreTaskRestoresTheWholeBatch`.
  - `TestRestoreChildWhoseParentStaysTrashedBecomesRoot` (Review Focus 1).
  - `TestBatchTrashIsOneBatchAndRestoresTogether` (Review Focus 5): một id lạ làm cả lô thất bại, không hàng nào vào thùng rác.
  - `TestTrashTooLargeIsRefused`: cây 1001 task trả `trash_too_large`.
  - `TestPurgeTaskDeletesTheRow`: chỉ được xoá vĩnh viễn task đã trong thùng rác, task đang sống trả `ErrNotFound`. Audit và sự kiện `task.deleted`. File đính kèm được nhả.
  - `TestTrashListShowsBatchRootsWithSize`.
  - `TestTrashedTaskRefusesWrites`: `Update` trên task trong thùng rác trả `ErrNotFound`.
- [ ] **Step 2: Chạy** `go test ./internal/service -run 'TestTrash|TestRestore|TestBatchTrash|TestPurgeTask' -count=1`. Expected: FAIL.
- [ ] **Step 3:** Cài các hàm ở Interfaces theo T-R4–T-R8. Thêm dòng cho `ActionTaskTrashed` và `ActionTaskRestored` vào `audit_coverage_test.go` (map closure và `auditActions()`). Closure `ActionTaskDeleted` đổi sang `Purge`.
- [ ] **Step 4: Chạy** `go test ./internal/service -run 'TestTrash|TestRestore|TestBatchTrash|TestPurgeTask|TestTask|TestBatchDelete|TestEveryAuditedCommandWritesItsRow' -count=1`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): deleting a task moves it and its subtasks to the trash`.

### Task 4: Lệnh thùng rác cho dự án

**Files:**
- Create: `server/internal/service/project_trash.go`, `server/internal/service/project_trash_test.go`
- Modify: `server/internal/service/project.go` (`DeleteProject` thành vào thùng rác; tách phần xoá hàng thành `purgeProjectInTx`), `server/internal/service/audit_coverage_test.go`; sửa `project_test.go:210-232` theo nghĩa mới
- Test: `project_trash_test.go`

**Interfaces:**
- **Produces, `TaskService`:**
  - `TrashProject(ctx, actor Actor, workspaceID, projectID string) error`; `DeleteProject` gọi hàm này.
  - `RestoreProject(ctx, actor Actor, workspaceID, projectID string) error`
  - `PurgeProject(ctx, actor Actor, workspaceID, projectID string) error`
  - `ListProjectTrash(ctx, actorID, workspaceID, cursor string) (TrashPage[ProjectTrashRow], error)`
  - `purgeProjectInTx(ctx, q *db.Queries, p db.Project, actor audit.Actor) error`: các bước của `DeleteProject` hôm nay, trừ `ClearTasksProjectID`, thay bằng `ClearTrashedProjectLinks`. Task 5 dùng nó.

- [ ] **Step 1: Viết test hỏng:**
  - `TestTrashProjectUnlinksItsTasks`: task có `project_id` NULL và `trashed_project_id` bằng dự án. Mỗi task có một audit và một sự kiện `task.updated`. Dự án có `project.trashed`.
  - `TestRestoreProjectRelinksOnlyTasksStillUnlinked` (Review Focus 2).
  - `TestTrashedProjectKeepsViewsAndPinsHidden`: khôi phục thì ghim và chế độ xem hiện lại.
  - `TestPurgeProjectDeletesResourcesViewsPinsAndClearsLinks`.
  - `TestTrashProjectNeedsEditRights`: thành viên thường không phải người tạo hay người phụ trách nhận `ErrForbidden`.
- [ ] **Step 2: Chạy** `go test ./internal/service -run 'TestTrashProject|TestRestoreProject|TestPurgeProject|TestTrashedProject' -count=1`. Expected: FAIL.
- [ ] **Step 3:** Cài theo T-R6, T-R7, T-R9. Thêm dòng audit coverage cho `ActionProjectTrashed` và `ActionProjectRestored`. Closure `ActionProjectDeleted` đổi sang `PurgeProject`.
- [ ] **Step 4: Chạy** `go test ./internal/service -run 'TestTrashProject|TestRestoreProject|TestPurgeProject|TestTrashedProject|TestProject|TestEveryAuditedCommandWritesItsRow' -count=1`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(projects): deleting a project moves it to the trash and keeps its tasks`.

### Task 5: Worker dọn rác

**Files:**
- Create: `server/internal/service/trash_worker.go`, `server/internal/service/trash_worker_test.go`
- Modify: `server/cmd/server/main.go` (khởi động cạnh `NewDocumentWorkers`, gọi `Run(runCtx)`, và đợi ở bước tắt như `DocumentWorkers`)

**Interfaces:**
- **Consumes:** `purgeTaskInTx`, `purgeProjectInTx`, `ListTasksForPurge`, `ListProjectsForPurge`, `LockTaskForPurge`.
- **Produces:**
  - `type TrashWorker struct`
  - `NewTrashWorker(pool, q, tasks *TaskService, now func() time.Time) *TrashWorker`
  - `(*TrashWorker).Run(ctx)`: nhịp 1 giờ, như `documentPurgeTick`.
  - `(*TrashWorker).PurgeExpired(ctx) (tasks, projects int, err error)`: phân trang keyset `(purge_after, id)`, mỗi hàng một transaction. Sau khi khoá hàng thì kiểm lại `trashed_at IS NOT NULL AND purge_after < now`.

- [ ] **Step 1: Viết test hỏng:**
  - `TestPurgeExpiredRemovesOnlyRowsPastTheirDate`.
  - `TestPurgeSkipsRowRestoredUnderLock` (Review Focus 3): khôi phục chạy giữa lúc đọc trang và lúc khoá.
  - `TestPurgeUsesTheSystemActor`.
- [ ] **Step 2: Chạy** `go test ./internal/service -run 'TestPurgeExpired|TestPurgeSkips|TestPurgeUsesTheSystemActor' -count=1`. Expected: FAIL.
- [ ] **Step 3:** Cài theo Interfaces, rồi nối vào `main.go`.
- [ ] **Step 4: Chạy** lệnh ở Step 2 và `go build ./cmd/server`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): hourly sweep purges trash past 30 days`.

### Task 6: API, isolation, luật MCP

**Files:**
- Create: `server/internal/handler/task_trash.go`
- Modify:
  - `server/internal/handler/task.go`, `task_mutations.go`, `project.go`;
  - `server/internal/handler/router/tasks.go`, `router.go`, `router/routes.go`;
  - `dto/sdi/task.go`, `dto/sdo/task.go`;
  - `isolation_routes_test.go`, `isolation_references_test.go`;
  - `server/internal/arch_test.go` (T-R11).
- Test: `server/internal/handler/task_trash_test.go` (mới)

**Interfaces:**
- **Produces (T-R10):**
  - Sáu route mới và hai route đổi nghĩa.
  - SDO `TaskTrashSDO {trash_batch_id, ids}` cho xoá và khôi phục, `TaskTrashPageSDO {items[{id, identifier, title, trashed_at, trashed_by, purge_after, batch_size}], next_cursor}`.
  - SDO cho dự án tương tự, `{id, title, trashed_at, trashed_by, purge_after, task_count}`.
  - Batch-delete đáp `{deleted, trash_batch_id}`.

- [ ] **Step 1: Viết test hỏng** `TestTaskTrashRoutes`: xoá trả 200 và `trash_batch_id`; GET thùng rác thấy nó; khôi phục trả 200; xoá lại rồi xoá vĩnh viễn trả 200; GET task trả 404. Thêm `TestProjectTrashRoutes` tương tự.
- [ ] **Step 2: Chạy** `go test ./internal/handler -run 'TestTaskTrashRoutes|TestProjectTrashRoutes' -count=1`. Expected: FAIL.
- [ ] **Step 3:** Cài handler, route và DTO. Có `description` và `example` theo `docs/api-sdi-sdo.md`.
- [ ] **Step 4:** Phân loại route mới trong `isolation_routes_test.go` theo mẫu route task và dự án hiện có. Mở rộng regex `TestMcpToolsCallNoDelete`.
- [ ] **Step 5: Chạy** `go test ./internal/handler -run 'TestTaskTrashRoutes|TestProjectTrashRoutes|TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase' -count=1` và `go test ./internal -run 'TestMcpToolsCallNoDelete' -count=1`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(tasks): trash, restore and purge routes`.

### Task 7: Client core — endpoint, hook, sự kiện, đường dẫn

**Files:**
- Create: `packages/core/api/endpoints/tasks-trash.ts` (+ `.test.ts`), `packages/core/tasks/hooks-trash.ts` (+ `.test.tsx`)
- Modify:
  - Endpoint: `tasks.ts`, `tasks-suite.ts`, `projects.ts`, mỗi lệnh xoá đáp thêm `trash_batch_id`.
  - Cache và realtime: `packages/core/tasks/cache-coordinator.ts`, `packages/core/realtime/use-realtime-sync.ts`, `should-invalidate-calendar.ts`, `meeting-follow-through-events.ts`.
  - `packages/core/paths/paths.ts`: `tasksTrash()`, `projectsTrash()`.
- Test: các test hiện có của những file trên

**Interfaces:**
- **Produces, endpoint:** `listTaskTrash(wsId, cursor?)`, `restoreTask(taskId)`, `purgeTask(taskId)`, `listProjectTrash(wsId, cursor?)`, `restoreProject(wsId, projectId)`, `purgeProject(wsId, projectId)`.
- **Produces, hook:** `useTaskTrash(wsId)`, `useRestoreTask(wsId)`, `usePurgeTask(wsId)`, `useProjectTrash(wsId)`, `useRestoreProject(wsId)`, `usePurgeProject(wsId)`.
- **Produces, query key:** `taskKeys.trash(wsId)`, `taskKeys.projectTrash(wsId)`.
- **Hành vi realtime:**
  - `task.trashed` làm mất hiệu lực như `task.deleted`, thêm `taskKeys.trash`.
  - `task.restored` làm mất hiệu lực như `task.created`, thêm `taskKeys.trash`.
  - Dự án tương tự.

- [ ] **Step 1: Viết test hỏng:**
  - endpoint, mỗi hàm có một case response hỏng;
  - `useRestoreTask` làm mất hiệu lực danh sách và thùng rác;
  - `use-realtime-sync.test.tsx`: `task.trashed` làm mất hiệu lực đúng các key;
  - `paths.test.ts`: hai builder mới.
- [ ] **Step 2: Chạy** `pnpm --filter @uniwork/core exec vitest run api/endpoints/tasks-trash.test.ts tasks/hooks-trash.test.tsx realtime/use-realtime-sync.test.tsx paths/paths.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Cài theo Interfaces.
- [ ] **Step 4: Chạy** lại lệnh ở Step 2, thêm `tasks/cache-coordinator.test.ts api/endpoints/tasks.test.ts api/endpoints/tasks-suite.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): trash endpoints, hooks and realtime events in core`.

### Task 8: Giao diện — hộp xoá, toast hoàn tác, trang thùng rác

**Files:**
- Create:
  - `packages/views/trash/trash-list.tsx` (+ test): danh sách thuần, gồm tiêu đề, "Xoá bởi … lúc …", "Tự xoá vĩnh viễn sau N ngày", "Khôi phục", và "Xoá vĩnh viễn" có hộp xác nhận "Không hoàn tác được".
  - `packages/views/tasks/trash/tasks-trash-page.tsx` (+ test), `packages/views/projects/projects-trash-page.tsx` (+ test).
  - `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/trash/page.tsx`, `projects/trash/page.tsx`.
- Modify:
  - Hộp xoá: `task-detail-header-actions.tsx`, `batch-action-toolbar.tsx`, `project-row-actions.tsx`, `projects-list-page.tsx`.
  - Nút "Thùng rác": header của trang Công việc và trang Dự án.
  - `packages/core/i18n/locales/{vi,en}.json`.
- Test: test hiện có của các file trên

**Interfaces:**
- Consumes: hook Task 7, `paths…tasksTrash()`, `paths…projectsTrash()`.
- Produces: `TrashList` props `{ items: TrashItem[]; onRestore(id); onPurge(id); kind: "task" | "project" }`, với `TrashItem {id, title, subtitle?, trashedAt, trashedByName, purgeAfter, extraCount}`.

- [ ] **Step 1: Viết test hỏng:**
  - Hộp xoá task hiện "Chuyển vào thùng rác?" và "Có thể khôi phục trong 30 ngày."
  - Sau khi xoá, toast "Đã chuyển vào thùng rác" có nút "Hoàn tác", bấm thì gọi `restoreTask` với id vừa xoá.
  - Xoá hàng loạt: "Hoàn tác" gọi khôi phục một lần.
  - Trang thùng rác hiện hàng và số task con; "Xoá vĩnh viễn" mở hộp có "Không hoàn tác được".
  - Trang Công việc có nút "Thùng rác" dẫn tới `tasksTrash()`.
- [ ] **Step 2: Chạy** `pnpm --filter @uniwork/views exec vitest run trash tasks/trash projects/projects-trash-page.test.tsx tasks/views/batch-action-toolbar.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Cài theo Interfaces và T-R12. Dùng `CollectionPageHeader` và `CollectionPageState` cho trang thùng rác, như mọi trang danh sách. Thêm chữ cố định ở Global Constraints vào vi và en.
- [ ] **Step 4: Chạy** lại lệnh ở Step 2, thêm `pnpm --filter @uniwork/core exec vitest run i18n/parity.test.ts paths/consistency.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tasks): trash pages and undo after delete`.

### Task 9: Kiểm toàn bộ và tài liệu

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-ask-uni-full-actions-design.md` (dòng trạng thái ghi kế hoạch này), kế hoạch này (trạng thái)

- [ ] **Step 1:** Chạy:
  - `pnpm typecheck`, `pnpm lint`, `pnpm knip`;
  - `pnpm --filter @uniwork/core exec vitest run`, `pnpm --filter @uniwork/views exec vitest run tasks projects trash my-tasks`;
  - `set -a && . ./.env.worktree && set +a && cd server && go vet ./... && go test ./internal/service ./internal/handler ./pkg/db/tablequery ./migrations -count=1`.

  Expected: PASS. Ba test phím tắt tài liệu đã đỏ sẵn trên macOS không tính.
- [ ] **Step 2:** Mở app từ worktree, xoá một task có task con, xem thùng rác, khôi phục, xoá vĩnh viễn. Làm tương tự với một dự án có task. Ghi kết quả vào PR.
- [ ] **Step 3:** Cập nhật dòng trạng thái của spec và kế hoạch. **Commit** `docs: trash plan status`.
