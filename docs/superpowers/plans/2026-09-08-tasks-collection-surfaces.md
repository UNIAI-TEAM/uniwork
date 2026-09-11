# UNI-426.3 · Tasks collection surfaces Implementation Plan

> **Trạng thái:** shipped — UNI-500 slice 3 collection surfaces đã qua `make check-worktree`; PR/handoff Task 13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi flag `tasks_work_management_parity` bật, `/tasks` và `/my-tasks` chạy Task Surface (5 modes + filters + saved views/pins) trên hooks lát cắt 2; flag tắt giữ MVP board/list không regress.

**Architecture:** Transplant có kiểm soát từ Multica `packages/views/issues/**` + `packages/views/my-issues/**` + stores/surface headless cần thiết trong `packages/core/issues/**` @ `3d37828e9` → UniWork `packages/views/tasks/{surface,modes,views}` + `packages/views/my-tasks/` + stores client trong `packages/core/tasks/stores/`. Đổi Issue→Task, `@multica/*`→`@uniwork/*`, gắn `useQueryTasks` / `useGroupedTasks` / table / views / `useMyTasks`. Capability thiếu = disabled + `reason_code`. Không rewrite MVP files; page host chọn bằng `useFlag`.

**Tech Stack:** Next.js App Router (chỉ `apps/web`), React 19, TanStack Query, Zustand (`packages/core`), Vitest + Testing Library, i18next, `@uniwork/ui`, feature flag F-11.

