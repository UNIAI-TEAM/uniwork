# Task human-parity lát E — vá cache từ frame realtime, có kiểm soát

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — lát E của spec ô Task human-parity

**Goal:** Khi một người sửa tiêu đề, trạng thái, độ ưu tiên hoặc ngày hạn của task, mọi người khác đang mở task đó thấy thay đổi ngay từ frame realtime, không chờ refetch, mà không bao giờ để cache mang một `revision` mới cùng dữ liệu cũ.

**Architecture:** Spec §2 chỉ chốt một câu: viết ADR cho phép vá cache từ frame realtime, có kiểm soát bằng catalogue; spec §4.3 đặt ba ràng buộc cho ADR đó. ADR 0015 ghi lại câu và ba ràng buộc ấy; cơ chế dưới đây (cột `Patch` và tập trường, guard hai revision, cách mã hoá giá trị, điều kiện tắt `Patch`) là lựa chọn của plan này và lượt tiền kiểm, chờ quangpd xác nhận ở review PR. Catalogue sự kiện có thêm cột `Patch` liệt kê chính xác trường client được vá. Server gửi các trường đó cùng `revision_before` và `revision` chỉ khi mọi trường có trong input của một lời gọi `updateTaskInTx` cho task đó đều thuộc tập vá được (có ít nhất một); không thì frame chỉ mang id. Client vá bản ghi đã có khi frame có ít nhất một khoá `Patch` và đủ hai revision, và `revision` trong cache khớp `revision_before`; list vẫn invalidate để giữ đúng thứ tự và thành viên.

**Tech Stack:** Go (pgx, sqlc, outbox dispatcher), TypeScript strict, TanStack Query, Vitest, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (§2 hàng "Độ trễ cảm nhận", §3.1 lát E, §4.3, §7). Dữ kiện tiền kiểm: `.superpowers/sdd/2026-09-14-tasks-human-parity-slice-e/research.md`.

## Phát hiện đổi hình dạng lát này

Spec phác lát E là "`planCacheUpdate` sinh `patch` thật". Tiền kiểm tìm ra hai điều khiến phác thảo đó nguy hiểm nếu làm thẳng.

1. **`revision` tăng theo từng câu query, không theo từng lần sửa.** `server/pkg/db/queries/tasks.sql` tăng `revision = revision + 1` ở dòng 43, 56, 67, 78, 222. `TaskService.updateTaskInTx` (`server/internal/service/task.go:328`, gọi từ `Update` và `BatchUpdateTasks`) luôn chạy `UpdateTask`, rồi chạy `SetTaskAssignee`, `SetTaskDueDate`, `SetTaskProjectID` cho mỗi trường có mặt trong input, dù giá trị có đổi hay không (`task.go:338-385`). Gắn và gỡ nhãn (`task_labels.sql:81,99`), bỏ dự án khỏi task khi xoá dự án (`projects.sql:147`) và thuộc tính tuỳ biến (`task_properties.sql:52,73`, có điều kiện) cũng tăng revision task; các command đó phát `task.updated` chỉ mang id. `task_collaboration.sql:33,51,64` tăng revision của bình luận, không phải của task. Guard kiểu "revision frame = cache + 1" gần như không bao giờ đúng.
2. **Guard lỏng làm mất dữ liệu.** Client lưu bằng revision trong cache (`packages/views/tasks/detail/hooks/use-task-field-save.ts` gửi `body.revision` và `If-Match`). Nếu cache nhận revision mới nhưng chỉ vá vài trường, trường khác (ví dụ mô tả) còn cũ mà revision đã khớp server; người dùng sửa mô tả cũ đó sẽ qua kiểm revision và ghi đè bản mới của người khác.

Vì vậy lát này dùng guard hai đầu (`revision_before`, `revision`) và chỉ vá khi frame mô tả **trọn** thay đổi của một lời gọi `updateTaskInTx` cho task đó (hai revision tính theo từng lời gọi, không theo transaction).

