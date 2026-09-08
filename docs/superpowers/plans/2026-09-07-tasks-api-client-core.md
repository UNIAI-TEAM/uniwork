# UNI-497 · Tasks API và client core Implementation Plan

> **Trạng thái:** shipped — UNI-497 slice 2 API + client core đã qua gate; PR/handoff Task 14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây full HTTP API + client core Work Management sau flag `tasks_work_management_parity`, đủ Tasks / My Tasks / table·facet / catalogs / views / projects / cộng tác, với revision + idempotency + cache/realtime UniWork — không đổi UI MVP.

**Architecture:** Suite mới đăng ký route riêng, bọc middleware flag (tắt → 404 `feature_disabled`). Handler → RequireMember → service transaction (sqlc org+ws + audit + outbox). Client `@uniwork/core` thêm endpoints/hooks/query keys; realtime chỉ invalidate/patch. Multica `@ 3d37828e9` là checklist hành vi (Issue→Task), không copy nguyên khối.

**Tech Stack:** Go 1.27, Chi, pgx/sqlc, Zod, React Query, Vitest, feature flag F-11.

**Spec:** `docs/superpowers/specs/2026-09-07-tasks-api-client-core-design.md`

**Tracking:** Parent `UNI-426`; sub-issue `UNI-497`; phụ thuộc `UNI-495` đã merge `develop`.

## Global Constraints

- Trước product code: `make issue-start KEY=UNI-497` từ `develop` (có UNI-495); không code trên nhánh umbrella `feature/UNI-426-*` trừ khi đó là branch issue.
- Không branding nguồn trong product code/tests; tên nguồn chỉ trong plan/spec/manifest.
- Giữ `Task/Công việc`, `/tasks`, `/my-tasks`, `AgentRun`; không domain `Issue`.
- Mọi query business mới scope `organization_id` + `workspace_id`; membership chỉ `RequireMember`.
- Không FK/cascade; audit+outbox cùng transaction với lệnh ghi.
- API **mới** khóa bằng flag `tasks_work_management_parity` (default false); 7 route MVP luôn mở.
- Capability thiếu → `unavailable` + `reason_code`; không giả success.
- Lát cắt này **không** đổi UI collection/Projects pages.
- TDD từng task; commit conventional; trước xong `make check` / `make check-worktree` + `[agent]` comment trên UNI-497.
- Response qua `parseWithFallback`; mọi endpoint mới có malformed-response test.

---

## File map

### Inventory & flag gate

- Create: `scripts/generate-task-api-route-catalogue.mjs` — đọc Multica `packages/core/api/client.ts` @ baseline, lọc Work Management, đổi Issue→Task, emit catalogue UniWork paths dưới `/api/v1/...`.
- Create: `docs/parity/tasks-api-client-core-routes.json` — artifact khóa route lát cắt 2.
- Create: `scripts/task-api-route-catalogue.test.mjs` — schema, uniqueness, minimum groups, no source brand in target paths.
- Create: `server/internal/middleware/feature_flag.go` (+ test) — `RequireFeatureFlag(key)` → 404 JSON `{code:"feature_disabled"}` khi off.
- Modify: `server/internal/handler/router/*.go` — nhóm route suite mới mount sau middleware flag.

### Shared mutation contracts

- Create: `server/migrations/154_idempotency_keys.{up,down}.sql` (và `155_…_idx.up.sql` CONCURRENTLY một statement nếu cần index).
- Create: `server/pkg/db/queries/idempotency.sql` + `make sqlc`.
- Create: `server/internal/service/idempotency.go` (+ test).
- Modify: task update paths — `If-Match` / body `revision` → `revision_conflict` (422) khi lệch.
- Modify: create task + create comment — header `Idempotency-Key` trên suite mới.

### Server domain (sau flag)