**Spec:** `docs/superpowers/specs/2026-09-08-tasks-collection-surfaces-design.md`  
**Umbrella:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md` §4.1–4.2, §11 mục 3  
**Baseline:** `multica/` @ `3d37828e9`  
**Tracking:** Parent `UNI-426`; sub-issue `UNI-500`; phụ thuộc `UNI-495` + `UNI-497` đã merge `develop`.

## Global Constraints

- Trước product code: tạo sub-issue dưới UNI-426 (nếu chưa có KEY) rồi `make issue-start KEY=<KEY>` từ `develop` đã có UNI-497; không code trên nhánh umbrella `feature/UNI-426-*` trừ khi đó là branch issue.
- Không branding nguồn (`multica`, `Issue` domain, `@multica/`) trong product/tests/i18n; tên nguồn chỉ trong plan/spec/`docs/parity/`.
- Giữ `Task` / `Công việc` / `/tasks` / `/my-tasks` / `AgentRun`; không domain `Issue`.
- Mọi JSX text trong `packages/views/` qua `t()`; `vi` đủ key collection.
- File `.ts`/`.tsx` product ≤ 500 lines (max-lines); khi nguồn >500 phải tách module khi transplant — không copy nguyên khối table/header/swimlane.
- Server state chỉ TanStack Query; optimistic chỉ drag status/position; create/delete/batch await server.
- Flag off: không gọi suite hooks; render MVP `TasksPageView`.
- Capability `unavailable` → control disabled + tooltip/dialog + `reason_code`; không gọi mutation.
- TDD từng task; commit conventional + `Refs` trailer; trước xong `make check-worktree` + `[agent]` comment trên issue.
- F-05 / umbrella vẫn `MỘT PHẦN` sau lát cắt này.

### Transplant rename map (áp dụng mọi task port)

| Nguồn | Đích |
| --- | --- |
| `Issue` / `issue` (domain) | `Task` / `task` |
| `Issues` / `issues` | `Tasks` / `tasks` |
| `my-issues` / `MyIssues` | `my-tasks` / `MyTasks` |
| `@multica/core` | `@uniwork/core` |
| `@multica/ui` | `@uniwork/ui` |
| `useT("issues")` / Multica i18n | `useTranslation()` + keys `tasks.*` / `myTasks.*` |
| Multica issue hooks/queries | `@uniwork/core/tasks` suite hooks (`useQueryTasks`, `useGroupedTasks`, `useTable*`, `useTaskViews`, `useMyTasks`, `useTaskStatuses`, batch) |
| `text-faint-foreground` / legacy tokens | semantic UniWork tokens only |

### Modes theo surface (khớp baseline + umbrella)

| Route | `modes` prop |
| --- | --- |
| `/tasks` (workspace) | `["board","list","table","gantt","swimlane"]` — umbrella §4.1 đủ 5 |
| `/my-tasks` | `["board","list","table","swimlane"]` — khớp Multica `my-issues-page`; Gantt chỉ nếu baseline scope đó có (mặc định không) |

---

## File map

### Provenance

- Create: `docs/parity/tasks-collection-surfaces-inventory.json` — map `source_path` → `target_path` + disposition cho entry UI lát cắt 3.
- Create: `scripts/tasks-collection-brand-scan.test.mjs` — fail nếu `multica` / `\bIssue\b` / `@multica` lọt vào `packages/views/tasks/**`, `packages/views/my-tasks/**`, locale product keys mới.
- Create: `docs/parity/tasks-work-management.slice3-verification.json` — overlay verified cho entry UI đã port (merge generator như slice 1–2).

### Core (client chrome only)

- Create: `packages/core/tasks/stores/surface-view-store.ts` (+ test) — port từ `multica/packages/core/issues/stores/surface-view-store.ts`.
- Create: `packages/core/tasks/stores/view-store.ts` (+ split nếu cần) + `view-store-context.tsx` — port view chrome state (mode, filters, group, sort, gantt prefs); **không** chứa server cache.
- Create: `packages/core/tasks/stores/my-tasks-view-store.ts` (+ test) — 4 scope tabs.
- Create: `packages/core/tasks/surface/scope.ts` (+ test) — `TaskScope` workspace | my (+ relation).
- Create: `packages/core/tasks/surface/query-plan.ts` (+ test) — map scope/filters → suite query / table body / my-tasks opts.
- Modify: `packages/core/tasks/hooks-suite.ts` + `tasks-suite.ts` — thêm `relation?: "all" | "assigned" | "created" | "involved"` cho `listMyTasks` / `useMyTasks` (API fix block UI, cho phép theo spec).
- Modify: server `ListMyTasks` / `CountMyTasks` (+ handler/SDI) khi cần filter relation; `involved` → empty hoặc stub capability nếu chưa có data model agent link.
- Modify: `packages/core/package.json` exports `./tasks/stores/*` nếu cần.

### Views — Task Surface

- Create: `packages/views/tasks/surface/` — `task-surface.tsx`, `types.ts`, `use-task-surface-controller.ts`, `use-task-surface-data.ts`, selection/actions contexts, tests (port `multica/.../issues/surface/*`, tách file >500).
- Create: `packages/views/tasks/modes/` — `board-view.tsx`, `list-view.tsx`, `table-view*.tsx`, `gantt-view.tsx`, `swimlane-view.tsx` (+ helpers/tests); **không** đụng MVP `packages/views/tasks/board-view.tsx` / `list-view.tsx` (giữ tên MVP; suite modes đặt dưới `modes/`).
- Create: `packages/views/tasks/views/` — header filters, filter-chips, view-bar, save/manage dialogs, batch toolbar (port components; stub AgentRun/VCS/Projects-deep controls).
- Create: `packages/views/tasks/task-surface-page.tsx` — workspace page wrapper (flag-on entry).
- Keep: `tasks-page-view.tsx`, MVP board/list — flag-off path.

### Views — My Tasks

- Create: `packages/views/my-tasks/my-tasks-page.tsx`, `my-tasks-header.tsx` (+ tests).

### Web host

- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/page.tsx` — `useFlag("tasks_work_management_parity", false)` → MVP vs `TaskSurfacePage`.
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/my-tasks/page.tsx`.
- Modify: `packages/core/paths/paths.ts` — `myTasks()`.
- Modify: reserved slugs + `pnpm generate:reserved-slugs` nếu slug global.
- Modify: `packages/views/layout/app-sidebar.tsx` (+ test) — link My Tasks khi flag on (hoặc luôn hiện route; page tự empty/gate).
- Modify: `packages/views/package.json` exports `./my-tasks/*` nếu cần.
- i18n: `packages/core/i18n/locales/{en,vi}/*.json` — keys `tasks.surface.*`, `myTasks.*`.

### Verification

- Component tests: mode switch, filters, saved views, my-tasks scopes, stub disabled; không mock `next/*`.
- E2E smoke (trên GATE > fast): flag on load `/tasks` + `/my-tasks`; flag off MVP.
- Update umbrella status + plan status sau gate.

---

### Task 1: Issue branch, inventory, brand-scan gate

**Files:**

- Create: `docs/parity/tasks-collection-surfaces-inventory.json`
- Create: `scripts/tasks-collection-brand-scan.test.mjs`
- Modify: `scripts/check.sh` (wire brand-scan vào repo-contract group nếu phù hợp)

**Interfaces:**

- Consumes: Multica tree @ `3d37828e9` paths dưới `packages/views/issues/{surface,components}`, `packages/views/my-issues`, `packages/core/issues/stores/{surface-view-store,view-store*,my-issues-view-store}`, `packages/core/issues/surface/scope.ts`.
- Produces: inventory JSON `{schema_version:1, baseline_commit:"3d37828e9", owner_issue:"<KEY>", entries:[{source_path, target_path, disposition:"port"|"adapt"|"skip_detail"|"skip_later_slice"}]}`.

- [ ] **Step 1: Tạo UniAI sub-issue (nếu chưa) + `issue-start` từ develop**

```bash
git fetch origin develop && git checkout develop && git pull --ff-only
# nếu chưa có KEY:
# uniai issue create --title "UNI-426.3 · Task collection surfaces" --parent UNI-426 ...
make issue-start KEY=<KEY>
make setup-worktree   # hoặc quy trình worktree repo đang dùng
```

Expected: branch `feature/<KEY>-...`; issue `in_progress`.

- [ ] **Step 2: Viết brand-scan test đang đỏ**

```js
// scripts/tasks-collection-brand-scan.test.mjs
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const roots = ["packages/views/tasks", "packages/views/my-tasks"];

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(tsx?|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("collection UI has no source brand or Issue domain", async () => {
  const files = (await Promise.all(roots.map((r) => walk(r)))).flat();
  assert.ok(files.length > 0, "expected suite files under tasks/ or my-tasks/");
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(/multica/i.test(text), false, file);
    assert.equal(/@multica\//.test(text), false, file);
    assert.equal(/\bIssue\b/.test(text), false, file);
    assert.equal(/\bIssues\b/.test(text), false, file);
  }
});
```

- [ ] **Step 3: Chạy test — expect FAIL (chưa có `my-tasks/` hoặc inventory chưa đủ suite files)**

Run: `node --test scripts/tasks-collection-brand-scan.test.mjs`  
Expected: FAIL (missing roots or empty)

- [ ] **Step 4: Viết inventory JSON tối thiểu + stub `packages/views/my-tasks/.gitkeep` và `packages/views/tasks/surface/.gitkeep` để root tồn tại; nới brand-scan: chỉ scan file product (bỏ `.gitkeep`)**

Inventory phải liệt kê ít nhất:

- `packages/views/issues/surface/issue-surface.tsx` → `packages/views/tasks/surface/task-surface.tsx`
- `use-issue-surface-controller.ts` → `use-task-surface-controller.ts`
- board/list/table/gantt/swimlane views → `packages/views/tasks/modes/*`
- `issues-header.tsx` / filter / view-bar / batch → `packages/views/tasks/views/*`
- `my-issues-page.tsx` → `packages/views/my-tasks/my-tasks-page.tsx`
- surface-view-store / view-store / my-issues-view-store → `packages/core/tasks/stores/*`
- disposition `skip_detail` cho comment/detail/PR/agent-activity files (lát cắt 5–6)

- [ ] **Step 5: Re-run brand-scan — PASS trên stub roots; commit**

```bash
git add docs/parity/tasks-collection-surfaces-inventory.json \
  scripts/tasks-collection-brand-scan.test.mjs scripts/check.sh \
  packages/views/tasks/surface packages/views/my-tasks
git commit -m "$(cat <<'EOF'
chore(tasks): add collection surfaces inventory and brand-scan gate

Locks Multica→UniWork file map for slice 3 before transplant.

EOF
)"
```

---

### Task 2: TaskScope + query-plan + my-tasks relation API

**Files:**

- Create: `packages/core/tasks/surface/scope.ts`
- Create: `packages/core/tasks/surface/scope.test.ts`
- Create: `packages/core/tasks/surface/query-plan.ts`
- Create: `packages/core/tasks/surface/query-plan.test.ts`
- Modify: `server/pkg/db/queries/tasks.sql` (`ListMyTasks` / `CountMyTasks`)
- Modify: `server/internal/service/task_graph.go` (+ test)
- Modify: handler list-my-tasks + SDI query `relation`
- Modify: `packages/core/api/endpoints/tasks-suite.ts` (+ malformed test)
- Modify: `packages/core/tasks/hooks-suite.ts`
- Run: `make sqlc`

**Interfaces:**

- Consumes: Multica `packages/core/issues/surface/scope.ts` shapes.
- Produces:

```ts
export type TaskActorKind = "all" | "members" | "agents";
export type MyTasksRelation = "all" | "assigned" | "created" | "involved";
export type TaskScope =
  | { type: "workspace"; actorKind?: TaskActorKind }
  | { type: "my"; userId: string; relation: MyTasksRelation };

export function taskScopeKey(scope: TaskScope): string;
export function myRelationFromVariant(variant: string | null | undefined): MyTasksRelation;

export interface SurfaceQueryPlan {
  kind: "workspace_query" | "my_tasks" | "table";
  queryBody?: { status?: string; limit?: number; offset?: number };
  myTasksOpts?: { relation?: MyTasksRelation; limit?: number; offset?: number };
  tableBody?: unknown; // TableGroupsBody | null until modes wire facets
}
export function planSurfaceQuery(input: {
  scope: TaskScope;
  viewMode: "board" | "list" | "table" | "gantt" | "swimlane";
}): SurfaceQueryPlan;
```

- `listMyTasks(wsId, { relation?, limit?, offset? })` — `involved` returns empty page + UI uses capability disable (không giả agent data).

- [ ] **Step 1: Failing unit tests cho scope + query-plan**

```ts
// packages/core/tasks/surface/scope.test.ts
import { describe, expect, it } from "vitest";
import { myRelationFromVariant, taskScopeKey } from "./scope";

describe("taskScopeKey", () => {
  it("keys workspace and my scopes", () => {
    expect(taskScopeKey({ type: "workspace", actorKind: "all" })).toBe("workspace:all");
    expect(taskScopeKey({ type: "my", userId: "u1", relation: "assigned" })).toBe(
      "my:u1:assigned",
    );
  });
});

describe("myRelationFromVariant", () => {
  it("maps known variants and defaults to all", () => {
    expect(myRelationFromVariant("created")).toBe("created");
    expect(myRelationFromVariant("nope")).toBe("all");
  });
});
```

```ts
// packages/core/tasks/surface/query-plan.test.ts
import { describe, expect, it } from "vitest";
import { planSurfaceQuery } from "./query-plan";

describe("planSurfaceQuery", () => {
  it("routes my scope to my_tasks plan", () => {
    const plan = planSurfaceQuery({
      scope: { type: "my", userId: "u1", relation: "assigned" },
      viewMode: "list",
    });
    expect(plan.kind).toBe("my_tasks");
    expect(plan.myTasksOpts?.relation).toBe("assigned");
  });

  it("routes workspace table mode to table plan kind", () => {
    const plan = planSurfaceQuery({
      scope: { type: "workspace" },
      viewMode: "table",
    });
    expect(plan.kind).toBe("table");
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm exec vitest run packages/core/tasks/surface/scope.test.ts packages/core/tasks/surface/query-plan.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement scope + query-plan; extend SQL**

```sql
-- ListMyTasks / CountMyTasks: add optional relation
-- relation NULL or 'all' → assignee_id = actor OR created_by = actor
-- 'assigned' → assignee_id = actor
-- 'created' → created_by = actor
-- 'involved' → FALSE (empty) until agent involvement model exists
```

Handler đọc query `relation`; service truyền xuống sqlc. Client:

```ts
export async function listMyTasks(
  workspaceId: string,
  opts: { relation?: MyTasksRelation; limit?: number; offset?: number } = {},
): Promise<TaskQueryPage> { /* qs includes relation */ }
```

- [ ] **Step 4: Go + vitest + malformed endpoint test PASS; commit**

```bash
make sqlc
pnpm exec vitest run packages/core/tasks/surface packages/core/api/endpoints/tasks-suite.test.ts
# + go test cho ListMyTasks relation
git add packages/core/tasks/surface packages/core/api/endpoints/tasks-suite.ts \
  packages/core/tasks/hooks-suite.ts server/pkg/db/queries/tasks.sql \
  server/pkg/db/generated server/internal/service server/internal/handler
