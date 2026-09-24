# Task filter parity (Multica → UniWork) Implementation Plan

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire full Multica-shaped task filters on every UniWork collection surface — menu, chips, baseline, `filter.ts`, expanded `tablequery` — and remove `filters_not_wired`.

**Architecture:** Hybrid. Zustand view store remains the source of truth. Table-backed modes (table + status board that already uses table groups/rows) send an expanded `TableFilter` to the server. Load-flat modes (list / gantt / swimlane / my-tasks list path) run `applyTaskFilters` on the fetched `Task[]` (plus client-only `showSubTasks` / `agentRunning`). Missing capabilities (squad, agents-working without projection) stay visible but disabled with `reason_code`.

**Tech Stack:** TypeScript (packages/views + packages/core), Vitest, Go (`server/pkg/db/tablequery` + handler SDI), Chi, Zustand, TanStack Query, Playwright e2e smoke.

**Spec:** `docs/superpowers/specs/2026-09-18-task-filter-parity-design.md`  
**Issue:** UNI-702 (parent UNI-426)  
**Baseline:** `multica/` @ `3d37828e9`

## Global Constraints

- Domain naming: `task` / công việc — never ship `issue` or `multica` in product source (`scripts/no-usf-leak.test.mjs`).
- Actor kinds on the wire: UniWork uses `human` | `agent` (ADR 0007). Store `ActorFilterValue.type` keeps Multica-shaped `member` | `agent` | `squad`; map `member` ↔ `human` at the filter/query boundary only.
- `Task` DTO has **no** `labels` field; label filter for table is **server-only**. Client `applyTaskFilters` accepts optional `labelsByTaskId` for tests / future enrichers; without it, an active `labelFilters` list matches nothing (fail-closed) so we never silently ignore label chips on load-flat modes that lack label data — prefer routing those modes through table filter when labels are selected, or stub the dimension until list query gains labels (Task 8 chooses tableFilter merge for table-backed paths).
- Table SQL only via `server/pkg/db/tablequery` (ADR 0020); parameterized `$n`; always start with org/workspace clause.
- Capability missing → disabled + `reason_code`, never hide, never call missing APIs.
- i18n: every JSX string in `packages/views` through `t()`.
- File size: `.ts`/`.tsx` ≤ 500 lines (max-lines). Split Multica’s monolithic header filter into `packages/views/tasks/filters/`.
- Verification: TDD + narrow package/file tests. **Do not** run `make check` / `check-full` as a gate for this issue.
- Commits: conventional prefixes; branch already carries `Refs: UNI-702` via hook.

## File map

| Path | Role |
| --- | --- |
| `packages/views/tasks/utils/filter.ts` | Port Multica `applyIssueFilters` → `applyTaskFilters` |
| `packages/views/tasks/utils/filter.test.ts` | Unit tests for filter util |
| `packages/core/tasks/views/baseline.ts` | `TaskViewBaseline`, `actorFilterKey`, `baselineFromQuery` |
| `packages/core/tasks/views/baseline.test.ts` | Baseline unit tests |
| `packages/core/tasks/filters/map-store-to-table-filter.ts` | Store snapshot → `TableFilter` |
| `packages/core/tasks/filters/map-store-to-table-filter.test.ts` | Mapper tests |
| `packages/core/api/endpoints/tasks-table.ts` | Expand `TableFilter` interface |
| `server/pkg/db/tablequery/query.go` | Expand `Filter` struct + `Normalize` |
| `server/pkg/db/tablequery/build.go` | SQL for new filter fields |
| `server/pkg/db/tablequery/*_test.go` | Go builder tests |
| `server/internal/handler/dto/sdi/task.go` | Expand `TableFilterSDI` |
| `server/internal/handler/task_table.go` | Map new SDI fields into service input |
| `server/internal/service/task_table*.go` | Pass-through into `tablequery.Query` |
| `packages/views/tasks/filters/*` | `TaskFilterMenu` + submenus (split modules) |
| `packages/views/tasks/views/filter-chips-bar.tsx` | Full chips + baseline |
| `packages/views/tasks/views/task-display-controls.tsx` | `TASK_FILTERS_WIRED = true` |
| `packages/views/tasks/views/save-view-filter-menu.tsx` | Align `__none__` / property options |
| `packages/views/tasks/surface/use-task-surface-controller.ts` | Merge store → `tableFilter`; apply client filters |
| `packages/views/tasks/surface/task-surface-projection.ts` | Call `applyTaskFilters` beside `showSubTasks` |
| `e2e/tasks-collection-parity-smoke.spec.ts` | Drop `filters_not_wired`; smoke add/clear |
| `docs/parity/tasks-collection-surfaces-inventory.json` | Mark `filter.ts` evidence |

