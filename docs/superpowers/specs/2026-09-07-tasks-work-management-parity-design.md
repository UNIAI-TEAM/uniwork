# UniWork — Tasks Work Management parity

> **Trạng thái:** in-progress — thiết kế được duyệt ngày 2026-09-07; lát cắt 1 (UNI-495) foundation shipped; lát cắt 2 (UNI-497) API + client core shipped; lát cắt 3 (UNI-500) collection surfaces shipped; lát cắt 4 (UNI-502) Projects suite shipped (`2026-09-08-projects-suite-design.md`); lát cắt 5 (UNI-505) Task detail & collaboration shipped (`2026-09-09-task-detail-collaboration-design.md`); lát cắt 6 Agent/integration surfaces đang thiết kế (`2026-09-09-agent-integration-surfaces-design.md`); còn lát cắt 7–8 (hosts / cutover). UNI-426 / F-05 vẫn `MỘT PHẦN` — không đánh dấu F-05 xong.

**Ngày:** 2026-09-07
**Issue:** UNI-426 · F-05
**Nguồn tham chiếu:** checkout `multica/`, commit cố định `3d37828e9`
**Thay thế:** `2026-09-04-tasks-complete-design.md`

## 1. Mục tiêu

Clone đầy đủ nhóm chức năng Work Management của nguồn tham chiếu vào UniWork. Bản
clone giữ UI, interaction, behavior, trạng thái lỗi và cấu trúc module gần nguồn
nhất có thể; phần đổi khác chỉ phục vụ tên miền UniWork và các bất biến kiến trúc
đang được repo ép bằng test/lint.

UniWork tiếp tục gọi đơn vị công việc lâu dài là **Task / Công việc** và giữ route
`/tasks`. Khái niệm task thực thi của agent trong nguồn được đổi thành **AgentRun /
Lượt chạy** để không xung đột tên. Không tạo domain `Issue` song song và không giữ
hai implementation sau cutover.

Phạm vi lớn hơn một Task page. Deliverable là một Work Management suite gồm Tasks,
My Tasks, Projects, saved views, catalogs trong Settings, Inbox integration, entry
points từ shell/search và các surface web, desktop, mobile.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Baseline | Commit `3d37828e9`; thay đổi nguồn sau commit này là đợt đồng bộ riêng. |
| Cách port | Source transplant có kiểm soát: copy source/test, đổi tên cơ học, nối bằng adapter. |
| Tên miền | `Issue → Task`, `Agent Task → AgentRun`; không tồn tại compatibility layer `Issue`. |
| URL | Giữ `/tasks`; `My Issues → /my-tasks`; Projects giữ `/projects`. |
| UI | Copy UI và interaction; không thiết kế lại theo Tasks MVP hiện tại. |
| Dữ liệu | Migration in-place; giữ ULID, task/comment hiện hữu, attribution, audit và liên kết. |
| Rollout | Xây song song sau feature flag; cutover một lần khi lõi parity hoàn chỉnh. |
| Capability thiếu | Vẫn hiện đúng vị trí, disabled, ghi rõ “Chưa khả dụng”; không giả lập thành công. |
| Branding | Không còn tên, package scope, persisted key, header hoặc UI copy của nguồn trong target code. |
| Agent writes | Giữ bất biến UniWork: proposal → human confirm → service; không ghi bảng nghiệp vụ trực tiếp. |

## 3. Ánh xạ tên bắt buộc

| Nguồn | UniWork |
| --- | --- |
| Issue / Issues | Task / Tasks |
| Agent Task | AgentRun |
| Issue Status | Task Status |
| Issue View | Task View |
| Issue Property | Task Property |
| issue identifier | task identifier |
| issue subscriber | task subscriber |
| issue source context | task source context |
| package scope nguồn | `@uniwork/*` |
| `/issues/*` | `/tasks/*` |
| `/my-issues` | `/my-tasks` |
| `issue.*` domain event | `task.*` domain event |
| persisted key nguồn | `uniwork_*` key tương ứng |

Mọi symbol, DTO, SDI/SDO, query, event, i18n key và test assertion được đổi theo
bảng này. Tên nguồn chỉ được phép xuất hiện trong tài liệu provenance như tài liệu
này và parity manifest; không xuất hiện trong production code, tests, API headers,
storage keys hoặc UI copy được port.

## 4. Phạm vi Work Management suite

