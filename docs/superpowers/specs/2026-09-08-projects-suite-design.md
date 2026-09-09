# UniWork — Projects suite (UNI-426 lát cắt 4)

> **Trạng thái:** in-progress — thiết kế được duyệt ngày 2026-09-08; plan `../plans/2026-09-08-projects-suite.md`; chờ sub-issue + SDD

**Ngày:** 2026-09-08  
**Issue:** UNI-502 · UNI-426.4  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** UNI-495 + UNI-497 + UNI-500 đã merge `develop`  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §4.3, §5.1, §8, §10, §11 mục 4  
**Baseline nguồn:** `multica/` @ `3d37828e9`

## 1. Mục tiêu

Port **Projects suite** từ Multica sang UniWork để khi bật `tasks_work_management_parity` người dùng có `/projects` list, `/projects/{id}` (mô tả, progress, resources) và **Task Surface scoped theo project** — tái dùng Surface lát cắt 3, không fork shell mới. Flag tắt: không nav Projects / route unavailable. Không làm task detail sâu, Agent/VCS runtime thật, desktop/mobile, hay cutover (lát 5–8).

## 2. Quyết định đã chốt (brainstorm 2026-09-08)

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Full umbrella mục 4: list/grid + search/filter/sort/columns/pin + detail (props/progress/resources) + Task Surface project-scoped + sidebar nav |
| Rollout UI | Cùng flag `tasks_work_management_parity`: on → Projects; off → không nav / unavailable (không có MVP Projects cũ) |
| Cách port | Transplant Multica projects list/detail/resources @ `3d37828e9`; đổi brand; embed `TaskSurface` sẵn có |
| Capability thiếu | `github_repo` / `local_directory` (và Agent liên quan) hiện đúng chỗ, disabled + reason; không gọi runtime thật |
| Approach | Mở rộng `TaskScope` với `{ type: "project"; projectId }` + query-plan gắn filter `project_id` server-side (không khóa `projectFilters` client; không fork `ProjectSurface`) |

## 3. Phạm vi

### 3.1 Trong phạm vi

**`packages/core`**

- Mở `TaskScope` / `taskScopeKey` / `planSurfaceQuery` cho `project`.
- Mở rộng tối thiểu suite task query + table filter (+ grouped nếu board cần) nhận `project_id` / `project_ids` nếu API hiện tại chưa hỗ trợ — client và Go cùng đợt; không redesign table contract.
- Tái dùng `api/endpoints/projects`, `hooks-projects`, `taskKeys.project*`.
- Transplant `packages/core/projects/stores/view-store` (list chrome) từ Multica; strip brand; không `localStorage` trực tiếp (StorageAdapter nếu persist).

**`packages/views/projects/`**

- List page: search, filter, sort, column visibility, pin UI (behavior parity Multica).
- Detail chrome: icon, title, status, priority, lead, dates, description, progress (`done_count`/`task_count` từ Project DTO).
- Resources section: list + create/update/delete qua hooks; controls GitHub/local disabled + reason khi capability chưa sẵn.
- Embed `TaskSurface` với `scope={ type: "project", projectId }` — modes/filters/saved views như `/tasks`; saved views `scope_type=project` + `scope_id`.

**`apps/web`**

- `/{org}/{ws}/projects` và `/{org}/{ws}/projects/[projectId]` — page mỏng, flag gate.
- `paths` builders + reserved slug + sidebar item khi flag on (cùng pattern My Tasks).
- Lazy-load nếu cần giữ bundle budget route ≤ 150 KB gzip.

**i18n / parity**

- Mọi literal views qua `t()`; bổ sung `vi` + locale cần thiết.
- Overlay verification lát 4; brand-scan không còn chuỗi nguồn trong product/tests.

### 3.2 Ngoài phạm vi

- Task detail rich editor / comments / attachments storage thật (lát 5).
- AgentRun / VCS / daemon runtime thật (lát 6) — chỉ stub UI.
- Desktop / mobile hosts (lát 7).
- Cutover xóa MVP Tasks + gỡ flag (lát 8).
- Đổi contract HTTP Projects CRUD đã ổn trừ bug block UI hoặc unblock `project_id` filter ở trên.

## 4. Kiến trúc

```text
Flag tasks_work_management_parity
  off → không nav Projects; /projects* unavailable
  on  → sidebar Projects
        /projects              → ProjectsListPage (Multica transplant)
        /projects/{id}         → ProjectDetailPage
             ├ header / props / progress / resources
             └ TaskSurface scope={ type:"project", projectId }
                  → planSurfaceQuery → suite APIs + project_id filter
```

### 4.1 Cấu trúc thư mục đích

```text
packages/views/projects/
  projects-list-page.tsx
  project-detail-page.tsx
  components/          # row, header, resources, badges, …
packages/core/projects/
  stores/view-store.ts # list chrome
packages/core/tasks/surface/
  scope.ts             # + project
  query-plan.ts        # project → workspace_query|table + project_id
```

### 4.2 State rules

- Server state: TanStack Query; keys `taskKeys.projects` / `project` / `projectResources` (+ filter hash).
- Không ghi WebSocket payload vào query/Zustand.
- Optimistic: không cho create/delete project hay resource; await server. Task drag trong Surface giữ rule lát 3 (status/position only).
- Zustand list chrome trong `packages/core/projects`, không trong views.

### 4.3 Data notes

- Progress list/detail: `task_count` / `done_count` / `resource_count` trên Project DTO (API foundation).
- Project-scoped tasks: **bắt buộc** filter server; UI không được clear filter project trên path detail.
- Filter chip “project” trên Surface trong project scope: khóa / ẩn (locked filter) giống pattern My Tasks relation.

## 5. Lỗi và stub

| Tình huống | Hành vi |
| --- | --- |
| Flag off | Không gọi project suite hooks từ nav; route unavailable |
| Project 404 / forbidden | Not found; không lộ cross-tenant |
| `revision_conflict` (put project) | Hiện server + refetch / apply lại có chủ ý |
| Capability GitHub / local / Agent | Disabled + reason; không mutation runtime |
| Empty / error list hoặc Surface | States shell UniWork + `t()` |

## 6. Kiểm thử và DoD

- Unit: `TaskScope` project + query-plan gắn `project_id`; Go/table filter tests; malformed endpoint nếu mở rộng body.
- Views: list smoke; detail header + resources disabled contract; TaskSurface project scope không lọt task ngoài project.
- Brand-scan + parity overlay lát 4.
- E2E smoke: flag on → `/projects` và `/projects/{id}` load; flag off → Tasks MVP không regress / không lộ Projects nav.
- `make check` / `make check-worktree` xanh trước PR.
- Roadmap F-05 vẫn `MỘT PHẦN`; không đánh dấu F-05 xong.

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Query/table thiếu `project_id` | Unblock API trong cùng lát; test isolation project A vs B |
| Lọt task ngoài project | Locked scope; không dùng approach khóa `projectFilters` client |
| Bundle budget route | Lazy-load list/detail giống TaskSurfacePage / MyTasks |
| File >500 lines | Tách `components/` theo Multica modules đã split |
| Resource UI gọi GitHub sớm | Capability gate + contract test disabled |

## 8. Việc làm tiếp theo

1. Tạo sub-issue UniAI dưới UNI-426 (UNI-426.4 · Projects suite).  
2. `writing-plans` → `docs/superpowers/plans/2026-09-08-projects-suite.md`.  
3. `make issue-start` + worktree; SDD transplant + scope/API filter + tests + PR.