git commit -m "$(cat <<'EOF'
feat(tasks): add surface scope plan and my-tasks relation filter

Enables My Tasks tab scopes without inventing agent involvement rows.

EOF
)"
```

---

### Task 3: Zustand surface/view/my-tasks stores

**Files:**

- Create: `packages/core/tasks/stores/surface-view-store.ts` (+ `.test.ts`)
- Create: `packages/core/tasks/stores/view-store.ts` (split nếu >500: `view-store-filters.ts`, `view-store-gantt.ts`)
- Create: `packages/core/tasks/stores/view-store-context.tsx`
- Create: `packages/core/tasks/stores/my-tasks-view-store.ts` (+ test)
- Modify: `packages/core/package.json` exports

**Interfaces:**

- Consumes: Multica stores @ baseline; UniWork `StorageAdapter` nếu persist — **không** `localStorage` trực tiếp trong core.
- Produces:

```ts
export type TaskViewMode = "board" | "list" | "table" | "gantt" | "swimlane";
export function getTaskSurfaceViewStore(surfaceKey: string): StoreApi<SurfaceViewState>;
export function seedTaskSurfaceViewState(surfaceKey: string, partial: Partial<SurfaceViewState>): void;

// ViewStoreProvider value: viewMode, setViewMode, filters, groupBy, sort, ganttZoom, ganttShowCompleted, ...
export function MyTasksViewStore /* zustand */ : {
  scope: "all" | "assigned" | "created" | "involved";
  setScope: (s: MyTasksViewStore["scope"]) => void;
};
```

- [ ] **Step 1: Failing tests — default mode board; my-tasks scope round-trip**

```tsx
// packages/core/tasks/stores/my-tasks-view-store.test.ts
import { beforeEach, expect, it } from "vitest";
import { myTasksViewStore } from "./my-tasks-view-store";

