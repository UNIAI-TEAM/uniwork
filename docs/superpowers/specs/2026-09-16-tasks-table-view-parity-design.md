# UniWork — View Bảng của Công việc ngang usf

> **Trạng thái:** in-progress — PR1 (sửa treo) đã commit trên nhánh `feature/UNI-654-…`; PR2–PR4 theo plan `../plans/2026-09-16-tasks-table-view-parity.md`

**Ngày:** 2026-09-16
**Issue:** UNI-654 (sub-issue của UNI-426 · F-05 Tasks parity)
**Baseline đối chiếu:** repo `usf` (issue table: `server/internal/handler/issue_table_{query,rows,group,facets}.go`, `packages/views/issues/components/table-view.tsx`)
**Quyết định đã chốt với quangpd (2026-09-16):** sub-issue dưới UNI-426; cột thuộc tính tùy chỉnh làm đủ hiển thị + sửa trong ô; phân trang chuyển hẳn sang cursor như usf (board đổi theo); một spec, nhiều PR theo pha.

## 1. Bối cảnh và bằng chứng

### 1.1 Lỗi treo (đã sửa, PR1)

Chuyển sang view Bảng làm cả ứng dụng không phản hồi, ở mọi số lượng việc và mọi
kiểu nhóm. Đo bằng Playwright + CPU profile: `useQueries` trong
`use-table-view-data.ts` trả mảng mới mỗi render → `displayRows` mới → TanStack Table
dựng lại row model và `_autoResetPageIndex` ghi object `pagination` mới vào state
nội bộ của `useReactTable` → render lại. Vòng lặp đi qua microtask nên React không
báo lỗi. Sửa: `combine: pickPageStates` (như board) + `autoResetPageIndex: false`;
test `table-view-render-loop.test.tsx` ghim cả hai. Commit `5bbae89`.

### 1.2 Khoảng cách tính năng (đo trên mã)

| Hạng mục | usf | uniwork trước spec |
| --- | --- | --- |
| Sắp xếp | server, keyset | client, chỉ trên trang đã tải |
| Tìm kiếm | server (tiêu đề + số) | client, chỉ trang đã tải |
| Việc con | server, tải lười theo cha | dựng cây ở client; con khác trang bị mất lồng |
| Nhóm | none/status/assignee/project/property | status/assignee; project khóa cứng; `none` gửi `group_by=status` |
| Phân trang | cursor, `next_cursor` | offset; `branch_total = len(rows)` (sai), `next_cursor` luôn null |
| Cột thuộc tính | hiển thị + sửa 7 kiểu | bị lọc bỏ, luôn mờ |
| Đổi thứ tự cột | dnd-kit | không (store có `reorderTableColumn` nhưng UI không gọi) |
| Sửa trong ô | + dự án, ngày bắt đầu, agent | thiếu dự án, ngày bắt đầu; ép `assignee_kind: "human"` |
| Lỗi | retry theo nhánh, retry groups, 422 → none | thay cả bảng bằng một dòng chữ |
| Nhãn | trong payload | 1 request `/labels` cho MỖI dòng |
| Chọn dòng | — | `selectedIds` nằm trong `viewMeta` → tích 1 ô render lại mọi ô |
| E2E | 4 kịch bản | 0 |

`server/internal/service/task_table.go` 458 dòng (usf ~2.700); `table-view.tsx` 349
dòng (usf ~2.470).

## 2. Mục tiêu và ngoài phạm vi

**Mục tiêu:** view Bảng trên `/tasks` và trang dự án đúng với dữ liệu thật ở mọi quy
mô (sort/search/việc con đúng qua nhiều trang), đủ thao tác của usf phần con người
dùng, không treo, không N+1, có e2e.

**Ngoài phạm vi (cố ý):**
- Export CSV, nhóm kép (compound), nhóm theo `parent`.
- Lưu cấu hình view theo người dùng phía server (usf cũng chỉ local + view đã lưu).
- Bộ lọc nâng cao (nhãn, người tạo, khoảng ngày, thuộc tính) — thanh lọc là của cả
  surface, không riêng bảng; `filters_not_wired` giữ nguyên.
