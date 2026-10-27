# Thùng rác chung — kế hoạch thực hiện

> **Trạng thái:** in-progress — chủ sản phẩm duyệt thiết kế 2026-10-26 và yêu cầu làm ngay; Task 1–5 xong trên nhánh `feature/UNI-2171-thung-rac-cho-task-va-du-an` (UNI-2171), kiểm tay trên app local 2026-10-27 (ba loại: lọc, khôi phục, xóa vĩnh viễn); chờ review cuối và PR.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một tab "Thùng rác" trong Cài đặt (mở từ menu avatar) liệt kê chung công việc, dự án và tài liệu đã xóa; bỏ hai trang và hai nút thùng rác riêng của Công việc, Dự án.

**Architecture:** Server thêm `TrashService.List` gộp ba nguồn sẵn có (thùng rác task, thùng rác dự án, danh sách tài liệu `Archived`) bằng con trỏ riêng cho từng nguồn, rồi một route `GET /api/v1/workspaces/{workspaceID}/trash`. Client thêm module `packages/core/trash` (endpoint, khoá, hook, realtime) và tab Cài đặt dựng lại bảng thùng rác; Khôi phục và Xóa vĩnh viễn dùng hook sẵn có của từng loại.

**Tech Stack:** Go (Chi, pgx, sqlc), Next.js, TanStack Query, i18next.

**Spec:** `docs/superpowers/specs/2026-10-26-ask-uni-full-actions-design.md` §8.1.1 (đọc cả mục "Người viết chốt").

## Global Constraints

- Chữ tiếng Việt dùng "Xóa" (ó); vi và en luôn đủ cặp khoá; mọi chữ trong `packages/views` qua `t()`.
- Giữ 30 ngày, tô đỏ khi còn ≤ 7 ngày; mục mới xóa đứng trên cùng; 50 dòng mỗi trang.
- Tài liệu: không đổi gì ở trang Tài liệu; dòng tài liệu là đúng những gì danh sách thùng rác tài liệu (`ListDocumentsInput{Archived: true}`) trả cho người đang xem; chỉ có khi cờ `documents` bật cho người đó.
- Quyền: task — mọi thành viên làm được; dự án — chỉ người tạo, người phụ trách, quản trị viên (đúng điều kiện `RestoreProject` đang dùng); tài liệu — mức `manage` hoặc `AdminScope` (như `canManageTrashed`).
- Không thêm sự kiện realtime; không thêm nút "Xóa hết", chọn nhiều dòng, số đếm.
- Luật repo: sqlc mỗi truy vấn có tham số tenant hoặc dòng `-- tenant:`; route qua `api` wrapper với SDI/SDO; client chỉ đọc mạng qua `parseWithFallback` và mỗi endpoint có test dữ liệu hỏng; file `.ts/.tsx` ≤ 500 dòng; knip sạch; isolation matrix phải qua với route mới.
- Không ghi "ClickUp" trong code, commit hay tài liệu.

## Review Focus

1. Nhiều mục của ba loại xóa cùng một giây: lật trang không lặp và không sót mục nào — test ở Task 2.
2. Tài liệu hạn chế mà người xem không đọc được thì không có dòng, không lộ tên — test ở Task 2.
3. Thành viên thường trên dòng dự án người khác tạo: hai lệnh bị khóa kèm lời giải thích, server trả `can_manage=false` — test ở Task 2 và Task 4.
4. Đổi bộ lọc thì về trang đầu; lọc ra rỗng thì thấy "Không có mục nào khớp" và nút "Bỏ lọc" — test ở Task 4.
5. Khôi phục hay xóa vĩnh viễn xong thì dòng biến mất, lỗi 409/422 báo đúng chữ đã có — test ở Task 4.

---

### Task 1: Lọc và vị trí cho ba nguồn thùng rác (server)