beforeEach(() => {
  myTasksViewStore.setState({ scope: "all" });
});

it("updates my-tasks scope", () => {
  myTasksViewStore.getState().setScope("assigned");
  expect(myTasksViewStore.getState().scope).toBe("assigned");
});
```

- [ ] **Step 2: Run — FAIL; implement ported stores với rename map; PASS; commit**

```bash
pnpm exec vitest run packages/core/tasks/stores
git add packages/core/tasks/stores packages/core/package.json
git commit -m "$(cat <<'EOF'
feat(tasks): port surface and my-tasks view stores into core

Client chrome for collection modes stays out of views and off the server cache.

EOF
)"
```

---

### Task 4: TaskSurface shell + controller (list mode first)

**Files:**

- Create: `packages/views/tasks/surface/types.ts`
- Create: `packages/views/tasks/surface/task-surface.tsx`
- Create: `packages/views/tasks/surface/use-task-surface-data.ts`
- Create: `packages/views/tasks/surface/use-task-surface-controller.ts` (split nếu >500)
- Create: `packages/views/tasks/surface/selection-context.tsx`
- Create: `packages/views/tasks/surface/actions-context.tsx`
- Create: `packages/views/tasks/surface/task-surface.test.tsx`
- Create: `packages/views/tasks/modes/list-view.tsx` (suite list — tên khác MVP `list-view.tsx` ở parent)
- Create: `packages/views/tasks/modes/list-view.test.tsx`

**Interfaces:**

- Consumes: `TaskScope`, `planSurfaceQuery`, `useQueryTasks` / `useMyTasks` / `useGroupedTasks`, view stores.
- Produces:

```tsx
export type TaskSurfaceProps = {
  scope: TaskScope;
  modes: TaskViewMode[];
  surfaceKey: string;
  batchToolbar?: "always" | "list" | "never";
  renderHeader?: (ctx: { controller: TaskSurfaceController }) => React.ReactNode;
  renderEmpty?: () => React.ReactNode;
};