- Modify/Create handlers+services+sqlc+SDO/SDI cho: tasks query/list/detail/batch/children/dependencies; my-tasks; table groups/rows/facets; task-statuses/labels/properties; task-views + preferences; projects + resources; comments thread/resolve/reactions; subscribers; attachments/timeline theo catalogue.
- AgentRun/VCS/PR routes trong catalogue → handler stub `capability_unavailable` + reason ổn định (không ghi DB giả).

### Client core

- Create/Modify: `packages/core/api/endpoints/tasks*.ts`, `projects.ts`, `task-statuses.ts`, `task-labels.ts`, `task-properties.ts`, `task-views.ts` (+ `*.test.ts` malformed).
- Modify: `packages/core/types/task.ts` (+ related) — 7 status categories, foundation fields.
- Modify: `packages/core/tasks/hooks.ts` (+ split modules nếu >500 lines) — keys scoped `wsId`.
- Create: `packages/core/tasks/cache-coordinator.ts` (+ test) — quyết định patch vs invalidate.
- Modify: `packages/core/realtime/use-realtime-sync.ts` (+ test) — map event → keys mới.
- Modify: `packages/core/package.json` exports nếu cần.

### Verification

- Overlay/manifest verification cho entry API lát cắt 2.
- Update roadmap F-05 note; plan status shipped sau gate.

---

### Task 1: Branch, route catalogue, flag gate

**Files:**

- Create: `scripts/generate-task-api-route-catalogue.mjs`
- Create: `scripts/task-api-route-catalogue.test.mjs`
- Create: `docs/parity/tasks-api-client-core-routes.json`
- Create: `server/internal/middleware/feature_flag.go`
- Create: `server/internal/middleware/feature_flag_test.go`
- Modify: `scripts/check.sh` (thêm catalogue test vào repo-contract nếu phù hợp)

**Interfaces:**

- Consumes: Multica `packages/core/api/client.ts` endpoint strings @ `3d37828e9`; flag key `tasks_work_management_parity`.
- Produces: JSON catalogue `{schema_version, baseline_commit, routes:[{method, source_path, target_path, group, disposition}]}`; middleware `RequireFeatureFlag(name string) func(http.Handler) http.Handler`.

- [ ] **Step 1: `make issue-start KEY=UNI-497` từ develop đã có UNI-495**

Run: `git fetch origin develop && git checkout develop && git pull && make issue-start KEY=UNI-497`

Expected: branch `feature/UNI-497-...`; issue `in_progress`.

- [ ] **Step 2: Viết catalogue contract test đang đỏ**

```js
// scripts/task-api-route-catalogue.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../docs/parity/tasks-api-client-core-routes.json", import.meta.url);

test("slice-2 route catalogue pins Work Management API surface", async () => {
  const cat = JSON.parse(await readFile(path, "utf8"));
  assert.equal(cat.schema_version, 1);
  assert.equal(cat.baseline_commit, "3d37828e9");
  assert.ok(cat.routes.length >= 40);
  const keys = cat.routes.map((r) => `${r.method} ${r.target_path}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of cat.routes) {
    assert.match(r.target_path, /^\/api\/v1\//);
    assert.equal(r.target_path.toLowerCase().includes("multica"), false);
    assert.equal(r.target_path.toLowerCase().includes("/issues"), false);
    assert.ok(["tasks","my_tasks","table","catalog","views","projects","collaboration","stub"].includes(r.group));
    assert.ok(["ported","adapted","stubbed"].includes(r.disposition));
  }
  const groups = new Set(cat.routes.map((r) => r.group));
  for (const g of ["tasks","table","catalog","views","projects","collaboration"]) {
    assert.ok(groups.has(g), `missing group ${g}`);
  }
});
```

Run: `node --test scripts/task-api-route-catalogue.test.mjs`

Expected: FAIL (file thiếu).

- [ ] **Step 3: Generator + emit catalogue**

Script CLI: `node scripts/generate-task-api-route-catalogue.mjs --source-root multica --baseline 3d37828e9 --output docs/parity/tasks-api-client-core-routes.json`

Ánh xạ bắt buộc: `issues→tasks`, `issue-→task-`, `/api/…` → `/api/v1/workspaces/{workspaceID}/…` khi Multica path workspace-scoped; path global comment → `/api/v1/comments/...`. `task-runs` / PR / VCS → `group:"stub"`, `disposition:"stubbed"`.

Run generator + test — Expected: PASS.

- [ ] **Step 4: Middleware flag RED rồi GREEN**

```go
func TestRequireFeatureFlagReturns404WhenDisabled(t *testing.T) {
	// chi router + RequireFeatureFlag("tasks_work_management_parity")
	// flag false → GET suite route → 404 body code feature_disabled
	// flag true → next handler runs
}
```

Implement `RequireFeatureFlag` dùng `featureflag.Service.IsEnabled` + default từ `featureflags.Lookup`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-task-api-route-catalogue.mjs scripts/task-api-route-catalogue.test.mjs \
  docs/parity/tasks-api-client-core-routes.json server/internal/middleware/feature_flag.go \
  server/internal/middleware/feature_flag_test.go scripts/check.sh
git commit -m "feat(tasks): lock slice-2 API catalogue and flag gate"
```