**Files:**
- Modify: `server/pkg/db/queries/task_trash.sql` (`ListTaskTrashPage`, `ListProjectTrashPage`), truy vấn danh sách tài liệu đã lưu trữ trong `server/pkg/db/queries/` (nhánh `archived` mà `listDocumentsPage` gọi), rồi `make sqlc`
- Modify: `server/internal/service/trash.go`, `task_trash.go`, `project_trash.go`, `document_search.go`
- Modify: `server/internal/handler/task_trash.go` (hai route cũ truyền bộ lọc rỗng)
- Test: `server/internal/service/task_trash_test.go`, `project_trash_test.go`, một test trong file test danh sách tài liệu lưu trữ sẵn có

**Interfaces:**
- Produces:
  - `type TrashFilter struct { Query, TrashedBy string }` trong `trash.go`; Query khớp tên không phân biệt hoa thường (chứa), TrashedBy là id người xóa; rỗng là không lọc.
  - `func (s *TaskService) ListTrash(ctx context.Context, actorID, workspaceID string, f TrashFilter, cursor string) (TrashPage[TaskTrashRow], error)`
  - `func (s *TaskService) ListProjectTrash(ctx context.Context, actorID, workspaceID string, f TrashFilter, cursor string) (TrashPage[ProjectTrashRow], error)`
  - `TaskTrashRow` thêm `ProjectID, ProjectTitle string` (dự án mà task trỏ tới lúc đọc, kể cả dự án đang ở thùng rác; rỗng khi không có).
  - `ProjectTrashRow` thêm `CanManage bool`: đúng điều kiện `RestoreProject` cho phép người gọi (người tạo, người phụ trách là người, quản trị viên workspace hoặc owner/admin tổ chức) — tách điều kiện đó ra một hàm dùng chung, không viết lại lần hai.
  - `ListDocumentsInput` thêm `ArchivedBy string`: chỉ có tác dụng khi `Archived`; lọc `archived_by = ArchivedBy`.

- [ ] **Step 1: Viết test hỏng**
  - `TestTaskTrashListFiltersByNameAndDeleter`: hai lô do A và B xóa ("Báo cáo Q3", "Kế hoạch"); `TrashFilter{Query: "báo cáo"}` chỉ trả "Báo cáo Q3"; `TrashFilter{TrashedBy: B}` chỉ trả lô của B; con trỏ trang sau vẫn giữ bộ lọc.
  - `TestTaskTrashRowNamesItsProject`: task trong dự án "Website mới" bị xóa → dòng có `ProjectTitle == "Website mới"`.
  - `TestProjectTrashCanManageFollowsRestoreRule`: dự án do A tạo, thành viên thường C đọc thấy `CanManage == false`, A thấy `true`, quản trị viên thấy `true`.
  - `TestArchivedDocumentsFilterByArchiver`: hai tài liệu do A và B lưu trữ; `ListDocuments(..., ListDocumentsInput{Archived: true, ArchivedBy: B})` chỉ trả của B.
- [ ] **Step 2:** `bash <gotest.sh> test ./internal/service -run 'TestTaskTrashListFiltersByNameAndDeleter|TestTaskTrashRowNamesItsProject|TestProjectTrashCanManageFollowsRestoreRule|TestArchivedDocumentsFilterByArchiver' -count=1` → FAIL (không biên dịch).
- [ ] **Step 3:** Thêm tham số sqlc kiểu nullable (`sqlc.narg`) cho tên và người xóa, join `projects` để lấy tiêu đề; sửa chữ ký service và các nơi gọi (handler hai route cũ, test cũ); `make sqlc`.
- [ ] **Step 4:** Chạy lại lệnh Step 2 → PASS; thêm `-run 'Trash'` cho hai gói service và handler → PASS.
- [ ] **Step 5: Commit** `feat(tasks): trash lists filter by name and deleter`.

### Task 2: API thùng rác chung (server)