export function TaskSurface(props: TaskSurfaceProps): JSX.Element;
```

Controller tối thiểu Task 4: `viewMode`, `setViewMode`, `surfaceTasks`, `isLoading`, `isEmpty`, `isRefreshing`. Modes khác render placeholder panel với `t("tasks.surface.mode_placeholder")` cho đến task mode riêng.

- [ ] **Step 1: Failing test — workspace scope renders list rows from mocked http**

```tsx
// packages/views/tasks/surface/task-surface.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskSurface } from "./task-surface";
// use packages/views/test setup (http mock) — do not mock next/*

describe("TaskSurface", () => {
  it("lists tasks from suite query when list mode active", async () => {
    // mock request → queryTasks page with one task title "Alpha"
    render(
      <TaskSurface
        scope={{ type: "workspace" }}
        modes={["list"]}
        surfaceKey="test-ws"
      />,
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — FAIL; transplant shell từ `issue-surface.tsx` + controller data path tối thiểu; wire list mode; PASS**

Port rules: strip create-issue deep dialogs nếu kéo theo detail (lát cắt 5); New task có thể reuse MVP `NewTaskDialog` từ `packages/views/tasks/new-task-dialog.tsx`.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): add TaskSurface shell with list mode data path

Establishes controller + suite query wiring before porting richer modes.

EOF
)"
```

---

### Task 5: Board mode (suite) + status catalog columns

**Files:**

- Create: `packages/views/tasks/modes/board-view.tsx` (+ column/card splits nếu cần)
- Create: `packages/views/tasks/modes/board-view.test.tsx`
- Modify: `use-task-surface-controller.ts` — board uses `useGroupedTasks` / statuses từ `useTaskStatuses`
- Modify: `task-surface.tsx` — render board when `viewMode === "board"`

**Interfaces:**

- Consumes: `useTaskStatuses(wsId)`, `useUpdateTask` / `usePutTask` optimistic position/status only.
- Produces: suite `BoardView` under `modes/` — **không** sửa MVP `packages/views/tasks/board-view.tsx`.

- [ ] **Step 1: Failing test — seven category columns from catalog (not 4 MVP statuses)**

```tsx
it("renders backlog through cancelled columns from catalog", async () => {
  // mock statuses + grouped tasks
  // assert column labels via t() keys or status names
});
```

- [ ] **Step 2: Transplant board từ Multica `board-view.tsx` / `board-column.tsx` / `board-card.tsx` với rename; stub project-grouping controls nếu Projects UI chưa có (disabled + reason `tasks.projects`); PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): port suite board mode onto status catalog

Flag-on board uses seven categories; MVP board file stays for flag-off.

EOF
)"
```

---

### Task 6: Table mode + facets

**Files:**

- Create: `packages/views/tasks/modes/table-view.tsx` + split modules (`table-view-model.ts`, `table-view-rows.tsx`, `table-view-header.tsx`, …) — mỗi file ≤500
- Create: tests port/adapt từ Multica table tests (hierarchy optional nếu API sẵn)
- Wire: `useTableGroups` / `useTableRows` / `useTableFacets`

**Interfaces:**

- Consumes: `packages/core/api/endpoints/tasks-table.ts` bodies/types.
- Produces: `TableView` mode; facet change updates controller `activeTableFacet`.

- [ ] **Step 1: Failing test — table mode calls table groups endpoint when active**

- [ ] **Step 2: Transplant + split; stub editing that needs unavailable capabilities; PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): port table mode with groups rows and facets

Splits Multica table monolith to satisfy max-lines while using suite table APIs.

EOF
)"
```

---

### Task 7: Gantt + Swimlane modes

**Files:**

- Create: `packages/views/tasks/modes/gantt-view.tsx` (+ helpers/tests)
- Create: `packages/views/tasks/modes/swimlane-view.tsx` (+ splits ≤500 + tests)
- Modify: controller — gantt empty rules (Multica: empty scheduled subset ≠ surface empty)

**Interfaces:**

- Consumes: query plan workspace tasks + due/start fields từ `Task` type; swimlane group branches port `use-issue-group-branches` → `use-task-group-branches`.
- Produces: modes usable from TaskSurface when included in `modes` prop.

- [ ] **Step 1: Failing tests — gantt does not mark surface empty solely from undated filter; swimlane renders lanes**

- [ ] **Step 2: Transplant; AgentRun indicators → disabled stub via `capabilityState(config, "tasks.agent_runs")`; PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): port gantt and swimlane collection modes

Keeps agent-run chrome visible-disabled until runtime slice lands.

EOF
)"
```

---

### Task 8: Header, filters, saved views, batch toolbar

**Files:**

- Create: `packages/views/tasks/views/tasks-header.tsx` (split từ Multica `issues-header.tsx`)
- Create: `packages/views/tasks/views/filter-chips-bar.tsx`
- Create: `packages/views/tasks/views/view-bar.tsx` (+ popover)
- Create: `packages/views/tasks/views/save-view-dialog.tsx` / `manage-views-dialog.tsx`
- Create: `packages/views/tasks/views/batch-action-toolbar.tsx`
- Create: corresponding `*.test.tsx`
- Wire: `useTaskViews`, `useTaskViewPreference`, `usePutTaskViewPreference`, `usePins`, `useCreatePin`, `useDeletePin`, `useBatchUpdateTasks`, `useBatchDeleteTasks`

**Interfaces:**

- Consumes: view hooks từ `@uniwork/core/tasks`; `useFlag` không cần trong views nếu page đã gate.
- Produces: header render prop cho workspace TaskSurface.

- [ ] **Step 1: Failing tests — mode switcher exposes 5 modes; save view calls createTaskView; batch delete awaits server (no optimistic)**

- [ ] **Step 2: Transplant chrome; strip Multica brand; i18n keys; stub VCS/attachments actions with `capabilityState`; PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): port collection header filters views and batch bar