Tiền kiểm cũng xác nhận giả định an toàn của spec §4.3: quyền đọc task chỉ là thành viên workspace (`TaskService.authorizeActor`, `task.go:285-297`), nên frame workspace mang tiêu đề không lộ gì ngoài những gì người nhận vốn đọc được.

## Global Constraints

- Lát E chạy SAU lát D2. Nó vá các cache task mà D2 để lại; đọc `packages/core/tasks/keys.ts` ở HEAD, không đọc theo plan này.
- ADR trước, mã sau. Không commit mã server hay client của lát trước khi ADR 0015 đã commit.
- `audit_events` và `outbox_events` chỉ được ghi qua `server/internal/audit` (`TestAuditAndOutboxWritesGoThroughTheAuditPackage`). Không đổi luật đó.
- Payload outbox là `map[string]string` và `outbox/realtime_consumer.go` unmarshal vào đúng kiểu đó. Mọi giá trị là chuỗi; ngày ở dạng `YYYY-MM-DD`; trường nullable bị xoá gửi chuỗi rỗng. Giá trị không phải chuỗi làm `Handle` lỗi; dispatcher thử lại, và sau `MaxAttempts` (10) lần thì đưa hàng vào dead letter (`server/internal/outbox/outbox.go:33-35,195-200`), nên frame không bao giờ tới client.
- Catalogue tồn tại ba bản (`server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`); `scripts/events-catalogue.test.mjs` phải xanh ở mọi commit.
- Frame không bao giờ tạo bản ghi mới trong cache. `task.created` và `task.deleted` vẫn chỉ invalidate.
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng. Comment tiếng Anh. Không export thừa (`pnpm knip`).
- Go: `gofmt`, `go vet`, `staticcheck`, test DB qua `TEST_DATABASE_URL`. Chạy `scripts/test-go.sh --race` hoặc `go test -race` cho package chạm tới, tiền cảnh.
- Vitest gọi trực tiếp: `cd packages/<pkg> && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run <files>`. Chạy tiền cảnh, timeout rõ ràng.
- Sàn coverage chỉ nâng ở package lát này kiếm được. Go có `server/coverage.floor`, thi hành ở mọi mức gate.
- Commit local, tiền tố theo `CLAUDE.md`. Subagent không push, không mở PR.
- Lỗi nền đã biết: "Group _r_2_ not found"; `markdown-paste.test.ts` dưới coverage; `project-detail-page.test.tsx` dưới tải; `governance.test.mjs` vì `e88a055`; Go `TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`, `TestAIEndpoints`, `TestAskCitesOnlyPermittedSources`, `TestSearchScoringOverdueAndMembers`, `TestTaskCRUD` (song song).

## Cấu trúc file đích

| File | Trách nhiệm |
| --- | --- |
| `docs/adr/0015-va-cache-tu-frame-realtime-theo-catalogue.md` (mới) | Quyết định, đánh đổi, test giữ luật |
| `docs/adr/README.md` | Hàng chỉ mục 0015 |
| `CLAUDE.md` | Task 1: § Audit and Events và § Domain Reminders trỏ ADR 0015 (test: `scripts/events-catalogue.test.mjs`). Task 3: § State Rules, cùng commit với test giữ luật |
| `server/internal/outbox/catalogue.go` | `EventDef.Patch`; hàng `task.updated` |
| `docs/events/CATALOGUE.md` | Cột Patch |
| `scripts/events-catalogue.test.mjs` | Luật mới: payload là id hoặc revision; trường khác chỉ qua `Patch` |
| `server/internal/service/task.go` | Mỗi lời gọi `updateTaskInTx` (từ `Update` và `BatchUpdateTasks`) phát trường vá kèm `revision_before`, `revision` khi mọi trường có trong input thuộc `Patch`; không thì chỉ id |
| `server/internal/audit/audit.go` | Comment của `Event` nói đúng luật mới |
| `packages/core/tasks/cache-coordinator.ts` | Kế hoạch vá cho `task.updated` |
| `packages/core/tasks/realtime-task-patch.ts` (mới) | Vá bản ghi task trong mọi cache đã có, theo guard revision |
| `packages/core/realtime/use-realtime-sync.ts` | Áp kế hoạch vá trước khi invalidate |