**Files:**
- Create: `server/internal/service/trash_list.go`, `server/internal/service/trash_list_test.go`
- Create: `server/internal/handler/trash.go`, `server/internal/handler/trash_test.go`
- Create/Modify: `server/internal/handler/dto/sdi/trash.go`, `server/internal/handler/dto/sdo/trash.go`, `server/internal/handler/router/` (đăng ký route, nhóm workspace), nơi `handler.New` gắn service, `server/cmd/server/main.go`

**Interfaces:**
- Consumes: Task 1 (`ListTrash`, `ListProjectTrash`, `TrashFilter`, `ArchivedBy`, `CanManage`).
- Produces:
  - `type TrashKind string` với `TrashKindTask = "task"`, `TrashKindProject = "project"`, `TrashKindDocument = "document"`.
  - `type TrashItem struct { Kind TrashKind; ID, Title, Identifier string; SubKind string /* tài liệu: page|file|folder */; Count int /* task: số việc con trong lô; dự án: TaskCount */; LocationTitle string; LocationPath []string /* tài liệu: tên các thư mục cha */; TrashedBy string; TrashedAt, PurgeAfter time.Time; CanManage bool }`
  - `type ListTrashInput struct { Kind TrashKind /* rỗng là tất cả */; Filter TrashFilter; Cursor string }`
  - `func NewTrashService(tasks *TaskService, docs *DocumentService, ws *WorkspaceService, flags <kiểu cờ McpToolService đang dùng>) *TrashService`
  - `func (s *TrashService) List(ctx context.Context, actor Actor, workspaceID string, in ListTrashInput) (TrashPage[TrashItem], error)`
  - Route `GET /api/v1/workspaces/{workspaceID}/trash`, query `kind`, `q`, `trashed_by`, `cursor`; `kind` lạ → 400 `invalid_filter`; con trỏ hỏng → 400.
  - SDO `TrashPageSDO{ Items []TrashItemDTO "items"; NextCursor string "next_cursor" }`; `TrashItemDTO` các trường snake_case: `kind, id, title, identifier, sub_kind, count, location_title, location_path, trashed_by, trashed_at, purge_after, can_manage`.

- [ ] **Step 1: Viết test hỏng** (`trash_list_test.go`)
  - `TestTrashListMergesKindsNewestFirst`: một task, một dự án, một tài liệu xóa lần lượt → thứ tự trả về là ngược thời điểm xóa, mỗi dòng đúng `Kind`, task có `Identifier` và `LocationTitle` là tên dự án, dự án có `LocationTitle` là tên workspace, tài liệu có `LocationPath`.
  - `TestTrashListPagesAcrossKindsWithoutGapsOrRepeats`: 60 task, 30 dự án, 30 tài liệu, nhiều mục cùng `trashed_at` (đặt bằng SQL như các test hiện có) → đọc hết các trang, gộp id: đủ 120, không trùng, thứ tự không tăng theo (`TrashedAt`, khoá phụ).
  - `TestTrashListHidesDocumentsTheViewerCannotRead`: tài liệu hạn chế của A trong thùng rác; thành viên C không có quyền → không có dòng, tên không xuất hiện trong kết quả.
  - `TestTrashListLocksProjectsForPlainMembers`: dòng dự án của A đọc bởi C có `CanManage == false`; dòng task luôn `true`.
  - `TestTrashListKindAndFilters`: `Kind: TrashKindProject` chỉ trả dự án; `Filter.Query` và `Filter.TrashedBy` áp cho cả ba loại.
  - `TestTrashListSkipsDocumentsWhenTheFlagIsOff`: cờ `documents` tắt cho tổ chức → không dòng tài liệu, `Kind: document` trả trang rỗng.
  - Handler (`trash_test.go`): `TestTrashRouteAnswersTheSharedPage` (200, đúng trường JSON), `TestTrashRouteRejectsAnUnknownKind` (400 `invalid_filter`), người ngoài workspace → 404.