### 4.1 Tasks

- `/tasks` với Task Surface dùng chung.
- Năm display modes: Board, List, Table, Gantt, Swimlane.
- Filter chips, text search, date filter, sort, grouping, facets và infinite load.
- Scope theo actor: tất cả, member, agent, squad.
- Selection và batch action toolbar.
- Drag/drop theo status, priority, assignee hoặc project group.
- Built-in views, saved views, active view, pin và preference theo view.
- Empty, filtered-empty, cold-load, refreshing, pagination và error states như nguồn.
- Quick create, recent items, pinned items, global shortcut và command search.

### 4.2 My Tasks

`/my-tasks` dùng cùng Task Surface, không dựng list riêng. Bốn scope:

1. Tất cả task liên quan.
2. Task được giao cho tôi.
3. Task do tôi tạo.
4. Task liên quan tới agent của tôi.

My Tasks có Board, List, Table, Swimlane, saved views, filter và display controls
như nguồn. Gantt chỉ xuất hiện ở những scope mà baseline cung cấp.

### 4.3 Projects

- `/projects` có list/grid-table, search, filter, sort, column visibility và pin.
- Project có icon, mô tả, status, priority, lead member/agent, start/due date và tiến độ.
- `/projects/{id}` có mô tả, resources và Task Surface scope theo project.
- Project resources nhận `github_repo` hoặc `local_directory`; control vẫn hiện nhưng
  disabled khi capability tương ứng chưa sẵn sàng.

### 4.4 Task detail và collaboration

- Canonical URL theo task identifier.
- Rich title/description editor, Markdown, code, image và attachment preview.
- Sidebar properties: status, priority, assignee, project, labels, dates, stage và
  custom properties.
- Parent/sub-task, stage groups, progress và batch action cho task con.
- Timeline hợp nhất comments, replies, status/activity và AgentRun.
- Thread resolve/unresolve, collapse, minimap, navigation, deep link và highlight.
- Edit/delete comment, reactions, mentions, subscribers và notification.
- Attachment drag/drop, upload progress, preview/download và safe content handling.
- Activity, source context, AgentRun history/usage/retry/terminate và Pull Request list.
- Responsive detail/sidebar và hành vi scroll restore như baseline.

### 4.5 Settings và shell

- Settings tabs: Task Statuses, Labels, Task Properties và task prefix.
- Custom status có category cố định; built-in status bị khóa.
- Sidebar có My Tasks, Tasks, Projects, saved views và pins.
- Inbox mở đúng task/comment và đồng bộ subscription/mention/assignment.
- Search/mention có task card và canonical link.
- Desktop tab presentation dùng task/project icon và title sống.

### 4.6 Hosts

- Web: full suite và E2E chính.
- Desktop: route, tab, navigation, persisted view state và detail surface tương đương.
- Mobile: task/project list-detail, create/edit, pickers, comments, reactions,
  attachments và AgentRun surface theo source mobile.
- Host chưa tồn tại phải có shell buildable và capability stub; không tuyên bố runtime
  parity khi host mới chỉ render stub.

## 5. Kiến trúc đích

### 5.1 Package map

```text
packages/core/tasks/          queries, mutations, cache, realtime, filters, stores
packages/core/task-views/     saved views, active view, baseline, preferences
packages/core/task-statuses/  status catalog
packages/core/projects/       project queries, mutations, resources, view store
packages/core/labels/         resource labels
packages/core/properties/     task property definitions and values
packages/views/tasks/         Task Surface, collection modes, detail, comments, pickers
packages/views/my-tasks/      My Tasks page/header over Task Surface
packages/views/projects/      project list/detail/resources
packages/views/inbox/         task-aware inbox integration
apps/web/                     thin App Router wiring
apps/desktop/                 desktop host wiring
apps/mobile/                  independent mobile UI/data wiring
server/internal/handler/      SDI/SDO decode, route params, response mapping
server/internal/service/      commands, permissions, transactions, cleanup
server/pkg/db/queries/        tenant-scoped sqlc queries
```

`packages/views` không chạm router host; `packages/core` không chứa UI hoặc browser
storage trực tiếp. Server giữ hướng handler → service → sqlc. Các file nguồn vượt
giới hạn 500 dòng được tách cơ học thành controller, sections và helpers mà không đổi
behavior.

### 5.2 Adapter seams

Source code được nối với UniWork qua interface hẹp cho:

- session, actor và effective workspace membership;
- navigation, tab presentation và host storage;
- audit recorder, outbox và realtime;
- object storage và attachment content;
- entitlement/quota;
- agent proposal/runtime;
- squad directory;
- VCS/Pull Request;
- local daemon/workdir.

Adapter trả capability state bên cạnh dữ liệu cần thiết. Component không tự suy đoán
một integration có tồn tại từ dữ liệu rỗng.

## 6. Mô hình dữ liệu và migration

### 6.1 Mở rộng `tasks`

Giữ primary key ULID hiện có và bổ sung:

- `organization_id`, `number`, `project_id`, `parent_task_id`;
- `assignee_type` (`member | agent | squad`), `creator_type`, `creator_id`;
- `acceptance_criteria`, `context_refs`, `metadata`, `properties`;
- `start_date`, `due_date`, `stage`, `position`;
- `origin_type`, `origin_id`, `first_executed_at`;
- `revision`, `last_activity_at`.

Workspace có `task_prefix` và counter. Identifier hiển thị là
`<task_prefix>-<number>`; number tăng tuần tự trong workspace.

### 6.2 Bảng vệ tinh hoạt động thật

- `projects`, `project_resources`;
- `task_statuses`;
- `task_labels`, `task_label_links`;
- `task_properties`;
- `task_dependencies`;
- `task_comments`, `comment_reactions`, `task_reactions`;
- `task_subscribers`;
- `task_views`, `task_view_preferences`;
- `attachments`;
- `task_source_contexts`;
- các bảng liên kết phục vụ pin, Inbox và activity.

Bảng chỉ phục vụ squad execution, VCS/PR hoặc daemon/workdir được hoãn đến lúc
capability có backend thật. UI stub không cần ghi placeholder rows.

### 6.3 Backfill

1. Backfill `organization_id` qua workspace.
2. Cấp `number` ổn định theo `created_at, id` trong từng workspace.
3. Tạo status catalog với bảy built-in category theo đúng baseline: `backlog`,
   `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`; giữ nguyên
   status hiện có trên từng task khi ánh xạ được, không tự đổi lifecycle.
4. Ánh xạ `assignee_kind=human → member`, giữ `agent`.
5. Ánh xạ `created_by/created_by_kind` sang creator pair nhưng không xóa attribution cũ
   trước khi mọi reader đã cutover.
6. Giữ task `kind=welcome`, ULID, timestamp và audit hiện hữu.
7. Mở rộng comment với organization/workspace, parent, resolve fields và revision.
8. Không dựng audit history giả cho dữ liệu trước migration.

Mọi bảng business mới mang `organization_id TEXT NOT NULL` và `workspace_id TEXT NOT
NULL`. Không FK/cascade. Cleanup quan hệ nằm trong service transaction. Mỗi index là
`CREATE [UNIQUE] INDEX CONCURRENTLY` trong file migration một statement.

### 6.4 Bất biến dữ liệu

- Task/project/parent/label/property/attachment không tham chiếu chéo workspace.
- Assignee phải là actor hợp lệ trong workspace.
- Status key phải có trong catalog; archived status chỉ còn đọc được trên task cũ.
- Built-in status không sửa/archive; custom status không đổi category sau khi tạo.
- Mỗi command thành công tăng revision đúng một lần.
- Xóa task là xóa vĩnh viễn theo baseline; dependent rows được dọn trong một transaction,
  audit giữ snapshot và active AgentRun được hủy khi runtime đã có thật.

## 7. API và luồng dữ liệu

### 7.1 Namespace

```text
/api/v1/workspaces/{workspaceID}/tasks
/api/v1/tasks/{taskID-or-identifier}
/api/v1/workspaces/{workspaceID}/my-tasks
/api/v1/workspaces/{workspaceID}/projects
/api/v1/workspaces/{workspaceID}/task-statuses
/api/v1/workspaces/{workspaceID}/task-labels
/api/v1/workspaces/{workspaceID}/task-properties
/api/v1/workspaces/{workspaceID}/task-views
```

Các nhóm endpoint bao gồm:

- list/detail/create/update/delete/batch/children/dependencies;
- list query cho Board/List/Gantt/Swimlane;
- Table groups, rows, facets, column projection và CSV export;
- metadata, properties, labels, reactions và subscribers;
- threaded comments, reply, edit/delete, resolve/unresolve và trigger preview;
- attachment, source context và activity;
- saved views, active view và scope preference;
- project CRUD, resources và progress;
- AgentRun history/usage/retry/terminate;
- PR/VCS link endpoints khi capability có thật.

