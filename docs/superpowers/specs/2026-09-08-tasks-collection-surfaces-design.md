# UniWork — Tasks collection surfaces (UNI-426 lát cắt 3)

> **Trạng thái:** approved — đã duyệt brainstorm 2026-09-08; plan `../plans/2026-09-08-tasks-collection-surfaces.md` sẵn; chờ UniAI KEY + `issue-start`; phụ thuộc UNI-497 shipped

**Ngày:** 2026-09-08  
**Issue:** UNI-500 · UNI-426.3  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** UNI-495 (nền) + UNI-497 (API + client core) đã merge `develop`  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §4.1–4.2, §5.1, §8, §10, §11 mục 3  
**Baseline nguồn:** `multica/` @ `3d37828e9`

## 1. Mục tiêu

Port **Task collection UI** từ Multica Issue Surface sang UniWork để khi bật flag `tasks_work_management_parity` người dùng có đủ năm display mode, filters, saved views và `/my-tasks` trên API/hooks lát cắt 2 — **không** cắt MVP khi flag tắt và **không** làm Projects suite / task detail sâu (lát cắt 4–5).

## 2. Quyết định đã chốt (brainstorm 2026-09-08)

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Full umbrella mục 3: Board / List / Table / Gantt / Swimlane + filters/facets + saved views/prefs/pins + `/tasks` + `/my-tasks` (4 scope) |
| Rollout UI | Flag on → suite Surface; flag off → giữ MVP board/list hiện tại |
| Cách port | Transplant có kiểm soát từ Multica `IssueSurface` (+ modes/filters/views/My Issues); đổi Issue→Task; strip brand nguồn |
| Capability thiếu | Hiện đúng chỗ, disabled + `reason_code` / “Chưa khả dụng”; không ẩn; không gọi mutation |
| Approach | A — transplant nguyên Surface, gắn hooks UniWork đã có |

## 3. Phạm vi

### 3.1 Trong phạm vi

**`packages/views/tasks/` (và `my-tasks/` nếu tách page mỏng)**

- Transplant shell Task Surface: header, mode switcher, filter/search/sort/group/facet, batch toolbar, empty/loading/error.
- Năm mode: board, list, table, gantt, swimlane (đổi tên miền + nối data UniWork).
- Saved views / active view / preferences / pins UI gắn `useTaskViews` (+ prefs/pins) từ `@uniwork/core`.
- Data: `useQueryTasks`, `useGroupedTasks`, `useTableGroups` / `Rows` / `Facets`, `useMyTasks`, batch, catalog statuses khi group theo status; optimistic chỉ drag status/position.
- Capability stubs trên collection (Projects sâu, AgentRun, VCS, attachments…): disabled + reason theo registry / API `capability_unavailable`.

**`apps/web`**

- `/{org}/{ws}/tasks`: flag gate — off MVP `TasksPageView`; on `TaskSurfaceView`.
- Thêm `/{org}/{ws}/my-tasks` (+ `paths` builder + nav + reserved slug nếu cần): My Tasks page với 4 scope, cùng Task Surface.
- Không `next/*` trong views; navigation qua adapter hiện có.

**i18n**

- Mọi literal views qua `t()`; port locale nguồn cần thiết + bổ sung `vi` đủ key collection.

**Parity**

- Overlay/manifest verification cho entry UI lát cắt 3 đã port; scan không còn brand nguồn trong product/tests.

### 3.2 Ngoài phạm vi

- Projects list/detail/resources UI (lát cắt 4).
- Task detail: rich editor, threaded comments UI sâu, attachments storage thật (lát cắt 5).
- Agent/VCS/daemon runtime thật (lát cắt 6) — chỉ stub UI trên collection.
- Desktop / mobile hosts (lát cắt 7).
- Cutover xóa MVP + gỡ flag (lát cắt 8).
- Đổi contract HTTP lát cắt 2 trừ bug block UI (khi đó sửa kèm evidence).

## 4. Kiến trúc

```text
apps/web /tasks | /my-tasks
  → useFlag("tasks_work_management_parity")
       off → TasksPageView MVP (board | list)
       on  → TaskSurfaceView / MyTasksPageView
            → packages/views/tasks/surface + modes + views UI
            → @uniwork/core tasks hooks (wsId keys)
            → suite API (flag server) / MVP API khi flag off
```

### 4.1 Cấu trúc thư mục đích (gợi ý plan)

```text
packages/views/tasks/
  surface/          # shell: header, filters, batch, mode switch
  modes/            # board | list | table | gantt | swimlane
  views/            # saved views / prefs / pins chrome
  my-tasks/         # optional thin wrappers / scope tabs
  (MVP files hiện tại giữ nguyên cho flag-off path)
```

### 4.2 My Tasks

Cùng Task Surface với `/tasks`. Bốn scope (umbrella §4.2):

1. Tất cả task liên quan  
2. Được giao cho tôi  
3. Do tôi tạo  
4. Liên quan agent của tôi (control có thể disabled nếu capability agent chưa `available`)

Gantt chỉ hiện ở scope mà baseline Multica có.

### 4.3 State rules

- Server state: TanStack Query only; keys từ factories slice 2 (`wsId` + filter hash).
- Không ghi WebSocket payload vào query/Zustand; dựa invalidate/realtime đã wire.
- Optimistic: chỉ outcome kéo status/position deterministic; create/delete/batch await server.
- Zustand chỉ nếu cần client chrome (vd. panel mở) trong `packages/core`, không trong views.

## 5. Lỗi và stub

| Tình huống | Hành vi |
| --- | --- |
| Flag off | Không gọi suite hooks; MVP board/list |
| `revision_conflict` | Hiện giá trị server + reload / apply lại có chủ ý |
| Capability thiếu | Disabled + tooltip/dialog + `reason_code`; không mutation |
| Empty / filtered empty / error | States port từ nguồn, copy UniWork/`t()` |

## 6. Kiểm thử và DoD

- Component tests: mode switch, filters, saved views, My Tasks scopes, stub disabled; không mock `next/*`.
- Brand scan: không chuỗi nguồn trong views/tests/i18n product.
- E2E smoke: flag on → `/tasks` và `/my-tasks` load; flag off → MVP không regress.
- `make check` / `make check-worktree` xanh trước PR.
- Roadmap F-05 vẫn `MỘT PHẦN` sau lát cắt này; umbrella không đánh dấu F-05 xong.

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| PR quá lớn / file >500 lines | Tách module theo `surface` / `modes` / `views`; plan task theo mode nếu cần |
| Lệch hook vs Multica query shape | Checklist inventory + malformed đã có ở core; adapter mỏng tại surface |
| Drag/group phụ thuộc status catalog | Dùng 7 category + `useTaskStatuses`; không hard-code 4 status MVP trên path suite |
| Nav `/my-tasks` thiếu path/slug | Thêm `paths` + consistency test + reserved slug nếu global |

## 8. Việc làm tiếp theo

1. Tạo sub-issue UniAI dưới UNI-426 (stage sau lát cắt 2).  
2. `writing-plans` → `docs/superpowers/plans/2026-09-08-tasks-collection-surfaces.md`.  
3. `make issue-start` + worktree; SDD transplant + flag gate + tests + PR.