- [ ] **Step 2:** Chạy các test trên bằng `-run` → FAIL.
- [ ] **Step 3:** Cài `List`. Thuật toán (chữ ký và test không tự quyết điều này):
  - Con trỏ chung là JSON base64url `{"t": "<con trỏ task>", "p": "<con trỏ dự án>", "d": "<con trỏ tài liệu>", "x": ["task", ...]}` — `x` là nguồn đã hết.
  - Mỗi lần: đọc một trang (≤ 50) từ mỗi nguồn còn lại và đang được lọc vào, bằng con trỏ của nó; trộn theo (`TrashedAt` giảm, `Kind` theo thứ tự task < project < document, `ID` giảm); lấy 50 dòng đầu.
  - Với mỗi nguồn: nếu dòng cuối cùng được lấy của nguồn đó là dòng cuối trang nó trả → con trỏ mới là `NextCursor` của trang (rỗng thì thêm vào `x`); nếu chỉ lấy một phần → con trỏ mới trỏ ngay sau dòng cuối đã lấy (task/dự án: `encodeFeedCursor(TrashedAt, ID)`; tài liệu: con trỏ cùng định dạng mà danh sách tài liệu lưu trữ dùng, `(archived_at, id)`); không lấy dòng nào → giữ con trỏ cũ.
  - Hết `NextCursor` chung khi mọi nguồn đều ở `x` và không còn dòng thừa.
  - Thứ tự danh sách tài liệu lưu trữ phải là `archived_at` giảm, `id` giảm; nếu khác, đọc bằng `Sort` cho ra thứ tự đó.
  - Gọi qua ba service, không gọi thẳng truy vấn sqlc của chúng (spec: không ngoại lệ arch test).
- [ ] **Step 4:** Route, SDI/SDO có `description` và `example`, gắn trong `main.go`. Chạy test Step 1 → PASS; `go test ./internal/handler -run 'TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase' -timeout 90m -count=1` → PASS; `go vet`, `staticcheck` trên gói đã sửa.
- [ ] **Step 5: Commit** `feat(trash): one trash list for tasks, projects and documents`.

### Task 3: Module `packages/core/trash` (client)

**Files:**
- Create: `packages/core/api/endpoints/trash.ts` (+ `trash.test.ts`), `packages/core/trash/keys.ts`, `packages/core/trash/hooks.ts` (+ `hooks.test.tsx`), `packages/core/trash/index.ts` (+ export trong `packages/core/package.json` nếu các module khác khai báo ở đó)
- Modify: `packages/core/paths/paths.ts`, `packages/core/paths/consistency.test.ts` (bỏ `tasksTrash`, `projectsTrash`), `packages/core/tasks/hooks-trash.ts`, `hooks.ts`, `hooks-suite.ts`, `hooks-projects.ts`, `cache-coordinator.ts`, khoá task (bỏ `trash`, `projectTrash`), `packages/core/api/endpoints/tasks-trash.ts` (bỏ `listTaskTrash`, `listProjectTrash` và schema/kiểu chỉ chúng dùng), nơi xử lý sự kiện task/dự án/tài liệu trong `packages/core/realtime/`, `packages/core/realtime/reconnect-keys.ts`

**Interfaces:**
- Consumes: Task 2 (route và JSON).
- Produces:
  - `type TrashKind = "task" | "project" | "document"`; `interface TrashItem { kind: TrashKind; id: string; title: string; identifier: string; sub_kind: string; count: number; location_title: string; location_path: string[]; trashed_by: string; trashed_at: string; purge_after: string; can_manage: boolean }`; `interface TrashPage { items: TrashItem[]; next_cursor: string | null }`.
  - `listTrash(wsId: string, opts: { kind?: TrashKind; q?: string; trashedBy?: string; cursor?: string }): Promise<TrashPage>` — schema dễ dãi (`kind` là `z.string()`), dữ liệu hỏng trả trang rỗng.
  - `trashKeys = { all: ["trash"], workspace: (wsId) => ["trash", wsId], list: (wsId, filterKey: string) => ["trash", wsId, "list", filterKey] }`.
  - `useTrashList(wsId: string, filters: { kind?: TrashKind; q?: string; trashedBy?: string })` — infinite query, `filterKey` ghép từ ba bộ lọc.
  - Mọi `onSuccess` của `useRestoreTask`, `usePurgeTask`, `useRestoreProject`, `usePurgeProject`, `useDeleteTask`, `useBatchDeleteTasks`, `useDeleteProject` làm mới `trashKeys.workspace(wsId)` thay cho `taskKeys.trash/projectTrash`.
  - Sự kiện `task.trashed`, `task.restored`, `task.deleted`, `project.trashed`, `project.restored`, `project.deleted`, `document.archived`, `document.restored`, `document.deleted` làm mới `trashKeys.workspace(wsId)`; khi nối lại thì `trashKeys.workspace(wsId)` nằm trong danh sách làm mới.