---

## Task 1: ADR 0015 và hợp đồng catalogue

**Files:**
- Create: `docs/adr/0015-va-cache-tu-frame-realtime-theo-catalogue.md`
- Modify: `docs/adr/README.md`
- Modify: `server/internal/outbox/catalogue.go`
- Modify: `docs/events/CATALOGUE.md`
- Modify: `scripts/events-catalogue.test.mjs`
- Modify: `CLAUDE.md` (§ Audit and Events, § Domain Reminders; KHÔNG § State Rules — xem Task 3)
- Modify: `server/internal/audit/audit.go` (comment của `Event`)

**Interfaces:**
- Produces: `EventDef.Patch []string`; hàng `task.updated` với `Payload: []string{"task_id", "workspace_id", "revision_before", "revision"}` và `Patch: []string{"title", "status", "priority", "due_date"}`.

- [ ] **Step 1: Đọc**

`docs/adr/README.md` (định dạng: Bối cảnh, Quyết định, Hệ quả, Trạng thái; không sửa ADR `accepted`), `docs/adr/0009-audit-va-outbox-cung-transaction.md` làm khuôn giọng văn và dòng Trạng thái, `scripts/events-catalogue.test.mjs` toàn bộ (regex hàng Go một dòng), `scripts/governance.test.mjs` các test về ADR và đường dẫn trong `CLAUDE.md`.

- [ ] **Step 2: Viết test thất bại trong `scripts/events-catalogue.test.mjs`**

> **Đã chạy (commit `aae3f8c`, `ac3f52c`, `9ceab13`).** Khối mã và mô tả của bước này là bản gốc và còn hai lỗi đã sửa sau review: kiểm `continue` của hàng hạ tầng chạy trước luật khoá revision, và bộ đọc Go không bỏ comment. Chạy lại task này thì lấy `scripts/events-catalogue.test.mjs` đã commit làm chuẩn, không chép khối mã dưới.

Thay khẳng định "payload keys are ids" bằng ba khẳng định:

```js
const REVISION_KEYS = new Set(["revision", "revision_before"]);

test("payload keys are ids or revisions; content travels only through Patch", () => {
  for (const { topic, payload, patch, scope } of goCatalogue()) {
    if (scope === "-") continue;
    for (const key of payload) {
      assert.ok(
        /(_id|^version$)$/.test(key) || REVISION_KEYS.has(key),
        `${topic} carries payload key "${key}"; payloads are ids or revisions (ADR 0015)`,
      );
    }
    if (patch.length === 0) continue;
    assert.equal(topic, "task.updated", `${topic} declares Patch; only task.updated may (ADR 0015)`);
    assert.ok(payload.includes("revision_before") && payload.includes("revision"),
      `${topic} declares Patch without revision_before and revision`);
  }
});

test("the patchable task fields are exactly the ones ADR 0015 accepted", () => {
  const row = goCatalogue().find((r) => r.topic === "task.updated");
  assert.deepEqual([...row.patch].sort(), ["due_date", "priority", "status", "title"]);
});
```

Sửa `goCatalogue()` để regex chấp nhận `Patch: []string{...}` tuỳ chọn giữa `Payload` và `Scope`, và mọi hàng khác vẫn parse. Sửa bộ đọc `CATALOGUE.md` để đọc cột Patch (`—` là rỗng) và test so khớp Go↔Markdown so cả `patch`. Chạy `node --test scripts/events-catalogue.test.mjs`: đỏ.

- [ ] **Step 3: Viết ADR 0015**