- Bảng trong "Việc của tôi" (vẫn ẩn như hiện tại).
- Index trigram cho tìm kiếm — thêm khi đo thấy chậm.
- Nhóm theo ưu tiên: usf không có, UniWork có sẵn ở server → **giữ và mở ở UI**.

## 3. Hợp đồng API bảng (thay thế, không tương thích ngược)

Ba route giữ nguyên đường dẫn: `POST /api/v1/workspaces/{ws}/tasks/table/{groups,rows,facets}`.
Body cũ (`offset`) bị bỏ; không lớp tương thích (CLAUDE.md § Coding Rules). Client và
server đổi cùng PR2.

### 3.1 Request

```jsonc
// chung cho groups / rows / facets
"query": {
  "filter": { "statuses": [], "priorities": [], "assignee_ids": [], "project_ids": [] },
  "search": "",                                   // cắt khoảng trắng; rỗng = không tìm
  "sort": { "field": "position", "direction": "asc" }
},
// groups + rows
"group_by": "none|status|priority|assignee|project|property:<id>",
// rows
"group_key": "<opaque>|null",                      // bắt buộc khi group_by != none, null khi none
"hierarchy": true,                                  // bật cây việc con
"parent_id": "<task id>|null",                      // chỉ hợp lệ khi hierarchy=true
"cursor": "<opaque>|null",
"limit": 50,                                        // 1..100, mặc định 50
// facets
"facets": ["status", "priority", "assignee", "project"]
```

- `columns` bị bỏ khỏi body (server trả cả task; nó chỉ làm lệch cache key).
- Trường lạ bị bỏ qua như mọi route khác (`decode` không bật `DisallowUnknownFields`); client cũ gửi `offset` chỉ nhận trang đầu.

**Sort** — `field ∈ {position, title, created_at, updated_at, start_date, due_date, status, priority, property:<id>}`:

| field | Biểu thức | Ghi chú |
| --- | --- | --- |
| `position` | `t.position` | luôn tăng dần, bỏ qua `direction` |
| `title` | `LOWER(t.title)` | |
| `created_at`, `updated_at` | cột | |
| `start_date`, `due_date` | cột | NULLS LAST cả hai chiều |
| `status` | `task_statuses.position` của workspace theo `key`, rồi rank category mặc định | status không có trong catalog xếp cuối |
| `priority` | rank cố định `urgent,high,medium,low,none` | |
| `property:<id>` | number → `(properties->>id)::numeric`; date/text/url/select → `NULLIF(properties->>id,'')`; select xếp theo **tên option** (tra config) | multi_select, checkbox, thuộc tính lưu trữ/không tồn tại → lùi về `position`; NULLS LAST |

Tiebreak luôn `t.created_at DESC, t.id DESC`.

