# Task human-parity lát D2 — list, board và My Tasks không còn cắt câm ở 50 task

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** shipped — lát D2 của spec ô Task human-parity (2026-09-14). `make check` dừng ở `scripts/governance.test.mjs` ("commit-msg would reject commits already in history", subject `Enhance UI components…`, lỗi nền do commit `e88a055` đã ghi ở plan). Các bước trước đó xanh: typecheck, lint, knip, `pnpm test` (core 127 files / 871 tests, views 259 / 1581, ui 16 / 186; coverage core 62.56/60.52/50.68/63.75 → sàn 62/60/50/63; views 64/56.81/57.37/65.96 → sàn 64/56/57/65), i18n parity. Sau đó chạy tay migrate + `scripts/test-go.sh --race`: mọi package xanh trừ `TestChatFollowUpHTTP` (lỗi nền đã biết, không của lát này); `internal/service` xanh gồm realtime patch. Kiểm tay app với >60 task chưa chạy (xem spec §7sexies mục 4).

**Goal:** Mọi task khớp bộ lọc đều tới được tay người dùng ở list, board, swimlane, Gantt và My Tasks, bằng cuộn tải thêm ở list và board như bảng đang làm, và không chế độ nào im lặng giấu task.

**Architecture:** Không đổi server. List và My Tasks chuyển sang `useInfiniteQuery` trên hai endpoint đã trả `total`, `limit`, `offset`. Board chuyển sang API bảng (`tableGroups` để có số đếm từng cột, `tableRows` theo `group_key` để tải từng cột), vì đó là API duy nhất phân trang được theo cột. Cập nhật lạc quan khi kéo thả trên board, khuôn chuẩn trong `CLAUDE.md`, được mở rộng sang cache của API bảng.

**Tech Stack:** TypeScript strict, React 19, TanStack Query v5 (`useInfiniteQuery`, `useQueries`), `react-virtuoso`, dnd-kit, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (mục 3.1 lát D, "Cuộn vô hạn cho list và board, ngang mức bảng đang có"). Dữ kiện tiền kiểm: `.superpowers/sdd/2026-09-13-tasks-human-parity-slice-c/slice-d-research.md`, mục "PHÁT HIỆN LỚN NHẤT CHO LÁT D".

## Phát hiện đổi hình dạng lát này

Spec gọi đây là tiện nghi. Tiền kiểm cho thấy đây là **lỗi mất dữ liệu người dùng thấy được**, có từ trước mọi lát của spec này:

| Chế độ | Nguồn dữ liệu hôm nay | Hệ quả |
| --- | --- | --- |
| List | `useQueryTasks(ws, queryBody)`; `planSurfaceQuery` trả `queryBody: {}` hoặc `{ project_id }` (`packages/core/tasks/surface/query-plan.ts:32-41`) | Không gửi `limit` → server mặc định 50 |
| Board | `useGroupedTasks(ws, { group_by: "status" })` (`packages/views/tasks/surface/use-task-surface-controller.ts:211-217`) | Server lấy 50 task đầu **của cả workspace** rồi mới chia cột, không trả tổng (`server/internal/service/task_query.go:116-152`) |
| My Tasks | `useMyTasks(ws, { relation })` | Mặc định 50 (`server/internal/service/task_graph.go:49-50`) |
| Gantt, swimlane | Cùng `surfaceTasks` với list hoặc board | Thiếu y như nguồn của chúng |
| Bảng | API bảng, phân trang theo nhánh (`modes/use-table-view-data.ts`, `TABLE_PAGE_SIZE = 50` ở `modes/table-view-model.ts:310`) | Đúng |

`defaultTaskQueryLimit = 50`, `maxTaskQueryLimit = 200` (`task_query.go:12-13`).

`packages/views/tasks/surface/use-task-group-branches.ts` là stub, và comment của nó nói rõ: giữ tắt cho tới khi API bảng có nhóm phụ cho swimlane. **Plan này không đụng stub đó.**