Tiếng Việt, bốn mục bắt buộc cộng mục "Test giữ luật" như ADR 0009. Dòng trạng thái: xem dòng 3 của `docs/adr/0015-va-cache-tu-frame-realtime-theo-catalogue.md` đã commit, và giữ nguyên dòng đó, không viết lại theo dạng cũ. Dòng đó chỉ ghi công quangpd câu spec §2 (viết ADR cho phép vá cache từ frame realtime, có kiểm soát bằng catalogue), và nêu ba ràng buộc do spec §4.3 đặt. Mọi lựa chọn khác trong ADR (tập trường vá và trường không vá, guard hai revision, mã hoá giá trị, trang chi tiết không refetch, điều kiện tắt `Patch`, cần ADR mới để mở thêm, giữ `Version` 1) nó ghi là của plan, của tiền kiểm mã hoặc suy luận của agent khi viết ADR, chờ quangpd xác nhận ở review PR.

Quyết định phải nêu đủ:
1. Chỉ hàng catalogue có `Patch` mới mang trường nội dung; `Patch` là nguồn sự thật duy nhất. Hôm nay chỉ `task.updated`, bốn trường `title`, `status`, `priority`, `due_date`.
2. Không vá `assignee_*` (task mang actor do server phân giải), `position`, `project_id`, `description`.
3. Server gửi trường vá cùng `revision_before` và `revision` chỉ khi mọi trường có trong input của một lời gọi `updateTaskInTx` cho task đó thuộc tập vá được (có ít nhất một); không thì frame chỉ mang id. Hai revision tính theo từng lời gọi cho từng task, không theo cả transaction.
4. Client chỉ vá bản ghi đã có khi frame có ít nhất một khoá `Patch` và đủ hai revision, và `revision` trong cache bằng `revision_before`; trường lạ bị bỏ; frame không tạo bản ghi; list vẫn invalidate.
5. Đánh đổi viết thẳng: `outbox_events` chuyển từ sổ sự kiện thành kênh mang một phần nội dung; quyền đọc task hôm nay là thành viên workspace (`TaskService.authorizeActor`) nên người nhận frame vốn đọc được; nếu sau này có task hạn chế quyền đọc hẹp hơn workspace thì phải tắt `Patch` hoặc đổi phạm vi phát trước.
6. Hệ quả: guard lỏng hơn làm mất dữ liệu (giải thích kịch bản ghi đè mô tả); vì sao `revision_before` phải tính trong transaction.

Thêm hàng 0015 vào bảng `docs/adr/README.md`.

- [ ] **Step 4: Sửa catalogue và tài liệu**

- `catalogue.go`: thêm trường `Patch []string` vào `EventDef` với comment tiếng Anh trỏ ADR 0015; hàng `task.updated` như Interfaces. Giữ mỗi hàng trên một dòng.
- `CATALOGUE.md`: thêm cột Patch cho mọi hàng (`—` khi rỗng) và một đoạn ngắn trỏ ADR 0015.
- `audit/audit.go`: comment của `Event` nói payload là id, trừ trường một hàng catalogue khai ở `Patch` (ADR 0015).
- `CLAUDE.md`: CHỈ sửa § Audit and Events và § Domain Reminders. Lấy câu chữ ĐÃ COMMIT làm chuẩn (commit `42f3c57` và vòng sửa sau), không viết lại theo mô tả cũ: payload phía client chỉ mang id, trừ trường một hàng catalogue khai ở `Patch` cùng cặp `revision_before`/`revision`; hàng hạ tầng nằm ngoài luật; nêu `scripts/events-catalogue.test.mjs`. KHÔNG sửa State Rules ở task này: luật "frame không bao giờ ghi vào cache" vẫn đúng cho tới Task 3, và `CLAUDE.md` chỉ ghi luật có test giữ.

- [ ] **Step 5: Chạy và commit**

```bash
node --test scripts/events-catalogue.test.mjs scripts/governance.test.mjs
cd server && go build ./... && go vet ./internal/outbox/ ./internal/audit/
```

`governance.test.mjs` chỉ được đỏ đúng một test nền (commit `e88a055`). Không chạy test Go dài ở task này.

```bash
git commit -m "docs: ADR 0015 vá cache từ frame realtime theo catalogue"
```

Nếu hook commit-msg đòi tách, dùng hai commit: `docs` cho ADR, `CLAUDE.md`, README; `feat(realtime)` cho catalogue và test.

---

## Task 2: Server phát trường vá kèm hai revision