API cụ thể được chốt trong plan của từng lát cắt từ verbatim route inventory của
baseline; umbrella design không cho phép bỏ endpoint khỏi parity manifest.

### 7.2 Mutation path

```text
UI → typed endpoint → handler → tenant/membership gate → service transaction
   → business rows + audit row + outbox rows → response revision
   → realtime consumer → cache coordinator → patch hoặc invalidate
```

- Create và comment dùng idempotency key.
- Update thông thường dùng revision/`If-Match`.
- Drag status/position là optimistic determinate path có rollback.
- Cache chỉ patch projection chắc chắn; projection không chắc chắn được invalidate.
- WebSocket không ghi server state vào Zustand.
- Response JSON qua schema lenient và `parseWithFallback`.

## 8. Capability và stub contract

Registry đích tại thời điểm core cutover (sau khi các lát cắt sở hữu capability đã
qua gate):

```text
tasks.core             available
tasks.projects         available
tasks.attachments      available
tasks.agent_runs       unavailable
tasks.squads           unavailable
tasks.vcs              unavailable
tasks.local_workdir    unavailable
desktop.host           unavailable
mobile.host            unavailable
```

Trong rollout, một capability chỉ chuyển thành `available` sau khi chính surface,
backend và contract tests của nó đã qua gate. Vì vậy `tasks.projects` và
`tasks.attachments` bắt đầu là `unavailable/surface_not_ready` ở lát cắt nền rồi được
bật bởi lát cắt 4 và 5. `desktop.host` và `mobile.host` chuyển thành `available` độc
lập khi host tương ứng qua build, smoke test và parity gates của lát cắt 7;
capability con vẫn có thể `unavailable` trên host đã chạy được.

Mỗi entry trả `status`, stable `reason_code` và localized explanation. UI render control
đúng vị trí nhưng disabled, có tooltip/dialog “Chưa khả dụng” và lý do. UI không gọi
mutation khi unavailable. Client cũ hoặc caller trực tiếp nhận
`capability_unavailable`; server không trả success giả và không ghi placeholder data.

Capability sau này chuyển từ adapter stub sang implementation thật mà không thay public
component contract.

## 9. Quyền, lỗi và an toàn

### 9.1 Permission matrix

- Effective workspace member: task CRUD, batch, assign, status, comment/reply,
  reaction, subscribe và thread resolve.
- Comment edit/delete: author hoặc effective owner/admin.
- Status/property taxonomy: effective owner/admin.
- Saved view cá nhân: owner; workspace view theo visibility và admin policy nguồn.
- Project CRUD dành cho member; governance/pin theo policy nguồn.
- Direct ID/identifier lookup không tiết lộ tồn tại cho người ngoài workspace.
- Suspended organization không đọc hoặc ghi business data.

### 9.2 Stable errors

- `revision_conflict`
- `capability_unavailable`
- `task_limit_reached`
- `invalid_status`
- `assignee_not_member`
- `parent_cycle`
- `cross_workspace_reference`
- `attachment_too_large`
- `attachment_limit_reached`
- `forbidden`
- `not_found`

Revision conflict hiển thị server value và local draft, cho phép reload hoặc apply lại
có chủ ý. Không silent overwrite.

### 9.3 UniWork invariants

- Handler không query DB.
- Mọi query business scope theo organization + workspace.
- Command ghi audit/outbox cùng transaction.
- Comment body và attachment content không đi vào immutable audit.
- Agent không ghi business tables trực tiếp. Khi AgentRun được mở sau này, thay đổi task
  đi qua proposal → human confirmation → `TaskService`.
- Entitlement task dùng billing service hiện có và render limit-recovery dialog như
  baseline.

## 10. UI parity

UI source được copy gồm layout, spacing, responsive states, loading/error, keyboard,
drag/drop, virtualized lists, scroll restoration và micro-interactions. UniWork port đủ
UI primitives/editor dependencies cần thiết thay vì thay bằng control gần giống.

Các locale English, Simplified Chinese, Japanese và Korean được port; Vietnamese được
bổ sung đầy đủ. i18n parity gate đảm bảo mọi locale có cùng key. Branding và persisted
keys đều đổi sang UniWork.