- [ ] **Step 1: Viết test hỏng:** `listTrash` (đúng URL và query, dữ liệu hỏng → `{items: [], next_cursor: null}`); `useTrashList` lấy trang sau bằng `next_cursor`; `useRestoreTask` làm mới `trashKeys.workspace`; một frame `document.archived` làm mới `trashKeys.workspace`.
- [ ] **Step 2:** `pnpm --filter @uniwork/core exec vitest run api/endpoints/trash trash tasks realtime paths` → FAIL.
- [ ] **Step 3:** Cài; xóa các hàm, khoá, kiểu, builder không còn ai dùng.
- [ ] **Step 4:** Lệnh Step 2 → PASS; `pnpm --filter @uniwork/core exec tsc --noEmit` sạch (views còn lỗi tới Task 4 là bình thường; Task 4 sửa).
- [ ] **Step 5: Commit** `feat(trash): shared trash list and keys in core`.

### Task 4: Tab "Thùng rác" và menu avatar (views + web)

**Files:**
- Create: `packages/views/settings/components/trash-tab.tsx` (+ `trash-tab.test.tsx`), `packages/views/trash/trash-table.tsx` (thay `trash-list.tsx`), `packages/views/trash/trash-filters.tsx`, `packages/views/trash/use-trash-row-actions.ts`
- Modify: `packages/views/settings/components/settings-page.tsx` (thêm `{ value: "trash", label: "trash", icon: Trash, Panel: TrashTab, wide: true }` cuối nhóm `workspace`, không `gate`), `packages/views/layout/account-menu.tsx` (mục "Thùng rác", icon `Trash`, href `${ws.settings()}?tab=trash`, giữa Cài đặt và Đăng xuất), `packages/views/tasks/task-surface-page.tsx`, `packages/views/projects/projects-list-page.tsx` (bỏ `trashHref`/`TrashLink`), `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/page.tsx`, `.../projects/page.tsx`, `packages/core/i18n/locales/vi.json`, `en.json`
- Delete: `packages/views/trash/trash-link.tsx`, `trash-page.tsx`, `trash-list.tsx` (+ test, chuyển phần còn dùng sang `trash-table`), `packages/views/tasks/trash/`, `packages/views/projects/projects-trash-page.tsx` (+ test), `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/trash/`, `.../projects/trash/`

**Interfaces:**
- Consumes: Task 3 (`useTrashList`, `TrashItem`), các hook khôi phục/xóa vĩnh viễn sẵn có (`useRestoreTask`, `usePurgeTask`, `useRestoreProject`, `usePurgeProject`, `useRestoreDocument`, `usePurgeDocument`), `useTrashedByName`, `toastApiError`, `useFlag("documents")`, `useMembers`.
- Produces: `TrashTab` (Panel không prop, đọc workspace qua `useWorkspace()`).