Saved views and pins use slice-2 hooks; missing capabilities stay disabled in place.

EOF
)"
```

---

### Task 9: Flag gate on `/tasks` + TaskSurfacePage

**Files:**

- Create: `packages/views/tasks/task-surface-page.tsx` (+ test)
- Modify: `apps/web/app/[orgSlug]/[workspaceSlug]/tasks/page.tsx`
- Modify: i18n keys used by page empty states

**Interfaces:**

```tsx
// task-surface-page.tsx
export function TaskSurfacePage(props: {
  workspaceId: string;
  onOpenTask: (id: string) => void;
}): JSX.Element;

// apps/web/.../tasks/page.tsx
const parity = useFlag("tasks_work_management_parity", false);
return parity
  ? <TaskSurfacePage workspaceId={workspace.id} onOpenTask={...} />
  : <TasksPageView workspaceId={workspace.id} onOpenTask={...} />;
```

`TaskSurfacePage` mounts `TaskSurface` với `scope={{ type:"workspace" }}`, `modes={["board","list","table","gantt","swimlane"]}`, `batchToolbar="list"`, header từ Task 8.

- [ ] **Step 1: Failing test — TaskSurfacePage renders mode group; MVP TasksPageView unchanged when tested in isolation**

- [ ] **Step 2: Wire page flag gate; PASS views tests; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): gate suite TaskSurface behind work management parity flag

Flag-off keeps MVP board/list; flag-on mounts the transplanted surface.

EOF
)"
```