---

### Task 2: Idempotency + revision conflict primitives

**Files:**

- Create: `server/migrations/154_idempotency_keys.{up,down}.sql` (và `155_…_idx.up.sql` CONCURRENTLY một statement nếu cần index)
- Create: `server/pkg/db/queries/idempotency.sql` + `make sqlc`
- Create: `server/internal/service/idempotency.go`
- Create: `server/internal/service/idempotency_test.go`
- Modify: coded errors — `revision_conflict`
- Modify: `server/migrations/lint_test.go` nếu bảng mới cần org column / exemption

**Interfaces:**

- Produces: `BeginIdempotent(ctx, q, scope, key, actorID) (replay *StoredResponse, commit func(status int, body []byte) error, err error)`; `CheckTaskRevision(got, want int64) error`.

- [ ] **Step 1: Test đỏ**

```go
func TestIdempotentCreateReplaysSameResponse(t *testing.T) {
	// two CreateTask with same Idempotency-Key → one row, identical response body
}
func TestRevisionConflictOnStaleUpdate(t *testing.T) {
	// update with revision=1 after server already at 2 → CodedError revision_conflict
}
```

Run: `cd server && go test ./internal/service -run 'TestIdempotentCreate|TestRevisionConflict' -count=1`

Expected: FAIL.

- [ ] **Step 2: Migration + sqlc + implement**

Bảng `idempotency_keys`: `id`, `organization_id`, `workspace_id`, `scope`, `key`, `actor_id`, `response_status`, `response_body`, `created_at` — UNIQUE `(organization_id, workspace_id, scope, key)`.

- [ ] **Step 3: Tests xanh + commit**

```bash
git add server/migrations server/pkg/db server/internal/service
git commit -m "feat(tasks): add idempotency keys and revision conflict"
```

---

### Task 3: Tasks query, detail by identifier, list filters

**Files:**

- Modify: `server/pkg/db/queries/tasks.sql` (+ generated)
- Modify: `server/internal/service/task.go` / create `task_query.go` nếu vượt 500 lines
- Modify: `server/internal/handler/task.go` + router — routes suite mới sau flag
- Create/Modify: SDI/SDO query DTOs
- Test: `server/internal/service/task_query_test.go`, `server/internal/handler/task_query_test.go`

**Interfaces:**

- Produces: `QueryTasks(ctx, actor, wsID, Query) (Page, error)`; `GetByRef(ctx, actor, ref string) (Task, error)` — `ref` ULID hoặc `PREFIX-N`.
- Catalogue routes group `tasks` tối thiểu: list/query, get by id/identifier, grouped — đúng `target_path` trong catalogue Task 1.

- [ ] **Step 1: Test đỏ — filter status + get by identifier + flag off 404**

```go
func TestQueryTasksFiltersByStatusAndPaginates(t *testing.T) { /* seed 3 tasks; filter one status; limit/offset */ }
func TestGetTaskByIdentifier(t *testing.T) {
	// create → identifier like ALP-1 → GetByRef("ALP-1") same id
}
func TestSuiteTasksRoutes404WhenFlagOff(t *testing.T) { /* 404 feature_disabled */ }
```