**Files:**
- Modify: `server/internal/service/task.go` (hàm `updateTaskInTx`, gọi từ `Update` và `BatchUpdateTasks`)
- Test: `server/internal/service/task_realtime_patch_test.go` (mới)

**Interfaces:**
- Consumes: Task 1 (hàng `task.updated` có `Patch`).
- Produces: payload `task.updated` từ mỗi lời gọi `updateTaskInTx` (`task.go:397`; người gọi: `Update` và `BatchUpdateTasks` ở `task_mutations.go:106-152`): luôn có `task_id`, `workspace_id`; khi mọi trường có trong input của lời gọi đó thuộc tập vá được và có ít nhất một trường, có thêm những trường `title`, `status`, `priority`, `due_date` có trong input cùng `revision_before`, `revision`. Hai revision chỉ đứng cạnh trường vá: input hỗn hợp hoặc rỗng thì frame chỉ mang id. Tám nơi phát `task.updated` khác KHÔNG đổi: `project.go:420` (xoá dự án bỏ `project_id` khỏi task), `task_catalog_labels.go:311,343`, `task_catalog_properties.go:288,322`, `task_graph.go:224,300,355`.

- [ ] **Step 1: Đọc**

`task.go` từ dòng 150 đến hết `Update`; `taskAuditFields` (dòng 160-171); các query `UpdateTask`, `SetTaskAssignee`, `SetTaskDueDate`, `SetTaskProjectID` trong `pkg/db/queries/tasks.sql`; `service/task_test.go:40-90` (`taskFixture`, `outboxCapture.drain`).

- [ ] **Step 2: Viết test thất bại**

Dùng `taskFixture` và `outboxCapture`. Vì `drain` xử lý outbox toàn cục (flake song song đã biết), đọc payload của đúng hàng outbox theo `task_id` bằng query trực tiếp trong test nếu cần, không dựa `drain`.

Ca tối thiểu:
1. Đổi riêng `title`: payload có `title` mới, `revision_before` bằng revision trước khi sửa, `revision` bằng revision sau.
2. Đổi `status` và `due_date` trong một lần: có cả hai trường; `revision − revision_before` bằng đúng số query tăng revision đã chạy.
3. Xoá `due_date`: `due_date` là chuỗi rỗng.
4. Đổi `title` và `description` (input hỗn hợp), hoặc input rỗng: chỉ id, KHÔNG có trường vá và KHÔNG có hai revision.
5. Đổi `project_id` hoặc người phụ trách: chỉ id.
6. Đổi `position`: chỉ id.
7. Ghi đồng thời: một goroutine đổi `priority`, một goroutine đổi `title` cùng task, chạy song song nhiều lần. Với mỗi payload thu được, không có hai frame nào mà khoảng `[revision_before, revision]` chồng nhau, và hợp các khoảng liên tiếp phủ đúng revision cuối. Đây là test chứng minh `revision_before` không lấy từ `before` đọc ngoài transaction.
8. Mọi giá trị payload là chuỗi (unmarshal được vào `map[string]string`).
9. `BatchUpdateTasks` với cùng một id hai lần (`[X, X]`): hai frame của X có khoảng `[revision_before, revision]` nối tiếp, không chồng nhau; `revision_before` của frame thứ hai bằng `revision` của frame thứ nhất.

- [ ] **Step 3: Viết mã**