## Global Constraints

- Không đụng `server/`. Mọi endpoint cần dùng đã tồn tại và đã trả tổng.
- TanStack Query sở hữu server state. Khoá query đến từ factory `taskKeys` (`packages/core/tasks/keys.ts`); khoá phạm vi workspace luôn chứa workspace id. Khoá mới phải nằm **dưới** các gốc đang bị invalidate (`queryRoot`, `myTasks`, `tableRoot`, `groupedRoot`), nếu không realtime và mutation sẽ không làm mới chúng.
- WebSocket chỉ invalidate, không bao giờ ghi payload vào cache (`packages/core/realtime/use-realtime-sync.test.tsx` ghim điều này).
- Cập nhật lạc quan chỉ khi đủ bốn điều kiện trong `CLAUDE.md`. Kéo thả trạng thái/vị trí trên board là khuôn chuẩn và phải giữ nguyên hành vi.
- `packages/views/` test mock transport (`@uniwork/core/api/http`, `packages/views/test/api-mock.tsx`), không mock `next/*`, không mock hook core.
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng (`max-lines`). `use-task-surface-controller.ts` đã lớn; nếu sửa đẩy nó quá giới hạn, tách hook dữ liệu ra file riêng trong cùng task.
- Mọi JSX text node qua `t()`. Khoá i18n mới ở **cả** `vi.json` và `en.json`, cùng đường. Khoá có đếm dùng `_one` / `_other`.
- Không export, file hay dependency thừa: `pnpm knip`.
- Sàn coverage chỉ đi lên, chỉ nâng ở package lát này kiếm được. Hiện: views 61/53/54/63, core 58/53/47/60.
- Tiền tố commit theo `CLAUDE.md`. Không push, không PR, không `make issue-pr`.
- **Chạy lệnh:** gọi vitest trực tiếp (`cd packages/<pkg> && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run <files>`); coverage views chạy một mình với `--maxWorkers=2`; mọi lệnh chạy tiền cảnh với timeout rõ ràng.
- **Lỗi nền đã biết, không phải của bạn:** "Group _r_2_ not found" (`layout/animated-right-sidebar.tsx:83`); `markdown-paste.test.ts` timeout dưới coverage; `project-detail-page.test.tsx` đỏ dưới tải; `governance.test.mjs` vì `e88a055`; Go `TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`, `TestAIEndpoints`, `TestAskCitesOnlyPermittedSources`, `TestSearchScoringOverdueAndMembers`, `TestTaskCRUD`.

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `packages/core/tasks/keys.ts` (sửa) | Khoá cho truy vấn vô hạn, dưới gốc có sẵn |
| `packages/core/tasks/hooks-suite.ts` (sửa) | `useInfiniteQueryTasks`, `useInfiniteMyTasks` |
| `packages/views/tasks/surface/use-task-surface-data.ts` (sửa) | Trả trang đã tải, tổng, `hasMore`, `loadMore` |
| `packages/views/tasks/surface/use-board-columns-data.ts` (mới) | Dữ liệu board theo cột trên API bảng |
| `packages/core/tasks/hooks.ts` (sửa) | Cập nhật lạc quan vá cả cache `tableRows` |
| `packages/views/tasks/modes/list-view.tsx`, `board-column.tsx` (sửa) | `endReached` của Virtuoso gọi tải thêm; hàng trạng thái tải |
| `packages/views/tasks/modes/loaded-count-notice.tsx` (mới) | "Đang hiện N / M" và nút tải thêm cho chế độ không cuộn được (Gantt, swimlane) |

---

## Task 1: Hai truy vấn vô hạn trong core

**Files:**
- Modify: `packages/core/tasks/keys.ts`
- Modify: `packages/core/tasks/hooks-suite.ts`
- Test: `packages/core/tasks/hooks-suite.test.tsx` (sửa nếu có, tạo nếu chưa)