- [ ] **Step 2: Implement sqlc + service + handler mount under flag**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(tasks): add flagged task query and identifier lookup"
```

---

### Task 4: Task mutations suite — create/update/delete/batch + If-Match

**Files:**

- Modify: `server/internal/service/task.go`, handler, SDI
- Test: concurrency + batch + revision

**Interfaces:**

- Produces: `CreateTaskSuite` (idempotent), `UpdateTaskSuite(rev)`, `BatchUpdate`, `BatchDelete`.
- Header: `Idempotency-Key` trên POST create; `If-Match` hoặc body `revision` trên PATCH.

- [ ] **Step 1: Tests đỏ — stale If-Match; batch update 3 tasks; flag off 404**

- [ ] **Step 2: Implement + audit/outbox mỗi lệnh**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): add flagged task mutations with revision and batch"
```

---

### Task 5: My Tasks, children, dependencies

**Files:**

- sqlc + `server/internal/service/task_graph.go` (+ test)
- handlers/router cho my-tasks, children, dependencies theo catalogue

**Interfaces:**

- `ListMyTasks(ctx, actor, wsID, Query)`
- `ListChildren`, `ListChildrenByParents`, `SetDependency` / `RemoveDependency` — cycle → `parent_cycle`

- [ ] **Step 1: Tests đỏ — my-tasks chỉ task của actor; dependency cycle 422**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): add my-tasks children and dependencies APIs"
```

---

### Task 6: Table groups, rows, facets

**Files:**

- `server/internal/service/task_table.go` (+ test)
- handlers `POST .../tasks/table/{groups,rows,facets}` (paths khớp catalogue)
- sqlc projections cần thiết

**Interfaces:**

- `TableGroups`, `TableRows`, `TableFacets` nhận filter/group_by/columns; shape ổn định cho client table mode (UI lát cắt 3).

- [ ] **Step 1: Tests đỏ — groups/rows/facets trả đúng count với fixture**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): add task table groups rows facets APIs"
```

---

### Task 7: Catalog HTTP — statuses, labels, properties

**Files:**

- Extend sqlc statuses / create labels+properties queries
- `server/internal/service/task_catalog.go` (+ test)
- handlers dưới flag; built-in status không sửa/xóa (422)

**Interfaces:**

- CRUD/list/reorder statuses; labels; properties — catalogue group `catalog`.

- [ ] **Step 1: Tests đỏ — list 7 built-in; PATCH built-in fails**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): expose task catalog HTTP APIs"
```

---

### Task 8: Task views + preferences

**Files:**

- sqlc views/preferences
- `server/internal/service/task_view.go` (+ test)
- handlers group `views`

**Interfaces:**

- `ListViews`, `CreateView`, `UpdateView`, `DeleteView`, `Get/PutPreferences`

- [ ] **Step 1: Tests đỏ — create view + put preference round-trip**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): add task views and preferences APIs"
```

---

### Task 9: Projects + resources HTTP

**Files:**

- Wire existing sqlc `projects.sql` qua service/handler
- `server/internal/service/project.go` (+ test)
- handlers group `projects` sau flag

**Interfaces:**

- CRUD project; list/create/update/delete resources; search nếu có trong catalogue.
- **Capability note:** HTTP mở khi flag on; `tasks.projects` trong config **vẫn** `surface_not_ready` đến UI lát cắt 4 (đúng design slice 1). Test pin cả hai: route 200 khi flag on + capability status chưa `available`.

- [ ] **Step 1: Tests đỏ — create/list project tenant isolation**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): add projects HTTP under parity flag"
```

---

### Task 10: Collaboration — threaded comments, reactions, subscribers

**Files:**

- Extend comments sqlc/service/handler
- reactions + subscribers services
- stubs timeline/attachments nếu catalogue yêu cầu mà storage chưa sẵn → `capability_unavailable`, không ghi file giả

**Interfaces:**

- Reply/edit/delete/resolve comment; reactions; subscribe/unsubscribe; timeline read nếu ported

- [ ] **Step 1: Tests đỏ — reply + resolve + reaction + subscriber**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tasks): extend task collaboration APIs"
```