- Trong mỗi lời gọi `updateTaskInTx`, lấy `revision_before = revision` của hàng `UpdateTask` trả về (RETURNING) trừ một, ngay sau `UpdateTask`: query đó luôn chạy, khoá hàng và tăng revision đúng một (`pkg/db/queries/tasks.sql:43`). `revision` là revision của hàng RETURNING cuối cùng của lời gọi. Không đếm số query (vỡ im lặng nếu một `Set*` sau này tăng có điều kiện), không đếm theo cả transaction (một lô `BatchUpdateTasks` có thể gọi nhiều lần cho cùng task), không dùng `before.Revision`.
- Tập đổi = mọi trường có trong input, không so với `before`: `before` đọc trước khoá hàng, và so với nó có thể giấu trường chính lời gọi này ghi.
- Nếu tập đổi khác rỗng và là tập con của `{title, status, priority, due_date}`: thêm các trường đó (giá trị từ hàng dưới khoá) cùng hai revision vào payload dưới dạng chuỗi. Ngược lại frame chỉ mang id.
- Đọc danh sách trường vá từ `Patch` của `EventDef` mà `outbox.Lookup("task.updated")` trả về (hàm trả `(EventDef, bool)`), không lặp lại danh sách trong service. Đã kiểm: `service` được import `internal/outbox` (đang có ở `service/audit_export.go`, `chat_task_sync.go`, `meeting_provider_consumer.go`, `meeting_webhook.go`); `server/internal/arch_test.go` chỉ cấm ghi thẳng bảng `audit_events`/`outbox_events` ngoài `internal/audit`, không cấm đọc catalogue.

- [ ] **Step 4: Chạy và commit**

```bash
cd server && go test -race -count=1 -run 'RealtimePatch|TestTaskCRUD|BatchUpdate' ./internal/service/
cd server && go test -race -count=1 ./internal/outbox/ ./internal/audit/
node --test scripts/events-catalogue.test.mjs
```

```bash
git commit -m "feat(tasks): task.updated mang trường vá kèm revision_before và revision"
```

---

## Task 3: Client vá cache theo guard revision

**Files:**
- Create: `packages/core/tasks/realtime-task-patch.ts`
- Create: `packages/core/tasks/realtime-task-patch.test.ts`
- Modify: `packages/core/tasks/cache-coordinator.ts`, `packages/core/tasks/cache-coordinator.test.ts`
- Modify: `packages/core/realtime/use-realtime-sync.ts`, `packages/core/realtime/use-realtime-sync.test.tsx`
- Modify: `CLAUDE.md` § State Rules (cùng commit với test giữ luật)

**Interfaces:**
- Consumes: payload Task 2.
- Produces:
  - `export const TASK_PATCH_FIELDS = ["title", "status", "priority", "due_date"] as const`
  - `export function parseTaskPatchFrame(payload: Record<string, string>): TaskPatchFrame | null` — null khi thiếu `task_id`, thiếu hoặc không phải số nguyên `revision_before`/`revision`, `revision <= revision_before`, hoặc không có khoá nào thuộc `TASK_PATCH_FIELDS`; chỉ giữ khoá thuộc `TASK_PATCH_FIELDS`; `due_date: ""` thành `null`.
  - `export function applyTaskPatch(qc: QueryClient, wsId: string, frame: TaskPatchFrame): { detailPatched: boolean }`
  - `CacheUpdatePlan` thêm `patch?: TaskPatchFrame`.

- [ ] **Step 1: Đọc**

`packages/core/tasks/keys.ts` ở HEAD (sau D2: `detail`, `list`, `query`, `queryInfinite`, `myTasksFiltered`, `myTasksInfinite`, `grouped`, `tableRows`); `packages/core/tasks/hooks.ts:55-146` (khuôn duyệt và vá mọi entry cache); `use-realtime-sync.ts` toàn bộ; `use-realtime-sync.test.tsx` toàn bộ; `realtime/invalidate-scheduler.ts:37-48` (tiền lệ guard phiên bản).

- [ ] **Step 2: Viết test thất bại**

`realtime-task-patch.test.ts`:
1. `parseTaskPatchFrame` bỏ khoá lạ (`assignee_id`, `description`, `smuggled`), từ chối revision không hợp lệ, đổi `due_date: ""` thành `null`.
2. Detail cache revision 5, frame `revision_before 5, revision 7, title "Mới"`: detail có title mới, revision 7, các trường khác giữ nguyên.
3. Detail cache revision 6, cùng frame: KHÔNG vá, `detailPatched` là false.
4. Không có detail cache: không tạo entry.
5. Hàng trong `list`, `query`, `queryInfinite` (mọi trang), `grouped`, `tableRows` có cùng task revision 5: được vá; hàng có revision khác: giữ nguyên; entry không chứa task: không đổi tham chiếu.
6. Frame không có trường vá nào (chỉ hai revision, như hàng outbox cũ hoặc lỗi server): `parseTaskPatchFrame` trả null; cache KHÔNG nhận revision mới; detail bị invalidate như cũ.