---

### Task 1: `applyTaskFilters` util (port Multica `filter.ts`)

**Files:**
- Create: `packages/views/tasks/utils/filter.ts`
- Create: `packages/views/tasks/utils/filter.test.ts`
- Reference: `multica/packages/views/issues/utils/filter.ts` + `filter.test.ts`

**Interfaces:**
- Consumes: `Task` from `@uniwork/core/types`; `ActorFilterValue`, `TaskPriority`, `TaskStatusKey` from view-store types
- Produces:
  - `export const NO_PROPERTY_VALUE = "__none__"`
  - `export interface TaskFilterState { statusFilters: string[]; priorityFilters: TaskPriority[]; assigneeFilters: ActorFilterValue[]; includeNoAssignee: boolean; assigneeFilterActive?: boolean; creatorFilters: ActorFilterValue[]; projectFilters: string[]; includeNoProject: boolean; labelFilters: string[]; propertyFilters?: Record<string, string[]>; workingOnly: boolean; showSubTasks?: boolean; }`
  - `export interface TaskFilterContext { runningTaskIds?: ReadonlySet<string>; labelsByTaskId?: ReadonlyMap<string, readonly { id: string }[]>; }`
  - `export function applyTaskFilters(tasks: Task[], filters: TaskFilterState, context?: TaskFilterContext): Task[]`
  - `export function taskMatchesPropertyFilters(task: Task, propertyFilters: Record<string, string[]> | undefined): boolean`
  - `export function filterTasks(tasks: Task[], filters: TaskFilters): Task[]` (wrapper mapping `agentRunningFilter` → `workingOnly`)

- [ ] **Step 1: Write the failing test**

Create `packages/views/tasks/utils/filter.test.ts` (node env). Minimal fixture:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyTaskFilters,
  filterTasks,
  NO_PROPERTY_VALUE,
  type TaskFilters,
} from "./filter";
import type { Task } from "@uniwork/core/types";

const NO_FILTER: TaskFilters = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    organization_id: "org-1",
    workspace_id: "ws-1",
    number: 1,
    identifier: "UW-1",
    revision: 1,
    title: "Test",
    description: "",
    status: "todo",
    priority: "medium",
    assignee_id: undefined,
    assignee_kind: "human",
    project_id: null,
    parent_task_id: null,
    position: 0,
    kind: "normal",
    created_by: "u-1",
    created_by_kind: "human",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    properties: {},
    reactions: [],
    ...overrides,
  } as Task;
}

describe("filterTasks", () => {
  it("filters by status", () => {
    const tasks = [
      makeTask({ id: "1", status: "todo" }),
      makeTask({ id: "2", status: "done" }),
    ];
    expect(
      filterTasks(tasks, { ...NO_FILTER, statusFilters: ["todo"] }).map((t) => t.id),
    ).toEqual(["1"]);
  });

  it("maps member actor filter onto human assignee_kind", () => {
    const tasks = [
      makeTask({ id: "1", assignee_id: "u-1", assignee_kind: "human" }),
      makeTask({ id: "2", assignee_id: "a-1", assignee_kind: "agent" }),
    ];
    expect(
      filterTasks(tasks, {
        ...NO_FILTER,
        assigneeFilters: [{ type: "member", id: "u-1" }],
      }).map((t) => t.id),
    ).toEqual(["1"]);
  });

  it("matches NO_PROPERTY_VALUE when property unset", () => {
    const tasks = [
      makeTask({ id: "1", properties: {} }),
      makeTask({ id: "2", properties: { p1: "opt-a" } }),
    ];
    expect(
      filterTasks(tasks, {
        ...NO_FILTER,
        propertyFilters: { p1: [NO_PROPERTY_VALUE] },
      }).map((t) => t.id),
    ).toEqual(["1"]);
  });

  it("hides sub-tasks when showSubTasks is false", () => {
    const tasks = [
      makeTask({ id: "1", parent_task_id: null }),
      makeTask({ id: "2", parent_task_id: "1" }),
    ];
    expect(
      filterTasks(tasks, { ...NO_FILTER, showSubTasks: false }).map((t) => t.id),
    ).toEqual(["1"]);
  });

  it("fail-closed on labelFilters without labelsByTaskId", () => {
    const tasks = [makeTask({ id: "1" })];
    expect(
      applyTaskFilters(
        tasks,
        {
          ...NO_FILTER,
          labelFilters: ["l1"],
          workingOnly: false,
        },
        {},
      ),
    ).toEqual([]);
  });
});
```

Port the remaining Multica cases from `multica/.../filter.test.ts` (priority, no-assignee, creator via `created_by`/`created_by_kind`, project±no, property select/multi/checkbox, agentRunning empty set) — rename Issue→Task fields as above.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniwork/views exec vitest run tasks/utils/filter.test.ts`  
Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Write minimal implementation**