---

### Task 10: `/my-tasks` route, paths, nav, four scopes

**Files:**

- Create: `packages/views/my-tasks/my-tasks-page.tsx`
- Create: `packages/views/my-tasks/my-tasks-header.tsx`
- Create: `packages/views/my-tasks/my-tasks-page.test.tsx`
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/my-tasks/page.tsx`
- Modify: `packages/core/paths/paths.ts` — `myTasks: () => \`${base}/my-tasks\``
- Modify: `packages/core/paths/consistency.test.ts` (+ reserved slug JSON + `pnpm generate:reserved-slugs` nếu cần)
- Modify: `packages/views/layout/app-sidebar.tsx` (+ `app-sidebar.test.tsx`) — item `nav.my_tasks`
- Modify: locales `nav.my_tasks`, `myTasks.*`
- Modify: `packages/views/package.json` export `./my-tasks/*`

**Interfaces:**

```tsx
export function MyTasksPageView(props: {
  workspaceId: string;
  userId: string;
  onOpenTask: (id: string) => void;
}): JSX.Element;
// TaskSurface scope type my + relation from myTasksViewStore
// modes={["board","list","table","swimlane"]}
// involved tab: if capability tasks.agent_runs unavailable → tab disabled + reason
```

Page host: nếu flag off → `CollectionPageState` “Chưa khả dụng” / redirect tasks **hoặc** ẩn nav (chọn: **nav chỉ hiện khi flag on**; deep link flag off → same unavailable state, không crash).

