# UniWork — Task filter parity với Multica

> **Trạng thái:** in-progress — spec brainstorm đã duyệt; chờ plan + implement trên `feature/UNI-702-…`

**Ngày:** 2026-09-18  
**Issue:** UNI-702  
**Parent:** UNI-426 · F-05  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md`, `2026-09-08-tasks-collection-surfaces-design.md`  
**Baseline nguồn:** `multica/` @ `3d37828e9`  
**Approach:** Hybrid Multica-shaped (UI + `filter.ts` client + mở rộng `tablequery` cho table)

## 1. Mục tiêu

Wire **lọc công việc** ngang Multica Issue filter trên mọi Task collection surface UniWork (`/tasks`, `/my-tasks`, project-scoped, mọi mode), bỏ stub `filters_not_wired`, stub đúng chỗ khi thiếu capability/runtime — **không** chạy `make check` trong DoD của issue này (test hẹp theo lớp đụng; luồng UniAI/spec/plan/PR vẫn bắt buộc).

## 2. Gap đã xác nhận (brainstorm)

| Multica (`3d37828e9`) | UniWork hiện tại |
| --- | --- |
| `IssueFilterMenu` đủ chiều + facet counts + `freezeAnchor` + `viewBaseline` | `TaskFilterMenu` chỉ status/priority; **disabled** (`TASK_FILTERS_WIRED = false`, `filters_not_wired`) |
| `filter-chips-bar` đủ chiều + icon stack + baseline delta | Chips chỉ status/priority/assignee/date |
| `packages/views/issues/utils/filter.ts` | **Thiếu** `packages/views/tasks/utils/filter.ts` (có trong parity inventory) |
| `issue-views/baseline` | Chưa port tương đương Task |
| Client `applyIssueFilters` + server table facets giàu field | Store filter gần đủ; `TableFilter` / `tablequery.Filter` chỉ status, priority, assignee_ids, project_ids |
| Squad trong assignee; Agents working quick filter | Capability stub / chrome có nhưng không wire lọc |
| Saved-view baseline khóa giá trị “đã nằm trong view” | `SaveViewFilterMenu` có chiều; surface chips/menu chưa baseline |

## 3. Quyết định đã chốt (brainstorm 2026-09-18)

| Chủ đề | Quyết định |
| --- | --- |
| Kết quả | Design + plan để **wire filter parity** (không chỉ inventory) |
| Mức parity | Full menu Multica: status, priority, assignee (member+agent+squad stub), creator, project±no, label, custom property (+ `__none__`), date, chips, saved-view baseline, facet counts, `filter.ts` + wire query |
| Capability thiếu | Stub đúng chỗ: disabled + `reason_code` / tooltip; không ẩn; không gọi API thiếu |
| Surface | `/tasks`, `/my-tasks`, project-scoped, mọi mode (board/list/table/gantt/swimlane) |
| Agents working + date | Trong scope; stub agents-working nếu projection chưa available; date thật nếu API hỗ trợ, không thì stub đến khi server sẵn |
| Approach | Hybrid: client `applyTaskFilters` cho mode load-flat; server `tablequery` mở rộng cho table phân trang |
| Verification | Luồng dự án (UniAI → spec → plan → nhánh → TDD → PR); **không** bắt buộc `make check` |

## 4. Phạm vi

### 4.1 Trong phạm vi

- Bật `TASK_FILTERS_WIRED`; gỡ e2e/assert `filters_not_wired`.
- Port `packages/views/tasks/utils/filter.ts` (+ test) từ Multica `filter.ts` (Issue→Task, strip brand).
- `TaskFilterMenu` full parity UI; đồng bộ hành vi với `SaveViewFilterMenu`.
- `FilterChipsBar` đủ chiều + baseline delta / clear.
- Port baseline helpers (`actorFilterKey`, `baselineFromQuery` / `TaskViewBaseline`) vào `packages/core/tasks/`.
- Wire surface controller: store → `applyTaskFilters` và/hoặc `mapStoreToTableFilter`.
- Mở rộng `server/pkg/db/tablequery.Filter` + handler SDI + client `TableFilter` cho: label_ids, creator actors, property map (`__none__`), date range (created_at/updated_at), include_no_assignee / include_no_project.
- Facet counts table qua `useTableFacets` khi mở submenu.
- Stub: `tasks.squads`, agents-working khi thiếu projection. Chiều table mà server chưa có field: **disabled + reason** (không lọc client giả trên trang phân trang). Mode load-flat được dùng `applyTaskFilters` cho đủ chiều có trên payload task.
- i18n `t()` cho copy filter/empty-filtered.
- Cập nhật parity inventory path `filter.ts`.

### 4.2 Ngoài phạm vi

- Mobile / desktop hosts.
- Inbox / dashboard filters.
- Runtime squad / working-agents thật (chỉ stub UI).
- Cutover gỡ flag MVP / xóa dual path.
- `make check` / `check-full` làm gate bắt buộc của issue (vẫn được chạy thủ công nếu người muốn).

## 5. Kiến trúc

```text
ViewStore (packages/core/tasks/stores) — nguồn sự thật filter
  │
  ├─ TaskFilterMenu + FilterChipsBar (+ TaskViewBaseline)
  │
  ├─ board | list | gantt | swimlane
  │     fetch (query hiện có / mở rộng khi cần)
  │     → applyTaskFilters (+ showSubTasks, agentRunning client)
  │
  └─ table
        mapStoreToTableFilter → table groups/rows/facets (server)
        client chỉ còn showSubTasks / agentRunning nếu server không mang