Chữ (vi / en), đặt dưới `trash.*` và `settings.page.tabs.trash`, `nav.trash`:
- tab và menu: "Thùng rác" / "Trash"; câu đầu trang: "Mục đã xóa nằm ở đây 30 ngày, sau đó tự xóa vĩnh viễn." / "Deleted items stay here for 30 days, then are deleted forever."
- lọc: "Tìm theo tên…", "Loại", "Tất cả", "Công việc", "Dự án", "Tài liệu", "Người xóa", "Mọi người", "Tôi".
- cột: "Tên", "Vị trí", "Xóa lúc", "Người xóa", "Còn"; ô Còn: "{{count}} ngày".
- dòng phụ: task "Công việc · kèm {{count}} việc con" (count 0 thì chỉ "Công việc"); dự án "Dự án · {{count}} công việc sẽ gắn lại khi khôi phục" (0 thì "Dự án"); tài liệu theo `sub_kind`: "Trang", "Tệp", "Thư mục".
- trống: "Thùng rác trống"; lọc ra rỗng: "Không có mục nào khớp" + nút "Bỏ lọc".
- khóa: dự án "Chỉ người tạo, người phụ trách hoặc quản trị viên mới khôi phục hay xóa vĩnh viễn được dự án này."; tài liệu "Cần quyền quản lý tài liệu này."
- các chữ khôi phục, xóa vĩnh viễn, hộp hỏi lại, toast thành công và lỗi: dùng lại khoá `trash.*` đã có.

- [ ] **Step 1: Viết test hỏng** (`trash-tab.test.tsx`, mock transport như các test views khác):
  - hiện ba loại dòng với vị trí, người xóa, số ngày; ô Còn ≤ 7 ngày có `text-destructive`;
  - đổi Loại sang "Dự án" thì gọi `GET .../trash?kind=project` không có `cursor`;
  - lọc ra rỗng → "Không có mục nào khớp", bấm "Bỏ lọc" → gọi lại không bộ lọc;
  - dòng dự án `can_manage: false` → Khôi phục và Xóa vĩnh viễn `aria-disabled`, có lời giải thích;
  - Khôi phục dòng task gọi `POST /api/v1/tasks/{id}/restore` rồi dòng biến mất; 409 `duplicate_project_title` trên dòng dự án → toast đúng chữ đang có;
  - cờ `documents` tắt → không có lựa chọn "Tài liệu";
  - `account-menu` có mục "Thùng rác" trỏ `…/settings?tab=trash`; `settings-page` có tab `trash` trong nhóm Workspace.
- [ ] **Step 2:** `pnpm --filter @uniwork/views exec vitest run settings trash layout tasks projects` → FAIL.
- [ ] **Step 3:** Cài; tìm và lọc người xóa đi vào query (ô tìm trễ 250 ms như `use-documents-search.ts`); "Tải thêm" như bảng cũ; mỗi loại dùng hook khôi phục/xóa của nó và sau thành công làm mới `trashKeys.workspace(wsId)`.
- [ ] **Step 4:** Lệnh Step 2 → PASS; `pnpm --filter @uniwork/views exec tsc --noEmit`, `pnpm --filter @uniwork/web exec tsc --noEmit`, `pnpm knip`, eslint các file đã đụng → sạch; `pnpm --filter @uniwork/core exec vitest run i18n paths` → PASS.
- [ ] **Step 5: Commit** `feat(trash): trash tab in settings, opened from the avatar menu`.

### Task 5: Kiểm và tài liệu

**Files:**
- Modify: dòng trạng thái của kế hoạch này và của spec.

- [ ] **Step 1:** Kiểm tĩnh: gofmt, `go vet`, staticcheck trên gói đã đụng, `go build -o /dev/null ./cmd/server`; `pnpm typecheck`, `pnpm lint`, `pnpm knip`; `node --test scripts/events-catalogue.test.mjs`. Bộ test Go đầy đủ và E2E để CI chạy (chủ sản phẩm dặn).
- [ ] **Step 2:** Mở app local trong Chrome bằng tài khoản test local: xóa một task có việc con, một dự án có task, một tài liệu; mở menu avatar → Thùng rác; thấy ba dòng đúng thứ tự; lọc Loại, tìm tên, lọc người xóa; khôi phục từng loại; xóa vĩnh viễn từng loại (chỉ dữ liệu vừa tạo). Xác nhận trang Công việc và Dự án không còn nút "Thùng rác", trang Tài liệu vẫn có thùng rác của nó.
- [ ] **Step 3:** Cập nhật dòng trạng thái; **Commit** `docs: shared trash plan status`.