---

### Task 11: Client endpoints, types, hooks, cache coordinator

**Files:**

- `packages/core/types/task.ts` (+ catalogs/projects types)
- `packages/core/api/endpoints/*` mới + malformed tests
- `packages/core/tasks/hooks.ts` / split modules
- `packages/core/tasks/cache-coordinator.ts` (+ test)
- package exports

**Interfaces:**

- Mỗi route group có endpoint function + Zod + hook keys gồm `wsId`
- `planCacheUpdate(event): {type:'patch'|'invalidate', keys: unknown[]}`

- [ ] **Step 1: Types + endpoint malformed RED**

- [ ] **Step 2: Implement parseWithFallback + hooks**

- [ ] **Step 3: Cache coordinator unit tests PASS**

- [x] **Step 4: Commit**

```bash
git commit -m "feat(core): add Work Management API client core"
```

---

### Task 12: Realtime sync mapping

**Files:**

- Modify: `packages/core/realtime/use-realtime-sync.ts`
- Modify: `packages/core/realtime/use-realtime-sync.test.tsx`
- Modify: `packages/core/types/events.ts` + server catalogue nếu event mới (ba nơi đồng bộ)

**Interfaces:**

- Event `task.*` / `project.*` / comment events → keys từ coordinator; không ghi payload vào Zustand

- [ ] **Step 1: Test đỏ — event invalidates new keys**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(realtime): map Work Management events to query keys"
```

---

### Task 13: Stub catalogue leftovers + registration guard

**Files:**

- Handlers stub cho mọi route `disposition:stubbed` còn lại
- Test: catalogue coverage vs Chi routes
- Arch: suite routes đi qua flag middleware

- [ ] **Step 1: Test đỏ**

```go
func TestAllCatalogueRoutesAreRegistered(t *testing.T) {
	// load docs/parity/tasks-api-client-core-routes.json; compare registered chi routes
}
```

- [ ] **Step 2: Implement stubs (`capability_unavailable`)**

- [ ] **Step 3: Commit**

```bash
git commit -m "test(tasks): cover slice-2 catalogue routes and stubs"
```

---

### Task 14: Full verification và handoff

**Files:**

- Docs: plan → shipped; umbrella note slice 2; roadmap F-05
- Manifest verification overlay cho entry API đã có evidence
- UniAI comment + `make issue-pr KEY=UNI-497`

- [x] **Step 1: Scans** — no source brand; catalogue PASS; flag-off MVP smoke

- [x] **Step 2: Gates** — `pnpm --filter @uniwork/core test`, `make test-go`, `make check-worktree`

- [x] **Step 3: Docs + overlay**

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: record UNI-497 API client core evidence"
```

- [x] **Step 5: UniAI stop comment + PR**

---

## Spec coverage

| Spec yêu cầu | Task |
| --- | --- |
| Flag gate API mới; MVP luôn mở | 1, 3–10, 13 |
| Full catalogue routes (inventory) | 1, 13 |
| Revision + idempotency | 2, 4 |
| Query / identifier / batch | 3, 4 |
| My Tasks / children / dependencies | 5 |
| Table/facet | 6 |
| Catalogs / views / projects HTTP | 7–9 |
| Collaboration | 10 |
| Client + cache + realtime | 11–12 |
| No UI; stubs capability | 9–10, 13 |
| Verification / PR | 14 |

## Self-review (plan author)

- Không TBD/TODO trong bước thực thi.
- Issue KEY: **UNI-497**.
- Projects HTTP có; capability `tasks.projects` vẫn `surface_not_ready` đến UI slice — Task 9.
- Path cụ thể lấy từ artefact Task 1; task sau không đoán route ngoài catalogue.
