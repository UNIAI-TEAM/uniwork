# UniWork — Công việc (Tasks) parity Multica Issues

**Ngày:** 2026-08-27  
**Trạng thái:** Chờ duyệt spec (brainstorming)  
**Spec liên quan:** `2026-08-24-uniwork-platform-design.md`, `2026-08-25-uniwork-base-port-design.md`, `2026-08-27-workspace-permissions-design.md`  
**Tham chiếu mã nguồn:** `multica/` (gitignored) — `packages/views/issues`, `packages/core/issues`, `server` issue handlers/migrations

## 1. Mục tiêu

Port **hành vi và surface Multica Issues** sang UniWork dưới domain **task / công việc**, parity tối đa (gồm agent/squad, channel, GitHub — stub runtime), thay MVP `tasks` hiện tại qua nhiều pha độc lập.

Thành công khi:

- UX/model gần như Multica Issues (board/list/table/swimlane/gantt, detail, filters, views, labels, projects, sub-tasks…).
- Domain naming UniWork nhất quán (`task`, route `/tasks`, i18n “Công việc”).
- Agent/channel/GitHub có **contract + UI stub**, không crash khi runtime chưa có.
- MVP tasks cũ bị cắt sau khi parity đủ; `make check` xanh.

## 2. Quyết định đã chốt (brainstorming)

| # | Quyết định |
|---|------------|
| 1 | Scope = **y hệt Multica Issues**, chia nhiều pha/task |
| 2 | Agent/squad: port **đủ model + UI**; runtime stub đến khi có Agents |
| 3 | Naming: **task / công việc** mọi tầng (code, API, UI, DB) — không dùng `issue` |
| 4 | Epic tối đa: Issues + vệ tinh + channel/GitHub; stub nơi thiếu hạ tầng |
| 5 | Cutover: **thay thế sạch** schema/API/UI MVP; migrate dữ liệu; không dual-write lâu |
| 6 | Hướng kỹ thuật: **Skeleton Multica + vertical slices** (Approach 3) |
| 7 | Realtime: giữ contract UniWork **id-only + invalidate** (không port `ws-updaters` patch-in-place); vẫn lưu `revision` trên model |

## 3. Phạm vi

### Trong epic

- Surface: list / board / table / swimlane / gantt, create, filters, batch actions, detail.
- Vệ tinh: status catalog (7 category + custom), labels, projects, sub-tasks + stage, dependencies, saved views, my-work, comments/reactions, attachments, custom properties, identifier (`PREFIX-n`).
- Model sẵn: `assignee_type` member|agent|squad, metadata, revision, origin/source-context, GitHub & channel hooks (stub).
- Inbox quanh task (pha muộn trong epic).
- Migrate dữ liệu MVP → shape mới; gỡ API/UI cũ khi parity đủ.

### Ngoài epic (hoặc stub only)

- Agent runtime thật, daemon, autopilot execution.
- Channel adapters production (DingTalk/WeCom/Telegram/Lark/Slack) — chỉ contract/stub.
- Squad CRUD đầy đủ (assignee stub nếu chưa có bảng).
- Billing / PAT / plugin scopes (xem permissions design).

### Ràng buộc UniWork (bắt buộc lệch nền, không đổi sản phẩm)

| Multica | UniWork |
|---------|---------|
| `issue` | `task` / công việc |
| `/{ws}/…` | `/{orgSlug}/{workspaceSlug}/…` |
| UUID | ULID `TEXT` (`util.NewID()`) |
| FK / CASCADE (nhiều mig cũ) | Không FK sau mig 004; cleanup trong service + tx |
| `@multica/*` | `@uniwork/*`; cấm leak `multica` / `issue` trong source ship (`scripts/no-usf-leak.test.mjs`, mở rộng pattern nếu cần) |

## 4. Data model

Nguyên tắc: mirror Multica; đổi tên `issue*` → `task*`; id ULID; không FK; mọi query filter `workspace_id`.

### 4.1 `tasks` (thay bảng MVP)