**Interfaces:**
- Produces:
  - `taskKeys.queryInfinite(wsId: string, filterHash: string)`, là mảng bắt đầu bằng đúng các phần tử của `taskKeys.queryRoot(wsId)`.
  - `taskKeys.myTasksInfinite(wsId: string, filterHash: string)`, bắt đầu bằng `taskKeys.myTasks(wsId)`.
  - `export const TASK_PAGE_SIZE = 50`
  - `useInfiniteQueryTasks(workspaceId: string, body: { status?: string; project_id?: string }): UseInfiniteQueryResult<InfiniteData<TaskQueryPage>>`
  - `useInfiniteMyTasks(workspaceId: string, opts: { relation?: MyTasksRelation }): UseInfiniteQueryResult<InfiniteData<TaskQueryPage>>`

- [ ] **Step 1: Đọc**

- `packages/core/tasks/keys.ts` toàn bộ.
- `packages/core/tasks/hooks-suite.ts:1-60`: `useQueryTasks`, `useMyTasks`.
- `packages/core/api/endpoints/tasks-suite.ts`: `queryTasks` (dòng 81, nhận `QueryTasksBody` ở dòng 27-32 với `status`, `project_id`, `limit`, `offset`) và `listMyTasks` (dòng 147, cũng trả `TaskQueryPage`). Controller đã kiểm: `TaskQueryPageSchema` ở `packages/core/types/task.ts:120-125` là `{ tasks, total, limit, offset }`, khớp `TaskPage` của server (`server/internal/service/task_query.go:26-31`).
- `packages/core/tasks/hooks-suite.ts:70-100`: danh sách khoá mà mutation invalidate.

- [ ] **Step 2: Viết test thất bại**

Dựng một `QueryClient` thật và mock transport trả trang theo `offset`, tổng 120 task:

1. Trang đầu gửi `limit=50&offset=0`.
2. `fetchNextPage` gửi `offset=50`, rồi `offset=100`.
3. Sau trang thứ ba, `hasNextPage` là `false`, và tổng số task gộp là 120 không trùng id.
4. Tổng 0: `hasNextPage` false, không gọi trang hai.
5. Server trả trang ngắn hơn `limit` mà `total` lại lớn hơn số đã tải (server trôi): dừng ở trang ngắn, không lặp vô hạn.
6. `invalidateQueries({ queryKey: taskKeys.queryRoot(ws) })` làm truy vấn vô hạn fetch lại. Chứng minh khoá nằm dưới gốc.

- [ ] **Step 3: Chạy đỏ**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/hooks-suite.test.tsx
```

- [ ] **Step 4: Viết mã**

```ts
export const TASK_PAGE_SIZE = 50;

function nextOffset(page: TaskQueryPage, pages: TaskQueryPage[]): number | undefined {
  const loaded = pages.reduce((sum, p) => sum + p.tasks.length, 0);
  // A short page means the server has nothing more, whatever `total` claims.
  if (page.tasks.length < TASK_PAGE_SIZE) return undefined;
  return loaded < page.total ? loaded : undefined;
}