Port `multica/packages/views/issues/utils/filter.ts` into `packages/views/tasks/utils/filter.ts` with these renames:

| Multica | UniWork |
| --- | --- |
| `Issue` | `Task` |
| `parent_issue_id` | `parent_task_id` |
| `assignee_type` / `creator_type` | map via helpers: store `member` ↔ task `human`; `agent`↔`agent`; `squad` never matches a task assignee_kind today |
| `creator_id` | `created_by` |
| `showSubIssues` | `showSubTasks` |
| `runningIssueIds` | `runningTaskIds` |
| `issue.labels` | `context.labelsByTaskId?.get(task.id)` |

Assignee match helper:

```ts
function actorKindMatches(
  filterType: ActorFilterValue["type"],
  taskKind: string | undefined,
): boolean {
  if (filterType === "member") return taskKind === "human" || taskKind === "member";
  if (filterType === "agent") return taskKind === "agent";
  return false; // squad: no task kind yet
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniwork/views exec vitest run tasks/utils/filter.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/views/tasks/utils/filter.ts packages/views/tasks/utils/filter.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): port applyTaskFilters from Multica filter util

Client-side positive-selection filters for load-flat surfaces, with
member↔human mapping and fail-closed labels without a label map.

EOF
)"
```

---

### Task 2: Saved-view baseline helpers

**Files:**
- Create: `packages/core/tasks/views/baseline.ts`
- Create: `packages/core/tasks/views/baseline.test.ts`
- Reference: `multica/packages/core/issue-views/baseline.ts`

**Interfaces:**
- Consumes: `ActorFilterValue`, `FilterSnapshot`, `TaskPriority` from `../stores/view-store-types`; `TASK_PRIORITIES`
- Produces:
  - `export interface TaskViewBaseline { status: Set<string>; priority: Set<string>; assignee: Set<string>; includeNoAssignee: boolean; creator: Set<string>; project: Set<string>; includeNoProject: boolean; label: Set<string>; property: Map<string, Set<string>>; raw: FilterSnapshot; }`
  - `export function actorFilterKey(actor: ActorFilterValue): string`
  - `export function baselineFromQuery(query: Record<string, unknown>): TaskViewBaseline`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { actorFilterKey, baselineFromQuery } from "./baseline";