**Search**: tách theo khoảng trắng, mỗi từ phải khớp `LOWER(t.title) LIKE '%từ%'`
(escape `%`, `_`, `\`), HOẶC toàn chuỗi là số / `<PREFIX>-<số>` thì `t.number = N`.

**group_key** (mờ, client gửi lại nguyên văn):

| group_by | key |
| --- | --- |
| status | `status:<key>` |
| priority | `priority:<p>` |
| assignee | `assignee:none` \| `assignee:<human\|agent>:<id>` |
| project | `project:none` \| `project:<id>` |
| property (select) | `property:<pid>:none` \| `property:<pid>:v:<base64url(option id)>` |
| property (checkbox) | `property:<pid>:none` \| `property:<pid>:v:<base64url("true"\|"false")>` |

Nhóm theo thuộc tính kiểu khác, thuộc tính lưu trữ hoặc không tồn tại → **422**
`{"code":"unsupported_group"}`.

### 3.2 Membership và việc con

`membership(t)` = thuộc workspace/tổ chức ∧ filter ∧ search ∧ vị từ của `group_key`.

- `hierarchy=false`: rows = mọi `t` thuộc membership (mọi cấp).
- `hierarchy=true`, `parent_id=null` (dòng gốc): `t.parent_task_id IS NULL` **hoặc**
  cha không thuộc membership. Việc con khớp lọc mà cha không khớp (hoặc cha ở nhóm
  khác) hiện thành dòng gốc.
- `hierarchy=true`, `parent_id=X`: `t.parent_task_id = X` ∧ `X` thuộc membership ∧ `t` thuộc membership.
- `direct_child_count` = số con **thuộc membership**.

### 3.3 Cursor

- base64url không padding của JSON `{v:1, fp, group_key, parent_id, sort_value, sort_null, created_at, id}`.
- `fp` = `sha256` hex của JSON chuẩn hóa: workspace id + query (mảng filter đã sort, bỏ trùng; search đã trim) + group_by + hierarchy.
- Keyset `(sortExpr, created_at DESC, id DESC)` có xử lý NULLS LAST; server lấy `limit+1` để quyết định `next_cursor`.
- `fp`/`group_key`/`parent_id` lệch → **409** `cursor_query_mismatch`; cursor hỏng → **400** `invalid_cursor`.
- Groups không phân trang (số nhóm nhỏ: status/priority/project/assignee/option); `next_cursor` luôn `null`, giữ trường để client ổn định.

### 3.4 Response

- **groups**: `{query_fingerprint, total, groups:[{key, value, count}], next_cursor:null}`;
  `value` = `{kind, status?, priority?, actor?{type,id}, project_id?, property_id?, option?}`;
  `total` = số việc thuộc query (không tính vị từ nhóm).
  Thứ tự nhóm: status theo catalog; priority theo rank; assignee: có người trước theo tên, `none` cuối; project theo tên, `none` cuối; property theo thứ tự option, `none` cuối.
- **rows**: `{query_fingerprint, group_key, parent_id, total, rows:[{task, direct_child_count, labels:[{id,name,color}]}], next_cursor}`;
  `total` = số dòng của **nhánh** (dòng gốc của nhóm, hoặc con của `parent_id`) — tính ở mọi trang, dùng cho "Hiển thị 50/120". Bỏ `branch_total`.
- **facets**: như hiện tại, thêm `project`; mỗi facet bỏ chiều của chính nó (disjunctive); áp cả `search`.
- Đếm và lấy trang chạy trong một transaction `REPEATABLE READ READ ONLY`.

### 3.5 Tầng dữ liệu (ADR 0020)

Sort/keyset/JSONB/hierarchy động không viết gọn bằng sqlc tĩnh (mỗi field × chiều ×
hierarchy = hàng chục query). Dựng SQL trong **`server/pkg/db/tablequery/`**:

- Chỉ nhận struct đã chuẩn hóa từ service; mọi giá trị là tham số `$n`; tên cột/biểu
  thức chỉ từ whitelist trong package.
- Mọi câu luôn bắt đầu bằng `t.organization_id = $1 AND t.workspace_id = $2`.
- Chỉ `server/internal/service/task_table*.go` được import package này
  (`server/internal/arch_test.go`); test builder ghim mệnh đề tenant có mặt ở mọi câu.
- Service vẫn gọi `RequireMember` trước (ADR 0008).

## 4. Client core

- `packages/core/api/endpoints/tasks-table.ts`: schema/kiểu mới, test malformed cho cả ba endpoint (degrade, không throw); map lỗi 409/422 thành `ApiError` có `code`.
- `packages/core/tasks/surface/table-query.ts`: builder body mới; cache key = JSON của body (thứ tự trường cố định) — board và bảng cùng tham số vẫn chung một entry.
- Phân trang cursor dùng chung: `useCursorBranches` (views) giữ, mỗi nhánh, danh sách cursor `[null, c1, c2…]`; trang n+1 lấy `next_cursor` của trang n. Khi trang đầu của nhánh refetch xong mà `dataUpdatedAt` đổi → cắt về `[null]` (bỏ trang đuôi cũ để không trùng/hụt dòng). Query đổi (filter/search/sort) → mọi nhánh về `[null]`. Kết quả `useQueries` luôn qua `combine` ổn định.
- Board (`use-board-columns-data.ts`) chuyển sang `useCursorBranches` với `group_by=status`, `hierarchy=false`.
- Realtime: giữ invalidate `tableRoot`; `realtime-task-patch.ts` vá task trong entry rows mới (row có thêm `labels`, không đụng).
- 409 `cursor_query_mismatch` → reset nhánh về `[null]` một lần.

## 5. View Bảng

### 5.1 Dữ liệu
- `use-table-view-data.ts` viết lại trên `useCursorBranches`: nhánh = `(group_key, parent_id)`. Nhóm thu gọn không tạo nhánh. **Cha mặc định đóng** (khác usf mở sẵn): mở sẵn nghĩa là một request con cho mỗi cha trên màn hình; người dùng bấm mở thì mới tạo nhánh con. Store lưu danh sách cha **đang mở** (bump version store, xóa trạng thái cũ). Một task chỉ hiện một lần.
- Bỏ `sortTasksForTable` và lọc search ở client (server làm).
- Search: ô tìm kiếm debounce 300 ms; đang tải hiện chỉ báo nhỏ, giữ dữ liệu cũ (`placeholderData`) để bảng không nhấp nháy.
- `showSubTasks=false` → gửi `hierarchy=false`, hiển thị phẳng mọi việc khớp (không lồng).

### 5.2 Nhóm
Menu: Không nhóm / Trạng thái / Ưu tiên / Người phụ trách / Dự án / (mỗi thuộc tính select hoặc checkbox chưa lưu trữ). Bỏ `projectGroupingDisabled` cứng ở `table-view.tsx`. 422 → `setTableGrouping("none")` + toast. Nhãn nhóm: dự án theo tên, agent theo tên agent, option theo tên + màu.

### 5.3 Cột
- **Thuộc tính tùy chỉnh**: `property:<id>` hiển thị giá trị và sửa trong ô bằng `PropertyValueEditor` mới ở `packages/views/tasks/properties/` (text, number, url: input inline; select, multi_select: picker có màu; date: DateField; checkbox: toggle). Lưu qua hook mới `useSetTaskPropertyValue` / `useUnsetTaskPropertyValue` trong `packages/core/tasks/hooks-catalog.ts` (endpoint `putTaskPropertyValue`/`deleteTaskPropertyValue` đã có), optimistic vá task trong entry rows + detail, invalidate `tableRoot` khi settle. Thuộc tính lưu trữ: read-only, chỉ Xóa giá trị. Bộ chọn cột mở mục thuộc tính (bỏ `propertiesDisabled` mặc định).
- **Kéo đổi thứ tự** header: dnd-kit (`PointerSensor` distance 5 theo luật repo, `KeyboardSensor`), trục ngang, tiêu đề + cột chọn cố định; drop → `reorderTableColumn`. Nút kéo có `aria-label`, kéo bằng bàn phím được.
- **Sửa trong ô**: thêm dự án (picker dự án), ngày bắt đầu (DateField); người phụ trách dùng danh sách thành viên + agent của workspace (như properties sidebar), gửi đúng `assignee_kind`.
- **Header sort**: menu tăng/giảm cho mọi cột sort được (không multi_select/checkbox).

### 5.4 Lỗi và trạng thái
- Nhánh lỗi: dòng "Không tải được · Thử lại" tại vị trí nhánh (refetch prefix key nhánh). Groups lỗi: bảng hiện trạng thái lỗi có nút Thử lại (không phải chữ trơn).
- Tải lần đầu: skeleton; đổi query: giữ dữ liệu cũ + chỉ báo đang làm mới.
- Rỗng do search: "Không có việc khớp '<từ khóa>'" + nút xóa tìm kiếm.

## 6. Giao diện và hiệu năng

- Đường kẻ ô dùng `border-border/60` (ngang) và bỏ kẻ dọc trừ ranh giới cột ghim; header nền như hiện tại. Kiểm tương phản sáng/tối bằng e2e contrast hiện có.
- Độ rộng mặc định: ưu tiên 128px, trạng thái 148px, người phụ trách 176px, ngày 128px (không cắt "Trung bình", "Chưa giao").
- Nút mở rộng việc con: vùng bấm 24×24 (44px trên coarse pointer theo contract primitive), icon 14px, `aria-expanded`.
- Chiều cao dòng cố định 40px khớp `virtualRowHeight`.
- Vùng cuộn có `padding-bottom` bằng chiều cao thanh thao tác hàng loạt khi đang chọn → không che "Tải thêm".
- Nhãn lấy từ `rows[].labels`; `TableLabelsCell` bỏ `useLabelsOnTask`; gắn/gỡ nhãn vá rows + invalidate.
- Chọn dòng: `selectedIds` ra khỏi `viewMeta`; ô checkbox tự subscribe qua `useSyncExternalStore` trên selection (`isSelected(id)`), header subscribe trạng thái all/some. Tích một dòng chỉ render lại ô đó + header + toolbar.
- Ngân sách: bảng 120 việc, mở từ board → long task tích lũy < 1 s trong 3 s đầu; tích 1 checkbox → commit < 50 ms (đo trong e2e bằng PerformanceObserver, ngưỡng lỏng để không flake).

## 7. Kiểm thử

| Tầng | Nội dung |
| --- | --- |
| Go `pkg/db/tablequery` | SQL sinh ra cho từng sort/hierarchy/group; mệnh đề tenant luôn có; không nối chuỗi giá trị người dùng |
| Go `service` (DB thật) | sort mọi field × chiều qua 3 trang không trùng/hụt; search nhiều từ + số hiệu; hierarchy gốc/con/cha ngoài membership; group project/priority/property select+checkbox; 422; 409; `total` nhánh; nhãn trong rows; cách ly hai tổ chức |
| Go `handler` | 400 cursor hỏng, 409, 422, openapi có SDI/SDO mới |
| core | schema + malformed cho 3 endpoint; builder body/key; hooks property value |
| views | `useCursorBranches` (nối cursor, cắt đuôi khi trang đầu đổi, reset khi query đổi, combine ổn định); bảng: sort header gửi đúng body, search debounce, mở cha tải con, nhóm dự án/ưu tiên/thuộc tính, 422 → none, editor thuộc tính 7 kiểu, reorder bằng bàn phím, retry nhánh, render-loop guard, chọn dòng không render lại ô khác; board vẫn qua test hiện có |
| e2e `e2e/tasks-table.spec.ts` | 120 việc (có con, 2 dự án, 1 thuộc tính select): chuyển board→bảng không treo; sort tiêu đề đúng qua "Tải thêm"; search thấy việc ngoài trang 1; con ở trang khác lồng đúng dưới cha; nhóm dự án + ưu tiên; sửa thuộc tính trong ô; đổi thứ tự cột bằng bàn phím và còn sau reload; bấm được điều hướng sau mọi bước |

## 8. Chia PR

| PR | Nội dung | Cổng |
| --- | --- | --- |
| PR1 | Sửa treo (§1.1) | đã commit |
| PR2 | ADR 0020 + `tablequery` + service/handler/SDI/SDO API mới + core client + `useCursorBranches` + board & bảng chạy trên API mới **với tính năng hiện có** (sort/search chuyển server ngay vì client-sort bị bỏ) | `make check` |
| PR3 | §5: nhóm mới, việc con lười, cột thuộc tính + editor, reorder, editor dự án/ngày bắt đầu/agent, lỗi + retry | `make check` |
| PR4 | §6 giao diện + hiệu năng (nhãn trong rows đã ở PR2, bỏ N+1 ở PR4), e2e §7 | `make check` + e2e chạy 2 lần |

## 9. Rủi ro

- **UNI-648** (tạo việc: editor thuộc tính) chạy song song: editor đặt ở `packages/views/tasks/properties/` để dùng chung; ai merge sau rebase và gộp về một editor.
- Keyset theo `status` cần join catalog: thêm index nếu đo `EXPLAIN` thấy seq scan trên workspace > 10k việc (migration CONCURRENTLY riêng).
- Board đổi phân trang: test board hiện có là lưới an toàn; giữ nguyên hành vi hiển thị cột.