export function useInfiniteQueryTasks(
  workspaceId: string,
  body: { status?: string; project_id?: string },
) {
  const hash = stableHash(body);
  return useInfiniteQuery({
    queryKey: taskKeys.queryInfinite(workspaceId, hash),
    queryFn: ({ pageParam }) =>
      suite.queryTasks(workspaceId, { ...body, limit: TASK_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => nextOffset(last, pages),
    enabled: !!workspaceId,
  });
}
```

Viết `useInfiniteMyTasks` cùng khuôn với `suite.listMyTasks`, truyền `relation` cùng `limit` và `offset`.

- [ ] **Step 5: Chạy xanh và commit**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/
git commit -m "feat(tasks): truy vấn vô hạn cho danh sách task và My Tasks"
```

---

## Task 2: List, My Tasks, Gantt và swimlane dùng dữ liệu phân trang

**Files:**
- Modify: `packages/views/tasks/surface/use-task-surface-data.ts`
- Modify: `packages/views/tasks/surface/use-task-surface-controller.ts` (chỗ đọc `data.surfaceTasks`, quanh dòng 102, 260-264, 448-477)
- Modify: `packages/views/tasks/modes/list-view.tsx` (Virtuoso quanh dòng 186)
- Create: `packages/views/tasks/modes/loaded-count-notice.tsx` và test
- Modify: `packages/views/tasks/modes/swimlane-view.tsx`, chế độ Gantt (tìm chỗ đọc `ganttCanvasRows` ở controller dòng 463)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/modes/list-view.test.tsx`, `packages/views/tasks/surface/task-surface.test.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces: `TaskSurfaceData` thêm `total: number`, `hasMore: boolean`, `isLoadingMore: boolean`, `loadMore: () => void`. `surfaceTasks` là mọi task đã tải, gộp các trang, không trùng id.

- [ ] **Step 1: Đọc**

`use-task-surface-data.ts` toàn bộ; `use-task-surface-controller.ts:95-120, 195-270, 440-480`; `list-view.tsx:150-230`; `swimlane-view.tsx` chỗ dựng lane từ task (tìm `taskMap`, `laneGroups`); và nơi render Gantt. Liệt kê trong báo cáo mọi nơi đọc `surfaceTasks`.

- [ ] **Step 2: Viết test thất bại**

Mock transport trả 120 task cho workspace:

1. List: lần render đầu hiện 50 hàng, gọi `endReached` của Virtuoso (hoặc cuộn tới cuối trong jsdom theo cách `list-view.test.tsx` đang giả lập Virtuoso) thì tải trang hai, cuối cùng đủ 120.
2. List: trong lúc tải thêm có hàng trạng thái có nhãn truy cập dịch; lỗi tải thêm hiện nút thử lại, không xoá 50 hàng đã có.
3. My Tasks: cùng ca 1 qua `useInfiniteMyTasks`.
4. Gantt và swimlane: có hơn 50 task thì hiện "Đang hiện 50 / 120" và nút tải thêm; bấm thì số tăng. Có đủ thì không hiện gì.
5. Bộ lọc dự án đổi thì bắt đầu lại từ trang đầu, không trộn task của dự án cũ.
6. `isEmpty` chỉ đúng khi tổng là 0, không phải khi trang đang tải.

- [ ] **Step 3: Chạy đỏ, viết mã, chạy xanh**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/modes/list-view.test.tsx tasks/modes/loaded-count-notice.test.tsx tasks/surface/task-surface.test.tsx tasks/modes/swimlane-view.test.tsx
```

`loaded-count-notice.tsx` dùng khoá có đếm `_one` / `_other`, nút là `Button` với `aria-disabled` khi đang tải, và vùng `aria-live="polite"`. Chỉ list dùng cuộn tải thêm; Gantt và swimlane dùng nút, vì lane và dòng thời gian không có "cuối danh sách" rõ ràng.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(tasks): list, My Tasks, Gantt và swimlane không còn giấu task quá 50"
```

---

## Task 3: Board tải theo cột trên API bảng

**Files:**
- Create: `packages/views/tasks/surface/use-board-columns-data.ts` và test
- Modify: `packages/views/tasks/surface/use-task-surface-controller.ts:211-217` (bỏ `useGroupedTasks` cho board)
- Modify: `packages/views/tasks/modes/board-column.tsx` (Virtuoso quanh dòng 241), `board-view.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` nếu cần

**Interfaces:**
- Consumes: `useTableGroups` (`packages/core/tasks/hooks-suite.ts:152`), `tableRows`, `taskKeys.tableRows`, `TABLE_PAGE_SIZE`.
- Produces:
  ```ts
  export interface BoardColumnState {
    status: string;
    count: number;        // server total for the column
    tasks: Task[];        // loaded pages, merged
    hasMore: boolean;
    isLoading: boolean;
    isLoadingMore: boolean;
    isError: boolean;
    loadMore: () => void;
    retry: () => void;
  }
  export function useBoardColumnsData(opts: { workspaceId: string; projectId?: string; enabled: boolean }): {
    columns: Record<string, BoardColumnState>;
    isLoading: boolean;
    isError: boolean;
  };
  ```

- [ ] **Step 1: Đọc**

- `modes/use-table-view-data.ts:60-300`: khuôn trang theo nhánh (`pagesByGroup`, `useQueries` trên `taskKeys.tableRows`, `loadMore`). Dùng lại cách dựng khoá **y hệt** để Task 4 vá được cùng cache.
- `packages/core/api/endpoints/tasks-table.ts`: `TableGroupsBody`, `TableRowsBody`, `TableRowsResult` (`total`, `branch_total`, `rows[].task`). Xác nhận `branch_total` hay `groups[].count` là tổng của một cột, và ghi lại.
- `board-view.tsx` và `board-column.tsx`: hiện đọc task theo cột từ đâu, số đếm ở tiêu đề cột lấy từ đâu.
- Nơi dự án lọc bảng: `query-plan.ts:24-29` (`filter: { project_ids: [projectId] }`).

- [ ] **Step 2: Viết test thất bại**

Mock transport: `tables/groups` trả ba cột `todo`=120, `in_progress`=3, `done`=0; `tables/rows` trả trang theo `group_key` và `offset`.

1. Mỗi cột tải trang đầu của riêng nó; cột `todo` hiện 50 thẻ, tiêu đề cột hiện 120.
2. Cuối cột `todo` gọi tải thêm chỉ cho `todo` (`group_key=todo`, `offset=50`); cột khác không fetch lại.
3. Cột rỗng không gọi `tables/rows`, hoặc gọi mà hiện trạng thái rỗng; chọn một và nói lý do.
4. Board ở phạm vi dự án gửi `filter.project_ids`.
5. Lỗi một cột chỉ hiện lỗi ở cột đó.
6. Board ở phạm vi My Tasks KHÔNG dùng API bảng. `query-plan.ts:15` ghi rõ API bảng chỉ theo workspace. Giữ board My Tasks trên dữ liệu Task 2 và nói rõ cách nó chia cột.

- [ ] **Step 3: Chạy đỏ, viết mã, chạy xanh**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/surface/use-board-columns-data.test.tsx tasks/modes/board-view.test.tsx tasks/modes/board-column.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(tasks): board tải từng cột qua API bảng, không cắt 50 task đầu workspace"
```

---

## Task 4: Kéo thả trên board vẫn cập nhật lạc quan

**Files:**
- Modify: `packages/core/tasks/hooks.ts:55-146`
- Test: `packages/core/tasks/hooks.test.tsx` (sửa nếu có, tạo nếu chưa)

**Interfaces:**
- Consumes: khoá `taskKeys.tableRows` do Task 3 dùng.
- Produces: không có API mới. Hành vi: move/update lạc quan vá cả mọi entry `tableRows` đang tải của workspace.

- [ ] **Step 1: Đọc**

`hooks.ts:55-146` toàn bộ: cách nó `cancelQueries`, chụp `prev`, `setQueryData` trên `taskKeys.list` và mọi entry `groupedRoot`, rồi rollback và invalidate. `CLAUDE.md` gọi đây là khuôn chuẩn của cập nhật lạc quan.

- [ ] **Step 2: Viết test thất bại**

QueryClient thật, cache `tableRows` có hai nhánh `todo` (task A, B) và `done` (C):

1. Kéo A sang `done`: ngay trong `onMutate`, nhánh `todo` còn B, nhánh `done` có A; `count` của hai nhánh đổi tương ứng nếu cache giữ số đếm.
2. Server lỗi: cả hai nhánh trở về y như trước.
3. Server thành công: `tableRoot` được invalidate, như dòng 146 đang làm.
4. Đổi vị trí trong cùng cột: thứ tự trong nhánh đổi ngay.
5. Entry `tableRows` của một bộ lọc khác, nơi task không có mặt, không bị chèn task vào.
6. Test hiện có cho cache `grouped` và `list` vẫn xanh.

- [ ] **Step 3: Chạy đỏ, viết mã, chạy xanh**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks/hooks.test.tsx
```

Chèn task vào nhánh đích chỉ khi nhánh đó đang tải trang đầu và vị trí mới rơi trong trang đã tải; nếu không, chỉ gỡ khỏi nhánh nguồn và để invalidate làm mới. Như vậy không bao giờ hiện một task ở chỗ server sẽ không trả nó.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(tasks): kéo thả board cập nhật lạc quan trên cache API bảng"
```

---

## Task 5: Cổng cuối và tài liệu

- [x] **Step 1: Cổng**

`NODE_OPTIONS="--no-experimental-webstorage" make check` một lần, tiền cảnh. Dừng ở lỗi nền thì chạy tay các bước sau theo `scripts/check.sh`. Lỗi ngoài danh sách thì chạy riêng hai lần; còn đỏ thì dừng và báo.

- [x] **Step 2: Kiểm bằng dữ liệu thật**

Chạy app (`make start`), tạo hơn 60 task trong một workspace thử bằng API, và xác nhận list, board, My Tasks, Gantt, swimlane đều tới được task thứ 60. Ghi kết quả từng chế độ vào báo cáo. Không làm được thì nói rõ và ghi lý do.

- [x] **Step 3: Coverage và i18n**

Coverage `core` và `views`, mỗi package chạy một mình. Nâng sàn chỉ ở package lát này kiếm được, chứng minh bằng `GATE_LEVEL=standard`. Chạy `packages/core/i18n/parity.test.ts`.

- [x] **Step 4: Tài liệu**

- Plan này: `shipped`, ghi trung thực `make check` chạy tới đâu.
- Spec: dòng trạng thái thêm "lát D2 shipped"; thêm `## 7sexies. Giới hạn đã biết của lát D2`, tối thiểu ghi: swimlane và Gantt dùng nút tải thêm thay vì cuộn; board My Tasks không phân trang theo cột; `use-task-group-branches.ts` vẫn là stub chờ nhóm phụ.
- Roadmap F-05: giữ `MỘT PHẦN`, nối câu "Lát D2/human-parity (...) shipped <ngày>".

- [x] **Step 5: Commit. KHÔNG mở pull request.**

```bash
git commit -m "chore(tasks): nâng sàn coverage và cập nhật trạng thái lát D2"
```

## Một chỗ plan này cố ý lệch khuôn

Task 1 có mã lõi đầy đủ. Task 2 đến 4 nêu interface chính xác và ca test cụ thể, nhưng không có khối mã viết sẵn cho phần view. Người viết plan chưa đọc cách `list-view.test.tsx` giả lập Virtuoso, chưa đọc nơi Gantt dựng dòng, và chưa đọc trường nào của `TableRowsResult` là tổng một cột. Mã đoán cho những chỗ đó sẽ trông thật mà sai. Mỗi task mở đầu bằng bước ĐỌC có file và dòng.

## Ghi chú cho người thực thi

- Thứ tự: Task 1 → Task 2; Task 3 → Task 4; Task 5 cuối. Nhánh 1-2 và nhánh 3-4 không chung file ngoài `use-task-surface-controller.ts`: làm Task 2 xong rồi mới Task 3 để tránh xung đột ở file đó.
- Đừng xoá `useGroupedTasks` hay endpoint `groupedTasks` nếu còn nơi khác dùng; kiểm bằng grep và `pnpm knip`.
- Lát D1 (`2026-09-13-tasks-human-parity-slice-d1.md`) không chạm các file của D2.