describe("baselineFromQuery", () => {
  it("builds sets and raw snapshot from a saved-view query blob", () => {
    const baseline = baselineFromQuery({
      statusFilters: ["todo", "custom_qa"],
      priorityFilters: ["high", "nope"],
      assigneeFilters: [{ type: "member", id: "u1" }],
      includeNoAssignee: true,
      creatorFilters: [],
      projectFilters: ["p1"],
      includeNoProject: false,
      labelFilters: ["l1"],
      propertyFilters: { prop1: ["opt1"] },
    });
    expect(baseline.status.has("custom_qa")).toBe(true);
    expect(baseline.priority.has("high")).toBe(true);
    expect(baseline.priority.has("nope")).toBe(false);
    expect(baseline.assignee.has(actorFilterKey({ type: "member", id: "u1" }))).toBe(true);
    expect(baseline.includeNoAssignee).toBe(true);
    expect(baseline.raw.statusFilters).toEqual(["todo", "custom_qa"]);
    expect(baseline.property.get("prop1")?.has("opt1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniwork/core exec vitest run tasks/views/baseline.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Copy Multica `baseline.ts`, rename `IssueViewBaseline` → `TaskViewBaseline`, import UniWork types, keep status keys as any non-empty string (custom statuses).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniwork/core exec vitest run tasks/views/baseline.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/tasks/views/baseline.ts packages/core/tasks/views/baseline.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): add TaskViewBaseline for saved-view filter deltas

EOF
)"
```

---

### Task 3: `mapStoreToTableFilter` + expand client `TableFilter`

**Files:**
- Modify: `packages/core/api/endpoints/tasks-table.ts` (`TableFilter` interface ~L6–11)
- Create: `packages/core/tasks/filters/map-store-to-table-filter.ts`
- Create: `packages/core/tasks/filters/map-store-to-table-filter.test.ts`
- Modify: `packages/core/api/endpoints/tasks-table.test.ts` (malformed / round-trip if body shape changes)

**Interfaces:**
- Consumes: `FilterSnapshot`, `TaskDateFilter` from view-store-types; existing `TableFilter`
- Produces expanded:

Keep existing `statuses` / `priorities` / `assignee_ids` / `project_ids`. Add only:

```ts
  include_no_assignee?: boolean;
  include_no_project?: boolean;
  creator_refs?: string[]; // "human:<id>" | "agent:<id>"
  label_ids?: string[];
  properties?: Record<string, string[]>;
  date_field?: "created_at" | "updated_at";
  date_from?: string; // YYYY-MM-DD
  date_to?: string;
```

Map store assignees: push each selected actor `id` into `assignee_ids` (ULIDs are unique across humans/agents). Squad filters are omitted (UI stubbed). Creators use `creator_refs` with `member` → `human:<id>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapStoreToTableFilter } from "./map-store-to-table-filter";
import type { FilterSnapshot } from "../stores/view-store-types";

const empty: FilterSnapshot = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
  propertyFilters: {},
};

describe("mapStoreToTableFilter", () => {
  it("drops empty arrays and omits project when locked", () => {
    expect(
      mapStoreToTableFilter(
        {
          ...empty,
          statusFilters: ["todo"],
          projectFilters: ["p1"],
          includeNoProject: true,
        },
        { lockProjectFilter: true },
      ),
    ).toEqual({ statuses: ["todo"] });
  });

  it("maps creators to creator_refs and properties including __none__", () => {
    expect(
      mapStoreToTableFilter({
        ...empty,
        creatorFilters: [{ type: "member", id: "u1" }],
        propertyFilters: { p1: ["__none__", "opt"] },
        labelFilters: ["l1"],
        includeNoAssignee: true,
      }),
    ).toEqual({
      creator_refs: ["human:u1"],
      properties: { p1: ["__none__", "opt"] },
      label_ids: ["l1"],
      include_no_assignee: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniwork/core exec vitest run tasks/filters/map-store-to-table-filter.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement mapper + extend `TableFilter`**

Implement `mapStoreToTableFilter(snapshot, opts?: { lockProjectFilter?: boolean; dateFilter?: TaskDateFilter | null }): TableFilter` — omit keys with empty arrays; never send `project_*` when `lockProjectFilter`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @uniwork/core exec vitest run tasks/filters/map-store-to-table-filter.test.ts tasks-table.test.ts`  
Expected: PASS (update `tasks-table.test.ts` only if serialization assertions list exact keys)

- [ ] **Step 5: Commit**

```bash
git add packages/core/api/endpoints/tasks-table.ts packages/core/tasks/filters/
git commit -m "$(cat <<'EOF'
feat(tasks): map view-store filters onto expanded TableFilter

EOF
)"
```

---

### Task 4: Expand Go `tablequery.Filter` + SQL

**Files:**
- Modify: `server/pkg/db/tablequery/query.go` (`Filter` + `Normalize`)
- Modify: `server/pkg/db/tablequery/build.go` (`memberFilters`)
- Create or extend: `server/pkg/db/tablequery/filter_test.go` (builder SQL assertions)
- Modify: service/handler mapping in Task 5 (can stub fields in Query first, wire HTTP in Task 5)

**Interfaces:**
- Produces Go:

```go
type Filter struct {
	Statuses          []string
	Priorities        []string
	AssigneeIDs       []string
	IncludeNoAssignee bool
	ProjectIDs        []string
	IncludeNoProject  bool
	CreatorRefs       []string // "human:id" / "agent:id"
	LabelIDs          []string
	Properties        map[string][]string // def id → option ids; "__none__" = unset
	DateField         string              // created_at|updated_at|""
	DateFrom          string              // YYYY-MM-DD or ""
	DateTo            string
}
```

- [ ] **Step 1: Write the failing Go test**

In `server/pkg/db/tablequery/filter_build_test.go`:

```go
func TestMemberFiltersIncludeLabelAndNoAssignee(t *testing.T) {
	q := Query{
		OrganizationID: "o",
		WorkspaceID:    "w",
		Filter: Filter{
			IncludeNoAssignee: true,
			LabelIDs:          []string{"l1"},
			Properties:        map[string][]string{"p1": {"__none__"}},
			DateField:         "created_at",
			DateFrom:          "2026-01-01",
			DateTo:            "2026-01-31",
		},
	}.Normalize()
	sql, args := BuildGroups(GroupsRequest{Query: q}) // use the real exported builder entry used by facets/groups
	// Assert SQL contains task_labels join / assignee_id IS NULL branch / properties JSON path / created_at range
	// Assert every dynamic value appears only as $n in args — never concatenated.
	if !strings.Contains(sql, "assignee_id IS NULL") { // adjust to exact clause you implement
		t.Fatalf("missing no-assignee clause: %s", sql)
	}
	_ = args
}
```

Look at existing `build_test.go` / `BuildGroups` signatures and mirror their assert style — do not invent a non-existent export.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./pkg/db/tablequery/ -run TestMemberFiltersIncludeLabelAndNoAssignee -count=1`  
Expected: FAIL (fields missing or clause absent)

- [ ] **Step 3: Implement Filter + SQL**

Semantics (match Multica / positive selection):

- Non-empty `Statuses` / `Priorities` / `AssigneeIDs` / `ProjectIDs` / `LabelIDs`: `IN (...)`.
- `IncludeNoAssignee` with empty `AssigneeIDs`: `assignee_id IS NULL`.
- Both: `(assignee_id IS NULL OR assignee_id IN (...))`.
- Same pattern for project / `IncludeNoProject`.
- `CreatorRefs`: parse `human|agent` + id; `(created_by_kind, created_by) IN (...)`.
- `LabelIDs`: `EXISTS (SELECT 1 FROM task_label_links …)` — **use the real junction table name** from migrations (`task_to_label` / whatever UniWork uses; grep `server/migrations` + `queries`).
- `Properties`: for each def id, OR of option matches; `__none__` means property key absent / null in `tasks.properties` JSONB.
- Date: `alias.created_at::date` (or `updated_at`) between `$from` and `$to` inclusive.

Update `Normalize` to sort/dedupe new slices; deep-copy/normalize `Properties` map keys.

- [ ] **Step 4: Run tests**

Run: `cd server && go test ./pkg/db/tablequery/ -count=1`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/tablequery/
git commit -m "$(cat <<'EOF'
feat(tasks): expand tablequery.Filter for label, creator, property, date

EOF
)"
```

---

### Task 5: Wire SDI → service → tablequery

**Files:**
- Modify: `server/internal/handler/dto/sdi/task.go` (`TableFilterSDI`)
- Modify: `server/internal/handler/task_table.go` (`tableQueryInputFromSDI`)
- Modify: `server/internal/service/task_table.go` (or wherever `TableQueryInput.Filter` is defined) to carry new fields into `tablequery.Filter`
- Test: extend an existing `task_table_test.go` case with label/date filter (integration against test DB)

- [ ] **Step 1: Write failing service/handler test**

Add to `server/internal/service/task_table_test.go` a case: two tasks, one with label L, filter `LabelIDs: []string{L}` → groups/rows total 1. Follow existing fixture helpers in that file.

- [ ] **Step 2: Run to see FAIL**

Run: `cd server && go test ./internal/service/ -run TestTable.*Label -count=1`  
Expected: FAIL or compile error until SDI/service fields exist

- [ ] **Step 3: Implement mapping**

JSON tags on SDI must match client `TableFilter` (`include_no_assignee`, `creator_refs`, `label_ids`, `properties`, `date_field`, `date_from`, `date_to`).

- [ ] **Step 4: Run tests**

Run: `cd server && go test ./internal/service/ -run Table -count=1` and `go test ./internal/handler/ -run Table -count=1` if handler tests exist  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/dto/sdi/task.go server/internal/handler/task_table.go server/internal/service/
git commit -m "$(cat <<'EOF'
feat(tasks): expose expanded table filter fields on HTTP SDI

EOF
)"
```

---

### Task 6: `TaskFilterMenu` modules + enable Add filter

**Files:**
- Create: `packages/views/tasks/filters/task-filter-menu.tsx` (shell)
- Create: `packages/views/tasks/filters/filter-assignee-options.tsx`
- Create: `packages/views/tasks/filters/filter-project-options.tsx`
- Create: `packages/views/tasks/filters/filter-label-options.tsx`
- Create: `packages/views/tasks/filters/filter-property-options.tsx`
- Create: `packages/views/tasks/filters/filter-date-panel.tsx`
- Create: `packages/views/tasks/filters/task-filter-menu.test.tsx`
- Modify: `packages/views/tasks/views/task-display-controls.tsx` — set `TASK_FILTERS_WIRED = true`; render new menu; remove `filters_not_wired` stub path
- Reference UI: `multica/packages/views/issues/components/issues-header.tsx` (`IssueFilterMenu` ~L1182+)

**Interfaces:**
- Consumes: `useViewStore`, `TaskViewBaseline`, `useTableFacets` counts from controller props, `capabilityState(..., "tasks.squads")`
- Produces: `export function TaskFilterMenu(props: { … viewBaseline?: TaskViewBaseline; tableFacetCounts?: …; onTableFacetChange?: …; dateFilter?: …; onDateFilterChange?: …; freezeAnchor?: boolean; lockProjectFilter?: boolean; trigger: ReactElement }): JSX.Element`

- [ ] **Step 1: Write failing component test**

```tsx
it("enables Add filter and lists status options from the store", async () => {
  // mount TaskDisplayControls inside ViewStoreProvider + QueryClient
  // click data-testid="task-filter-add"
  // expect status checkbox for todo; expect no data-reason-code=filters_not_wired
});

it("disables squad assignee row when tasks.squads is unavailable", async () => {
  // public config stub capability unavailable
  // open assignee submenu — squad group disabled with reason
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `pnpm --filter @uniwork/views exec vitest run tasks/filters/task-filter-menu.test.tsx tasks/views/task-display-controls`  
Expected: FAIL

- [ ] **Step 3: Implement menu by transplanting Multica submenus**

Port submenu bodies from Multica header into the split files above. Wire toggles to existing store actions. Status options: prefer workspace catalog hook (`useTaskStatuses`) like Multica `useStatusOptions`, not only `TASK_STATUSES` constant. Property options include `NO_PROPERTY_VALUE`. Date panel writes `setDateFilter`. Squad section: if `capabilityState !== available`, render disabled items + tooltip; do not call squad list API.

Keep each file under 500 lines.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/views/tasks/filters/ packages/views/tasks/views/task-display-controls.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): enable TaskFilterMenu parity UI and clear filters_not_wired

EOF
)"
```

---

### Task 7: `FilterChipsBar` full dimensions + baseline

**Files:**
- Modify: `packages/views/tasks/views/filter-chips-bar.tsx`
- Create: `packages/views/tasks/views/filter-chips-bar.test.tsx` (or `.test.ts` for pure helpers)
- Align: `packages/views/tasks/views/save-view-filter-menu.tsx` / `save-view-filter-chip.tsx` with same dimensions + `__none__` labels

**Interfaces:**
- Props add `viewBaseline?: TaskViewBaseline` (from Multica). Clear dimension uses `resetFiltersTo` when baseline present (copy Multica `clearDimension` switch from `filter-chips-bar.tsx` L252–306).

- [ ] **Step 1: Failing test** — chip appears for label filter; removing status chip with baseline restores `baseline.raw.statusFilters`, not `[]`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** — port Multica chip builders (status/priority/assignee/creator/project/label/property/date). Reuse SaveView previews where possible. Count active filters with baseline delta (Multica `getActiveFilterCount`).

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/views/tasks/views/filter-chips-bar.tsx packages/views/tasks/views/filter-chips-bar.test.tsx packages/views/tasks/views/save-view-filter-*.tsx
git commit -m "$(cat <<'EOF'
feat(tasks): FilterChipsBar full dimensions with saved-view baseline

EOF
)"
```

---

### Task 8: Wire surface controller + projection

**Files:**
- Modify: `packages/views/tasks/surface/use-task-surface-controller.ts`
- Modify: `packages/core/tasks/surface/query-plan.ts` (merge filters into `tableBody.filter`)
- Modify: `packages/views/tasks/surface/task-surface-projection.ts`
- Modify: `packages/views/tasks/surface/task-surface.tsx` / headers to pass `viewBaseline`, facet handlers, date props into menu/chips
- Tests: `packages/views/tasks/surface/task-surface.test.tsx`, `task-surface-projection.test.ts`, `packages/core/tasks/surface/query-plan.test.ts`

**Interfaces:**
- Produces: `tableFilter` derived from `mapStoreToTableFilter(snapshot, { lockProjectFilter: scope.type === "project", dateFilter })` merged with scope `project_ids`.
- `surfaceTasks` for non-table: `applyTaskFilters(projectSurfaceTasks(...), storeAsFilterState, { runningTaskIds })`.
- Agents working: if projection/hook missing, keep toggle disabled (`reason_code`); if present, set `agentRunningFilter` and pass `runningTaskIds`.

- [ ] **Step 1: Failing tests**

```ts
it("puts statusFilters into tableBody.filter.statuses", () => { … });
it("applies client status filter on load-flat projection", () => { … });
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement wiring**

Read store fields in controller; build snapshot; set query plan filter; for `tableEnabled` / `tableBoardEnabled` do **not** double-filter client-side on dimensions already sent to server (only apply client-only: `agentRunning` + optionally `showSubTasks` already handled). For load-flat, full `applyTaskFilters`.

Pass `viewBaseline` from active saved view hook if one is open (`useActiveView` / existing prefs) — if hook already exposes query blob, `baselineFromQuery(view.query)`.

- [ ] **Step 4: Run surface + query-plan tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/views/tasks/surface/ packages/core/tasks/surface/query-plan.ts packages/core/tasks/surface/query-plan.test.ts
git commit -m "$(cat <<'EOF'
feat(tasks): wire view-store filters into table query and load-flat projection

EOF
)"
```

---

### Task 9: E2E smoke, parity inventory, i18n, UniAI note

**Files:**
- Modify: `e2e/tasks-collection-parity-smoke.spec.ts` — remove expect `filters_not_wired`; add: click Add filter → check status → expect row set narrows / chip visible → Clear
- Modify: `docs/parity/tasks-collection-surfaces-inventory.json` — set `evidence_path` for `packages/views/tasks/utils/filter.ts`
- Modify: locale files under `packages/core/i18n/locales/` for any new filter keys (`filters.unavailable` may become unused — remove dead keys only if knip/i18n checks require)
- Optional: `make issue-sub PARENT=UNI-702 TITLE="…"` for leftover follow-ups (squad runtime, list-API labels)

- [ ] **Step 1: Update e2e spec (fail if app still stubs)**

- [ ] **Step 2: Run narrow e2e** (app must already be running locally):

Run: `pnpm --filter uniwork-e2e exec playwright test tasks-collection-parity-smoke.spec.ts`  
(Adjust package name to whatever `e2e/package.json` uses; if unknown: `cd e2e && pnpm exec playwright test tasks-collection-parity-smoke.spec.ts`)  
Expected: PASS  
**Do not** run `make check`.

- [ ] **Step 3: Parity inventory + i18n commits**

- [ ] **Step 4: Agent comment on UNI-702** with commands actually run and remaining gaps

- [ ] **Step 5: Commit**

```bash
git add e2e/tasks-collection-parity-smoke.spec.ts docs/parity/ packages/core/i18n/
git commit -m "$(cat <<'EOF'
test(tasks): filter smoke replaces filters_not_wired assert

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
| --- | --- |
| Port `filter.ts` + tests | T1 |
| Baseline helpers | T2 |
| Expand `TableFilter` / `tablequery` + label/creator/property/date/no-* | T3–T5 |
| Full `TaskFilterMenu` + `TASK_FILTERS_WIRED` | T6 |
| Chips + baseline delta | T7 |
| All surfaces/modes wire | T8 |
| Stub squad / agents-working | T6 + T8 |
| Facet counts on table | T6 props + existing `useTableFacets` in controller (T8 passes through) |
| E2E drop `filters_not_wired` | T9 |
| No `make check` in DoD | Global Constraints + T9 |
| max-lines / split menu | T6 file map |
| Parity inventory `filter.ts` | T9 |

**Placeholder scan:** none intentional; Go SQL exact table names must be taken from migrations at implement time (called out in T4).  
**Type consistency:** `NO_PROPERTY_VALUE`, `creator_refs`, `TaskViewBaseline`, `mapStoreToTableFilter` naming is stable across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-18-task-filter-parity.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