Các capability stub vẫn chiếm đúng vị trí hình học để khi bật thật không làm đổi layout.
Disabled state phải truy cập được bằng bàn phím và đọc được lý do bằng assistive tech.

## 11. Phân rã delivery

Mỗi mục dưới đây là một sub-issue và một plan độc lập dưới UNI-426:

1. **Parity inventory và nền dữ liệu** — manifest, schema, backfill, catalogs, projects,
   capability registry.
2. **Task API và client core** — queries, table/facet APIs, mutations, revision,
   idempotency, batch, cache và realtime.
3. **Task collection surfaces** — năm views, headers, filters, saved views, `/tasks`,
   `/my-tasks`.
4. **Projects suite** — project list/detail/progress/resources và scoped Task Surface.
5. **Task detail và collaboration** — editor, properties, sub-tasks, comments,
   reactions, attachments, activity, source context.
6. **Agent/integration surfaces** — AgentRun, squad, VCS/PR và daemon/workdir disabled
   contracts.
7. **Desktop và mobile** — host wiring và platform-specific parity.
8. **Cutover và cleanup** — rehearsal, flag rollout, route cutover, xóa MVP code/flag.

Không cutover khi mục 1–5 chưa hoàn chỉnh. Mục 6 được phép stub theo contract. Mục 7
phải build được và phân biệt rõ implemented với unavailable.

## 12. Parity manifest và kiểm thử

### 12.1 Manifest

Mỗi source file/route/test/capability được ánh xạ tới target và có đúng một trạng thái:

- `ported`: chạy thật, cùng behavior;
- `adapted`: khác hạ tầng nhưng cùng behavior người dùng;
- `stubbed`: UI visible-disabled với capability reason.

Không có `skipped`, `unknown` hoặc entry chưa phân loại lúc cutover. Manifest ghi baseline
commit, source path, target path, owner sub-issue và verification evidence.

### 12.2 Verification gates

- Port toàn bộ relevant source tests; test capability stub được đổi thành disabled-contract
  test, không bị xóa.
- Go service/handler tests cho happy path, permission, tenant isolation, invalid lifecycle,
  revision race, idempotent replay, audit và outbox rollback.
- Migration test từ schema/dataset Tasks hiện tại, gồm welcome task và agent attribution.
- Frontend contract tests cho schema drift, cache projections, realtime revision và stores.
- Component tests cho năm views, detail, My Tasks, Projects, comments và stub states.
- Visual regression cho desktop widths, mobile widths, light và dark.
- Web E2E; desktop/mobile smoke; keyboard/accessibility regression.
- Performance checks cho table/list lớn, board grouping và timeline dài.
- `make check` xanh trước tuyên bố hoàn thành.
- Quét target code/test/API header/persisted key/UI copy không còn chuỗi tên nguồn,
  không phân biệt hoa thường.
- Parity manifest không còn entry chưa phân loại.

## 13. Rollout và rollback

1. Bản mới tồn tại sau `tasks_work_management_parity`; MVP route hiện tại vẫn phục vụ production.
2. Chạy migration rehearsal trên bản sao database có dữ liệu task/comment thật.
3. Mở flag cho development, test tenant, rồi internal tenant.
4. So sánh count, identifiers, comments, audit, attachment và saved-view behavior.
5. Cutover `/tasks`, `/my-tasks`, `/projects` khi mục 1–5 và parity gates đạt.
6. Xóa implementation MVP và feature flag trong cùng đợt ổn định sau cutover.

Rollback trước bước 6 là tắt flag; migration phải forward-compatible và không xóa cột
cũ trước khi cutover ổn định. Rollback sau bước 6 dùng revert ứng dụng và restore theo
runbook migration rehearsal; không dual-write dài hạn.

## 14. Điều kiện hoàn thành umbrella design

- Tài liệu này được người dùng duyệt.
- UNI-426 mô tả đúng phạm vi mới.
- Spec F-05 cũ được đánh dấu superseded và roadmap trỏ tới tài liệu này.
- Tám sub-issue được tạo khi implementation plan tương ứng bắt đầu.
- Lát cắt 1 được lập kế hoạch bằng `superpowers:writing-plans` tại
  `../plans/2026-09-07-tasks-parity-foundation.md`; các lát cắt sau chỉ lập plan khi
  checkpoint trước đủ evidence.