- [ ] **Step 1: Failing paths + sidebar + page tests**

```ts
expect(paths.workspace("acme", "team").myTasks()).toBe("/acme/team/my-tasks");
```

```tsx
it("switches assigned scope and requests relation=assigned", async () => { /* ... */ });
it("disables involved scope when agent_runs unavailable", async () => { /* ... */ });
```

- [ ] **Step 2: Implement; PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): add my-tasks page with four scopes behind parity flag

Reuses TaskSurface; agent-involved scope stays visible-disabled without fake data.

EOF
)"
```

---

### Task 11: i18n completeness + brand-scan green on real files

**Files:**

- Modify: `packages/core/i18n/locales/en/*.json`, `vi/*.json` — mọi key surface/modes/myTasks
- Modify: brand-scan script nếu cần exclude inventory-only paths
- Run: `pnpm lint` trên views (i18next/no-literal-string)

- [ ] **Step 1: Add failing locale key test hoặc lint run đỏ trên literal**

- [ ] **Step 2: Fill `vi`/`en`; strip residual source strings; `node --test scripts/tasks-collection-brand-scan.test.mjs` PASS; commit**

```bash
git commit -m "$(cat <<'EOF'
feat(i18n): add tasks collection and my-tasks locale keys

Keeps views free of source brand and literal Vietnamese/English JSX.

EOF
)"
```

---

### Task 12: Parity overlay slice 3 + E2E smoke

**Files:**

- Create: `docs/parity/tasks-work-management.slice3-verification.json`
- Modify: generator/merge path used by slice1/2 (cùng pattern `evidence_path` → surface/modes files)
- Create: `e2e/tasks-collection-parity-smoke.spec.ts` (skip/ok theo GATE_LEVEL)

**Interfaces:**

- Overlay entries cho `packages/views/issues/**` sources đã port → `verification_state: verified`.
- E2E: login → flag on (test harness / admin override nếu repo đã có pattern) → visit `/{org}/{ws}/tasks` và `/my-tasks` → expect mode controls; flag off → MVP board/list controls only.

- [ ] **Step 1: Failing manifest verification test nếu overlay schema sai**

- [ ] **Step 2: Write overlay + smoke; commit**

```bash
git commit -m "$(cat <<'EOF'
test(tasks): verify collection parity overlay and smoke routes

Pins slice-3 UI provenance and flag on/off entry behavior.

EOF
)"
```

---

### Task 13: Docs status, gate, PR

**Files:**

- Modify: `docs/superpowers/specs/2026-09-08-tasks-collection-surfaces-design.md` status → `shipped` khi gate xanh
- Modify: this plan status → `shipped`
- Modify: umbrella § status line (lát cắt 3 shipped; còn 4–8)
- Modify: roadmap F-05 note vẫn `MỘT PHẦN`

- [x] **Step 1: `make check-worktree` (hoặc `make check`) — must PASS**

- [x] **Step 2: `[agent]` comment trên issue; `make issue-pr`**

```bash
make issue-pr
# title: <KEY>: Task collection surfaces (UNI-426.3)
```

- [x] **Step 3: Không `make issue-done` — chỉ human**

---

## Self-review (plan author)

| Spec requirement | Task |
| --- | --- |
| 5 modes + filters + saved views/pins | 5–8 |
| `/tasks` + `/my-tasks` 4 scopes | 9–10 |
| Flag on suite / flag off MVP | 9–10 |
| Capability disabled in place | 5,7,8,10 |
| Transplant IssueSurface + rename | 1 rename map + 4–8 |
| No Projects/detail/hosts/cutover | inventory `skip_*`; out of file map |
| Brand scan + parity overlay | 1, 11–12 |
| max-lines / split large Multica files | Global + Tasks 6–8 |
| my-tasks relation API gap | Task 2 |

No TBD placeholders; types `TaskScope` / `TaskSurfaceProps` / `MyTasksRelation` consistent across tasks.