- Identity: `id`, `workspace_id`, `number`, `identifier`
- Nội dung: `title`, `description`
- Workflow: `status` (key trong catalog), `priority` (`urgent|high|medium|low|none`)
- Actors: `assignee_type` (`member|agent|squad` | null), `assignee_id`, `creator_type`, `creator_id`
- Cấu trúc: `parent_task_id`, `project_id`, `position`, `stage`
- Lịch: `start_date`, `due_date` (date-only `YYYY-MM-DD`)
- Mở rộng: `metadata` JSONB, `properties` JSONB
- Đồng bộ: `revision`, `last_activity_at`, `created_at`, `updated_at`

### 4.2 `task_statuses`

- 7 category = 7 built-in key: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`
- Custom: `key` (immutable), `name`, `color`, `category` (immutable), `is_system`, `position`, `archived_at`
- Board/filter keyed theo **category**; `tasks.status` lưu **key**
- Seed 7 system statuses khi tạo workspace

### 4.3 Vệ tinh

| Bảng | Vai trò |
|------|---------|
| `task_labels` + `task_label_links` | Tag name/color (M2M) |
| `task_dependencies` | `blocks` / `blocked_by` / `related` |
| `projects` (+ resources nếu cần) | Nhóm việc; `tasks.project_id` |
| `task_comments` | Comment + system types; `author_type` member\|agent |
| `task_reactions` | Emoji trên task |
| `attachments` | Owner task/comment |
| `task_property_definitions` + values trên task | Custom fields |
| `task_views` + preferences | Saved filters (scope workspace/my/project) |
| `inbox_items` | Thông báo quanh task |
| Stub tables/fields | agent, squad, github link, channel origin, source_context |

### 4.4 Identifier prefix

Workspace giữ prefix dùng để dựng `identifier` (vd. `ENG` → `ENG-42`), mirror Multica workspace issue prefix — cột trên `workspaces` hoặc bảng cấu hình workspace; seed khi tạo workspace / onboard.

### 4.5 Cutover MVP

1. Migration tạo schema mới (rebuild `tasks` + vệ tinh theo rule migration UniWork).
2. Backfill hàng MVP: map status `todo|in_progress|done|cancelled` → key tương ứng; priority thiếu `none`; seed statuses; gán `number`/`identifier`.
3. Xóa constraint/cột MVP không dùng; không dual-write.

**Pha 0 vs Pha 7:** Pha 0 chuyển **path chính** (schema + board/list/detail) sang model mới. Pha 7 mới **xóa** mọi code/API/test legacy còn sót — không để dual path lâu, nhưng không yêu cầu zero leftover ở cuối Pha 0.

## 5. API, realtime, permissions

### 5.1 HTTP

Prefix UniWork `/api/v1`. Nest workspace như hiện tại; mở rộng mirror Multica:

- Tasks CRUD + list filter, batch update, children
- Task statuses, labels, projects, task-views (+ preference)
- Comments / reactions / attachments dưới `/tasks/{id}/…`
- Properties: defs workspace + values trên task
- Inbox: `/workspaces/{ws}/inbox` (pha sau)
- Stub: GitHub/channel origin — 501 hoặc no-op có contract test

FE: `parseWithFallback` + schema lenient; malformed-response test mỗi endpoint. Resolve URL bằng ULID hoặc `identifier`.

### 5.2 Realtime

Sự kiện `<entity>.<verb>`, payload **id-only**. Client **invalidate** query keys — không ghi frame vào cache (CLAUDE.md). Model có `revision` cho optimistic/conflict sau; không port Multica `ws-updaters` patch-in-place trong epic này.

### 5.3 Permissions

Mirror gate Go trong `packages/core/permissions/rules.ts` (nền: `2026-08-27-workspace-permissions-design.md`):

- Nội dung task: mọi effective member CRUD ngang nhau
- Admin-like: quản lý status catalog; shared views / settings labels khi tới pha
- Assignee `agent`/`squad`: API chấp nhận type; entity thiếu → 400/422 rõ; UI picker stub/disabled + i18n
- Agent write path: stub — chưa ship runtime
- Comments (policy đã chốt): tạo = member; sửa/xóa = author ∨ admin-like — wire khi pha collaboration

## 6. UI & package layout

### 6.1 Routes

- `/{org}/{ws}/tasks`, `…/tasks/{idOrKey}`
- `…/my-work` (My Issues → My Work)
- `…/projects`
- Settings status/labels khi tới pha tương ứng

### 6.2 Surface

Port `IssueSurface` → `TaskSurface`: một controller cho list/board/table/swimlane/gantt; filter chips; batch toolbar; selection; view baseline; create dialog.

Detail 2 cột (Multica): title/description/comments trái; status/priority/assignee/labels/dates/project/sub-tasks phải; agent chips stub.

Shell UniWork: `CollectionPageHeader` / `BreadcrumbHeader`; mọi copy qua `t()` (vi–en parity).

### 6.3 Packages

```
packages/core/tasks/
packages/core/task-statuses/
packages/core/labels/
packages/core/task-views/
packages/core/projects/
packages/core/api/endpoints/{tasks,task-statuses,labels,projects,…}.ts
packages/views/tasks/
packages/views/my-work/
packages/views/projects/
apps/web/app/[orgSlug]/[workspaceSlug]/{tasks,my-work,projects}/…
server/internal/{handler,service}/task*.go + sqlc
```

Optimistic updates: chỉ drag status/position trên board (rule UniWork hiện có).

## 7. Roadmap pha

Mỗi pha = plan riêng + ship riêng. Thứ tự:

| Pha | Nội dung | Done khi |
|-----|----------|----------|
| **0 – Skeleton** | Schema cutover + seed 7 statuses + prefix; types/endpoints lõi; `TaskSurface` shell (board/list tối thiểu); migrate MVP; detail cơ bản | Create/list/update/delete + board trên schema mới (legacy cleanup → Pha 7) |
| **1 – Workflow** | Status catalog CRUD; filters; identifier URL; priority `none`; start/due | Custom status + board theo category |
| **2 – Taxonomy** | Labels, projects, task↔project | Gắn label/project trên board & detail |
| **3 – Hierarchy** | Sub-tasks, stage, dependencies | Parent/child + blocks |
| **4 – Views** | Saved views, my-work variants, table/swimlane/gantt | Parity layout Multica |
| **5 – Collaboration** | Comments rich, reactions, attachments, properties | Detail đầy đủ |
| **6 – Inbox + stubs** | Inbox quanh task; GitHub/channel/agent/squad contracts stub | Endpoint + UI stub có test |
| **7 – Cắt MVP** | Xóa code/API/UI legacy; e2e parity chính | `make check` xanh; không dual path |

Implementation plan đầu tiên sau khi duyệt spec: **Pha 0**.

## 8. Testing & verification

Mỗi pha:

- Go: service gates + hành vi sqlc; migration lint (no FK, index `CONCURRENTLY` đơn file)
- FE: endpoint malformed tests; surface/controller tests (port/adapt từ Multica)
- E2E: tạo → kéo board → detail → comment (mở rộng theo pha)
- Gate: `no-usf-leak`, typecheck, lint, unit, `make test-go`
- Trước claim xong pha: kiểm tra hẹp trong lúc làm; `make check` trước khi đóng pha

## 9. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|--------|------------|
| Epic quá lớn, lệch “y hệt” | Pha nhỏ, done criteria rõ; neo hành vi vào Multica khi review |
| usf-leak / domain `issue` | Rename bắt buộc; CI `no-usf-leak`; không commit string `multica` |
| Phụ thuộc agent/channel chưa có | Schema + UI stub sớm; không block pha 0–5 |
| Realtime khác Multica | Ghi rõ fork invalidate-only; revisit sau nếu cần parity cảm giác live |
| Migration MVP | Pre-launch: cutover sạch + backfill có test |

## 10. Không làm trong spec này

- Implementation plan chi tiết từng file (→ `writing-plans`, bắt đầu Pha 0)
- Thay đổi PRODUCT positioning
- Viết lại rule realtime UniWork