`use-realtime-sync.test.tsx`:
7. Sửa test "without writing the frame" cho `task.subscribed`: vẫn không ghi gì (topic không có `Patch`).
8. `task.updated` có trường vá và detail khớp revision: detail được vá ngay, KHÔNG invalidate `["task", id]`; list roots VẪN invalidate.
9. `task.updated` có trường vá nhưng detail lệch revision: invalidate `["task", id]` như cũ.
10. `task.updated` chỉ id: hành vi y như trước lát E.
11. `task.created`, `task.deleted`: không vá, chỉ invalidate.

- [ ] **Step 3: Viết mã**

- `planCacheUpdate` với `task.updated`: gắn `patch` khi `parseTaskPatchFrame` trả khác null; vẫn trả đủ khoá invalidate như cũ.
- `use-realtime-sync.ts`: khi có `patch`, gọi `applyTaskPatch` trước; nếu `detailPatched` thì bỏ `taskKeys.detail(id)` khỏi các khoá invalidate của frame đó; list roots giữ nguyên. Cập nhật comment đầu hàm `keysFor` nói đúng luật mới, trỏ ADR 0015.
- `applyTaskPatch` dùng `qc.setQueriesData` hoặc duyệt `qc.getQueryCache().findAll` theo gốc khoá, trả tham chiếu cũ khi không đổi gì.
- `CLAUDE.md` § State Rules: sửa gạch đầu dòng "WebSocket events invalidate Query keys… never written into a query or a store" thành: frame invalidate khoá Query; ngoại lệ duy nhất là trường một hàng catalogue khai ở `Patch`: chỉ vá bản ghi đã có, chỉ khi frame có ít nhất một khoá `Patch` và đủ hai revision, và `revision` trong cache khớp `revision_before` (ADR 0015); nêu `packages/core/realtime/use-realtime-sync.test.tsx` và `packages/core/tasks/realtime-task-patch.test.ts` là test giữ luật.

- [ ] **Step 4: Chạy và commit**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run tasks realtime
```

`pnpm typecheck`, `pnpm knip`, lint core exit 0.

```bash
git commit -m "feat(tasks): vá cache task từ frame realtime theo guard revision"
```

---

## Task 4: Cổng cuối và tài liệu

- [ ] Chạy cổng như Task 8 lát D1 (`make check` một lần; dừng ở lỗi nền thì chạy tay phần sau; mọi lệnh tiền cảnh). Go bắt buộc chạy vì lát chạm `server/`; kiểm `server/coverage.floor` qua `scripts/go-cover-floor.sh`.
- [ ] Chạy `node --test scripts/events-catalogue.test.mjs scripts/governance.test.mjs` và ghi output.
- [ ] Coverage `core`; nâng sàn chỉ khi kiếm được; không chạm `ui`.
- [ ] Tài liệu: plan này `shipped`; spec dòng trạng thái thêm "lát E shipped"; thêm `## 7octies. Giới hạn đã biết của lát E` (tối thiểu: chỉ bốn trường; `assignee_*` vẫn refetch; list vẫn refetch sau vá; nếu có task quyền đọc hẹp hơn workspace thì phải xét lại `Patch`); roadmap F-05 giữ `MỘT PHẦN`, nối câu lát E.
- [ ] Commit `chore(tasks): cập nhật trạng thái lát E`. Không push, không PR.

## Ghi chú cho người thực thi

- Thứ tự cứng: Task 1 → 2 → 3 → 4. Task 2 và 3 không làm trước khi ADR đã commit.
- Không mở rộng `Patch` sang topic khác trong lát này, kể cả khi thấy dễ.
- Nếu Task 2 cho thấy đếm query tăng revision không đáng tin (ví dụ một query tăng có điều kiện như `task_properties.sql:52,73`), dừng và báo; không đoán.