```

| Lớp | Trách nhiệm |
| --- | --- |
| `packages/core` | Store đã có; baseline; mở rộng `TableFilter` / query body |
| `packages/views/tasks` | Menu, chips, `utils/filter.ts`, wire controller |
| `server/.../tablequery` + handler | Mở rộng `Filter` + param an toàn (ADR 0020) |
| Capability registry | Squad / agents-working → disabled + reason |

## 6. Components

| Component / module | Việc làm |
| --- | --- |
| `TaskFilterMenu` | Submenu đủ chiều; facet counts (table); `freezeAnchor`; `viewBaseline` khóa giá trị saved view |
| `FilterChipsBar` | Chip đủ chiều + icon stack; clear dimension/all tôn trọng baseline; Save CTA |
| `SaveViewFilterMenu` | Đồng bộ chiều + `__none__` với menu surface |
| `TaskDisplayControls` | `TASK_FILTERS_WIRED = true` |
| Agents working control | Wire khi projection available; không thì stub |
| `utils/filter.ts` | `applyTaskFilters`, `NO_PROPERTY_VALUE`, property match, group re-filter |
| `baseline` (core) | Port từ Multica `issue-views/baseline` |
| `tablequery.Filter` + client | Field mới §4.1 |
| Surface controller | Map store → filter body / apply; `lockProjectFilter` trên project surface |

## 7. Data flow

1. User đổi filter → store `toggle*` / `setDateFilter` / `toggleAgentRunningFilter`.
2. Controller đọc snapshot:
   - **Table:** `normalizeTableQuery({ filter: mapStoreToTableFilter(...) })` → đổi hash → refetch groups/rows/facets.
   - **Khác:** fetch rồi `applyTaskFilters(tasks, snapshot, { runningTaskIds })`.
3. Chips = delta so với `viewBaseline` khi mở saved view; X chip → `resetFiltersTo` baseline dimension (không về rỗng).
4. Clear all → `baseline.raw` nếu có view, else `clearFilters()` + clear date.
5. Realtime: không ghi filter từ WS; invalidate query như hiện tại; row sau refetch đi cùng pipeline.
6. Không optimistic trên đổi filter.

### 7.1 Map store → server (table)

| Store | Server |
| --- | --- |
| `statusFilters` | `statuses` |
| `priorityFilters` | `priorities` |
| `assigneeFilters` + `includeNoAssignee` | `assignee_ids` + flag no-assignee |
| `creatorFilters` | creator actor ids/kinds |
| `projectFilters` + `includeNoProject` | `project_ids` + flag (bỏ qua khi lock) |
| `labelFilters` | `label_ids` |
| `propertyFilters` | properties map (`__none__` = unset) |
| `dateFilter` | created_at / updated_at from–to |

Date và `agentRunningFilter` không (hoặc ít) persist — giữ quy ước Multica session-only nếu store đang làm vậy.

## 8. Lỗi và stub

| Tình huống | Hành vi |
| --- | --- |
| Capability thiếu | Disabled + tooltip/`reason_code`; không ẩn; không gọi API thiếu |
| Property archived/missing | Strip khỏi query; không chip ma |
| Facet fail | Menu vẫn dùng; count ẩn/0 |
| Server 400 filter | Error UI hiện có; giữ store |
| Empty sau filter | Empty “không khớp bộ lọc” qua `t()` |
| Baseline lệch catalog | Fixed checked-disabled; orphan → count hoặc ẩn property chip |
| `lockProjectFilter` | Không đổi/clear project; không đếm chip project |

## 9. Kiểm thử và DoD

| Tầng | Cover |
| --- | --- |
| Unit `filter.ts` | Positive selection; no-assignee/project; label OR; property + `__none__`; hide sub-tasks; agentRunning |
| Unit baseline | Delta; clear → baseline; clear all → raw |
| Unit `mapStoreToTableFilter` | Drop empty; lock project; fingerprint ổn định |
| Go `tablequery` + handler | Mỗi chiều mới; facets; workspace isolation |
| Component | Menu submenu; stub reason; chips; wired flag |
| E2E hẹp | Bỏ `filters_not_wired`; smoke add/clear filter `/tasks` (+ `/my-tasks` nếu sẵn) |
| Contract / parity | Path `filter.ts`; malformed facets degrade |

**DoD:** UniAI UNI-702 → spec (file này) → plan → nhánh `feature/UNI-702-…` → TDD + test hẹp từng lớp → PR gắn issue. **Không** bắt buộc `make check` / `check-full`.

## 10. Rủi ro

| Rủi ro | Giảm |
| --- | --- |
| Table lọc client → sai total/page | Bắt buộc mở rộng server filter trước khi coi table “parity” |
| Scope phình (squad runtime) | Stub cứng; không block ship filter lõi |
| Menu file quá lớn (Multica header ~2k dòng) | Tách module filter menu/chips dưới `views/tasks/views/` hoặc `filters/`; tôn `max-lines` |
| Brand Multica sót | `no-usf-leak` + i18n UniWork |

## 11. Thứ tự triển khai gợi ý (plan sẽ chi tiết)

1. `filter.ts` + tests (RED→GREEN).
2. Baseline helpers + chip/menu baseline behavior.
3. Mở rộng `tablequery.Filter` + client `TableFilter` + Go tests.
4. `TaskFilterMenu` full + bật `TASK_FILTERS_WIRED`.
5. Wire surface controller (board/list/… + table).
6. Facets + stubs + e2e hẹp + parity inventory.
7. Plan sub-issues nếu plan tách pha.