### Task 6: Lọc chọn nhiều và nút xóa ngay trong ô (chủ sản phẩm thêm 2026-10-27)

Spec §8.1.1 › Thanh lọc (bản 2026-10-27).

**Files:**
- Modify (server): `server/internal/handler/dto/sdi/trash.go` (`Kind []string`, `TrashedBy []string`, tham số lặp `?kind=task&kind=project`, như `type` của danh sách tài liệu), `server/internal/handler/trash.go`, `server/internal/service/trash.go` (`TrashFilter.TrashedBy []string`), `server/internal/service/trash_list.go` (`ListTrashInput.Kinds []TrashKind`), `server/pkg/db/queries/task_trash.sql` và truy vấn tài liệu đã xóa (`archived_by` thành mảng), `make sqlc`; test service và handler tương ứng.
- Modify (core): `packages/core/api/endpoints/trash.ts` (`listTrash(wsId, { kinds?: TrashKind[]; q?: string; trashedBy?: string[]; cursor?: string })`, lặp tham số, bỏ giá trị rỗng), `packages/core/trash/hooks.ts` (`TrashFilters { kinds?: TrashKind[]; q?: string; trashedBy?: string[] }`, khóa lọc dùng mảng đã sắp xếp), test.
- Modify (views): `packages/views/trash/trash-filters.tsx` (ô tìm có nút ×; hai chip chọn nhiều), `packages/views/settings/components/trash-tab.tsx`, `trash-tab.test.tsx`, `packages/core/i18n/locales/vi.json`, `en.json`.

**Quyết định:**
- Không chọn gì = không lọc. Giá trị lạ hoặc rỗng → 400 `invalid_filter`; quá 100 người xóa → 400 `invalid_filter`.
- Chip theo kiểu `PILL` / `PILL_ON` sẵn có (`packages/views/documents/documents-library-toolbar.tsx`); nút × là một nút riêng cạnh nút mở danh sách, nằm trong cùng viên chip, nhãn đọc được "Bỏ lọc Loại" / "Bỏ lọc Người xóa". Chip đã chọn cắt chữ dài bằng dấu …, tên đầy đủ trong `title`.
- Loại: menu ô đánh dấu (`DropdownMenuCheckboxItem`, như `CheckFilter` của báo cáo truy cập), có biểu tượng từng loại như cột Tên; Tài liệu ẩn khi cờ `documents` tắt.
- Người xóa: popover có ô tìm và danh sách ô đánh dấu: Tôi trước, rồi thành viên theo tên.
- Ô tìm: nút × hiện khi có chữ, bấm thì xóa chữ và trả focus về ô; không dựa vào nút × riêng của trình duyệt.
- Bỏ các mục "Tất cả" và "Mọi người".

- [ ] **Step 1:** Test hỏng: service `TestTrashListKindAndFilters` thêm hai loại cùng lúc và hai người xóa; handler nhận `?kind=task&kind=document&trashed_by=a&trashed_by=b` và từ chối `kind=label`; `listTrash` lặp tham số; `trash-tab.test.tsx`: chọn Công việc rồi Dự án → gọi `kind=task&kind=project` không cursor, chip ghi "Công việc, Dự án"; bấm × trên chip → gọi lại không `kind`; gõ tìm rồi bấm × trong ô → ô rỗng, gọi lại không `q`; chọn Tôi và một thành viên → hai `trashed_by`.
- [ ] **Step 2:** Chạy các test trên → FAIL.
- [ ] **Step 3:** Cài.
- [ ] **Step 4:** Test trên → PASS; vet, staticcheck, gofmt, `pnpm typecheck`, `pnpm knip`, eslint các file đã đụng sạch.
- [ ] **Step 5: Commit** `feat(trash): filter by several kinds and deleters, clear in place`.
