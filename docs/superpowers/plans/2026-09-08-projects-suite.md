# UNI-426.4 · Projects suite Implementation Plan

> **Trạng thái:** in-progress — chờ sub-issue + SDD execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi flag `tasks_work_management_parity` bật, `/projects` và `/projects/{id}` chạy Projects suite (list + detail chrome + resources stub + Task Surface scoped theo project); flag tắt không lộ nav / route unavailable; không regress Tasks MVP.

**Architecture:** Transplant Multica `packages/views/projects/**` + `packages/core/projects/stores/view-store.ts` @ `3d37828e9` → UniWork `packages/views/projects/` + `packages/core/projects/`. Mở `TaskScope` project + suite `project_id` filter (Go + client). Detail embed `TaskSurface` lát 3 với `scope={ type:"project", projectId }` — không fork ProjectSurface. Title/description dùng Input/Textarea (không port Multica rich editor — lát 5).

**Tech Stack:** Next.js App Router (`apps/web` only), React 19, TanStack Query, Zustand (`packages/core`), Vitest + Testing Library, i18next, `@uniwork/ui`, feature flag F-11, Go/pgx/sqlc.

**Spec:** `docs/superpowers/specs/2026-09-08-projects-suite-design.md`  
**Umbrella:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md` §4.3, §11 mục 4  
**Baseline:** `multica/` @ `3d37828e9`  
**Tracking:** Parent `UNI-426`; sub-issue tạo ở Task 1; phụ thuộc `UNI-495` + `UNI-497` + `UNI-500` đã merge `develop`.

## Global Constraints

- Trước product code: tạo sub-issue dưới UNI-426 rồi `make issue-start KEY=<KEY>` từ `develop` đã có UNI-500; không code trên nhánh umbrella trừ khi đó là branch issue.
- Không branding nguồn (`multica`, `@multica/`, domain `Issue`) trong product/tests/i18n; tên nguồn chỉ trong plan/spec/`docs/parity/`.
- Giữ `Task` / `Công việc` / `/projects` / `Project`; cột Multica `issues` → `tasks`.
- Mọi JSX text trong `packages/views/` qua `t()`; `vi` đủ key.
- File `.ts`/`.tsx` product ≤ 500 lines; Multica `projects-page.tsx` / `project-detail.tsx` phải tách khi transplant.
- Server state chỉ TanStack Query; create/delete project/resource await server (không optimistic).
- Flag off: không nav Projects; route render unavailable nhẹ (bundle budget).
- Capability GitHub/local/Agent → disabled + reason; không gọi runtime.
- TDD từng task; commit conventional + `Refs` trailer; trước xong `make check-worktree` + `[agent]` comment.
- F-05 / umbrella vẫn `MỘT PHẦN` sau lát cắt này.

### Transplant rename map

| Nguồn | Đích |
| --- | --- |
| `Issue` / `issue` (domain) | `Task` / `task` |
| `issues` column / metrics | `tasks` |
| `@multica/core` / `@multica/ui` | `@uniwork/core` / `@uniwork/ui` |
| Multica project queries/mutations | `@uniwork/core` `hooks-projects` + `api/endpoints/projects` |
| `IssueSurface` | `TaskSurface` từ `@uniwork/views/tasks/surface/task-surface` |
| `text-faint-foreground` / legacy | semantic UniWork tokens only |
| Rich `TitleEditor` / `ContentEditor` | `Input` / `Textarea` + `usePutProject` (lát 5 mới port editor) |

### Modes trên project detail

| Route | `modes` |
| --- | --- |
| `/projects/{id}` TaskSurface | `["board","list","table","gantt","swimlane"]` — cùng workspace `/tasks` |

---

## File map

### Provenance

- Create: `docs/parity/projects-suite-inventory.json`
- Create: `scripts/projects-suite-brand-scan.test.mjs`
- Create: `docs/parity/tasks-work-management.slice4-verification.json`
- Wire brand-scan vào `scripts/check.sh` (cùng nhóm contract slice 3).

### Core — scope + query filter

- Modify: `packages/core/tasks/surface/scope.ts` (+ test) — thêm `{ type: "project"; projectId: string }`.
- Modify: `packages/core/tasks/surface/query-plan.ts` (+ test) — project → `workspace_query` | `table` với `project_id` trong body/filter.
- Modify: `server/pkg/db/queries/tasks.sql` — `QueryTasks` / `CountTasks` / table count+list queries nhận optional `project_id` (NULL = no filter).
- Modify: `server/internal/service/task_query.go` — `TaskQuery.ProjectID string`.
- Modify: `server/internal/service/task_table.go` — `TableFilter.ProjectIDs []string` (empty = none; non-empty = `project_id = ANY(...)`).
- Modify: handlers/SDI + `packages/core/api/endpoints/tasks-suite.ts` / `tasks-table.ts` (+ malformed tests).
- `make sqlc` sau khi sửa queries.

### Core — projects chrome store

- Create: `packages/core/projects/stores/view-store.ts` (+ test) — port Multica; persist qua `StorageAdapter` / workspace-aware pattern UniWork (không `localStorage` trực tiếp).
- Create: `packages/core/projects/config.ts` — status/priority order (port `multica/.../config.ts`, rename).
- Modify: `packages/core/package.json` exports `./projects/*` nếu cần.

### Views

- Create: `packages/views/projects/` — list page + split components; detail page + header/resources; `projects-unavailable.tsx`.
- Modify: `packages/views/tasks/surface/*` / controller — khi `scope.type === "project"`: khóa filter project; `surfaceKey` = `project:{id}`; tạo task mặc định gắn `project_id` nếu API create hỗ trợ (nếu chưa → create không gắn + note; không block list/read).
- Modify: `packages/views/layout/app-sidebar.tsx` — nav Projects khi flag on.
- Modify: `packages/views/package.json` exports.

### Web host

- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/projects/page.tsx`
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/projects/[projectId]/page.tsx`
- Modify: `packages/core/paths/paths.ts` — `projects()`, `project(id)`
- Reserved slug `projects` nếu cần + `pnpm generate:reserved-slugs`
- i18n: `packages/core/i18n/locales/{en,vi}.json` — `projects.*`

### Verification

- E2E: `e2e/projects-suite-parity-smoke.spec.ts`
- Update umbrella + roadmap F-05 note (vẫn `MỘT PHẦN`)

---

### Task 1: Issue branch, inventory, brand-scan gate

**Files:**

- Create: `docs/parity/projects-suite-inventory.json`
- Create: `scripts/projects-suite-brand-scan.test.mjs`
- Modify: `scripts/check.sh` (wire brand-scan nếu chưa auto-pick `scripts/*brand-scan*`)

**Interfaces:**

- Consumes: Multica @ `3d37828e9` under `packages/views/projects/**`, `packages/core/projects/**`, `apps/web/app/.../projects/**`.
- Produces: inventory `{schema_version:1, baseline_commit:"3d37828e9", owner_issue:"<KEY>", entries:[{source_path, target_path, disposition:"port"|"adapt"|"skip_detail"|"skip_later_slice"}]}`.

- [ ] **Step 1: Tạo UniAI sub-issue + `issue-start` từ develop**

```bash
git fetch origin develop && git checkout develop && git pull --ff-only
uniai issue create --title "UNI-426.4 · Projects suite" --parent UNI-426 \
  --description "Lát cắt 4 F-05. Spec: docs/superpowers/specs/2026-09-08-projects-suite-design.md. Plan: docs/superpowers/plans/2026-09-08-projects-suite.md. Phụ thuộc UNI-500."
# ghi KEY từ output
make issue-start KEY=<KEY>
# worktree path theo Makefile (thường .worktrees/<slug>)
```

Expected: branch `feature/<KEY>-...`, issue `in_progress`.

- [ ] **Step 2: Viết inventory JSON (liệt kê file Multica → target UniWork)**

Ít nhất cover: `projects-page.tsx`, `project-detail.tsx`, `project-resources-section.tsx`, `view-store.ts`, `config.ts`, web `projects/page.tsx`, `projects/[id]/page.tsx`. `ContentEditor`/mobile/desktop → `skip_later_slice`.

- [ ] **Step 3: Brand-scan test fail khi có `multica` trong `packages/views/projects/**`**

```js
// scripts/projects-suite-brand-scan.test.mjs — pattern giống tasks-collection-brand-scan
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["packages/views/projects"];
const BAD = [/multica/i, /@multica\//, /\bIssue\b/];

function walk(dir, out = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const re of BAD) {
      assert.equal(re.test(text), false, `${file} matched ${re}`);
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add docs/parity/projects-suite-inventory.json scripts/projects-suite-brand-scan.test.mjs scripts/check.sh
git commit -m "$(cat <<'EOF'
chore(projects): inventory + brand-scan gate for slice 4

EOF
)"
```

---

### Task 2: `TaskScope` project + query-plan

**Files:**

- Modify: `packages/core/tasks/surface/scope.ts`
- Modify: `packages/core/tasks/surface/scope.test.ts`
- Modify: `packages/core/tasks/surface/query-plan.ts`
- Modify: `packages/core/tasks/surface/query-plan.test.ts`

**Interfaces:**

- Produces:
  - `TaskScope` includes `{ type: "project"; projectId: string }`
  - `taskScopeKey({ type:"project", projectId:"p1" })` → `"project:p1"`
  - `planSurfaceQuery({ scope:{type:"project",projectId:"p1"}, viewMode:"board" })` → `{ kind:"workspace_query", queryBody:{ project_id:"p1" } }`
  - table mode → `{ kind:"table", tableBody:{ filter:{ project_ids:["p1"] } } }` (shape khớp Task 3)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { taskScopeKey, type TaskScope } from "./scope";
import { planSurfaceQuery } from "./query-plan";

describe("project scope", () => {
  it("keys project scopes", () => {
    const scope: TaskScope = { type: "project", projectId: "p1" };
    expect(taskScopeKey(scope)).toBe("project:p1");
  });

  it("plans board query with project_id", () => {
    expect(
      planSurfaceQuery({
        scope: { type: "project", projectId: "p1" },
        viewMode: "board",
      }),
    ).toEqual({
      kind: "workspace_query",
      queryBody: { project_id: "p1" },
    });
  });

  it("plans table filter with project_ids", () => {
    expect(
      planSurfaceQuery({
        scope: { type: "project", projectId: "p1" },
        viewMode: "table",
      }),
    ).toMatchObject({
      kind: "table",
      tableBody: { filter: { project_ids: ["p1"] } },
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/core && pnpm exec vitest run tasks/surface/scope.test.ts tasks/surface/query-plan.test.ts
```

- [ ] **Step 3: Implement**

```ts
// scope.ts — extend union
export type TaskScope =
  | { type: "workspace"; actorKind?: TaskActorKind }
  | { type: "my"; userId: string; relation: MyTasksRelation }
  | { type: "project"; projectId: string };

// taskScopeKey case:
case "project":
  return `project:${scope.projectId}`;

// query-plan.ts — before my/table/workspace branches, or after my:
if (input.scope.type === "project") {
  const projectId = input.scope.projectId;
  if (input.viewMode === "table") {
    return {
      kind: "table",
      tableBody: { filter: { project_ids: [projectId] } },
    };
  }
  return {
    kind: "workspace_query",
    queryBody: { project_id: projectId },
  };
}
```

- [ ] **Step 4: Tests PASS + commit**

```bash
git add packages/core/tasks/surface/
git commit -m "$(cat <<'EOF'
feat(tasks): add project TaskScope and query-plan

EOF
)"
```

---

### Task 3: Suite API `project_id` filter (Go + client)

**Files:**

- Modify: `server/pkg/db/queries/tasks.sql` (QueryTasks, CountTasks, CountTable*, ListTableTaskRows)
- Modify: `server/internal/service/task_query.go`, `task_table.go`
- Modify: SDI decode paths for query/table bodies
- Modify: `packages/core/api/endpoints/tasks-suite.ts`, `tasks-table.ts` (+ tests)
- Run: `make sqlc`
- Test: `server/internal/service/task_*_test.go` isolation project A vs B

**Interfaces:**

- Produces: `TaskQuery.ProjectID string`; empty = no filter. `TableFilter.ProjectIDs []string`. Client `QueryTasksBody.project_id?: string`; `TableFilter.project_ids?: string[]`.

- [ ] **Step 1: Failing Go test — two projects, query one**

```go
// In existing project/task service test file — pattern:
// create projectA, projectB; task on each; QueryTasks with ProjectID=projectA.ID
// expect only task A; TableGroups with ProjectIDs{projectA.ID} total == 1
```

- [ ] **Step 2: SQL — add optional project filter**

```sql
-- QueryTasks / CountTasks add:
AND (sqlc.narg('project_id')::text IS NULL OR project_id = sqlc.narg('project_id'))

-- Table queries add:
AND (NOT sqlc.arg('has_project_filter')::bool OR project_id = ANY(sqlc.arg('project_ids')::text[]))
```

Wire `HasProjectFilter` / `ProjectIds` in `tableFilterParams` giống assignee.

- [ ] **Step 3: `make sqlc` + service/handler + client schemas**

```ts
// tasks-suite.ts
export interface QueryTasksBody {
  status?: string;
  project_id?: string;
  limit?: number;
  offset?: number;
}

// tasks-table.ts
export interface TableFilter {
  statuses?: string[];
  priorities?: string[];
  assignee_ids?: string[];
  project_ids?: string[];
}
```

Thêm malformed-response case giữ degrade.

- [ ] **Step 4: `make test-go` subset + client vitest PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(tasks): filter suite query/table by project_id

EOF
)"
```

---

### Task 4: Projects view-store + config

**Files:**

- Create: `packages/core/projects/config.ts`
- Create: `packages/core/projects/stores/view-store.ts`
- Create: `packages/core/projects/stores/view-store.test.ts`
- Modify: `packages/core/package.json` exports

**Interfaces:**

- Produces: `useProjectViewStore` với `viewMode: "compact"|"comfortable"`, sort, `hiddenColumns`, `filters`, toggles; column key `"tasks"` (không `"issues"`); persist qua StorageAdapter UniWork.

- [ ] **Step 1: Failing test — default hidden includes `tasks`, not `issues`**

```ts
import { describe, expect, it } from "vitest";
import {
  PROJECT_DEFAULT_HIDDEN_COLUMNS,
  useProjectViewStore,
} from "./view-store";

describe("project view store", () => {
  it("hides tasks column by default", () => {
    expect(PROJECT_DEFAULT_HIDDEN_COLUMNS).toContain("tasks");
    expect(PROJECT_DEFAULT_HIDDEN_COLUMNS).not.toContain("issues");
  });

  it("toggles view mode", () => {
    useProjectViewStore.getState().setViewMode("comfortable");
    expect(useProjectViewStore.getState().viewMode).toBe("comfortable");
  });
});
```

- [ ] **Step 2: Port Multica store — rename issues→tasks; strip brand; StorageAdapter**

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projects): port list view-store and config

EOF
)"
```

---

### Task 5: Projects list UI (split modules)

**Files:**

- Create: `packages/views/projects/projects-list-page.tsx`
- Create: `packages/views/projects/projects-list-toolbar.tsx`
- Create: `packages/views/projects/projects-list-table.tsx`
- Create: `packages/views/projects/projects-list-grid.tsx`
- Create: `packages/views/projects/project-row-metrics.ts` (port `project-issue-metrics` → tasks)
- Create: `packages/views/projects/projects-list-page.test.tsx`
- Create: badges/icons/chips as needed under `components/` (≤500 lines each)

**Interfaces:**

- Consumes: `useProjects`, `useCreateProject`, `useDeleteProject`, `useProjectViewStore`, `useNavigation`, `paths`.
- Produces: `ProjectsListPage({ workspaceId, onOpenProject })`.

- [ ] **Step 1: Failing render test — shows title from listProjects mock**

```tsx
// mock @uniwork/core/api/http như views test setup; seed projects list
// expect screen.getByText("Q3 launch")
```

- [ ] **Step 2: Transplant Multica `projects-page.tsx` — tách toolbar/table/grid; mọi literal `t("projects.*")`; pin UI nếu hooks pins có, không thì disabled + reason**

- [ ] **Step 3: Tests PASS + brand-scan trên `packages/views/projects` PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projects): transplant projects list surfaces

EOF
)"
```

---

### Task 6: Resources section + capability stubs

**Files:**

- Create: `packages/views/projects/project-resources-section.tsx` (+ test)
- Create: `packages/views/projects/local-directory-hint.tsx` (adapt; disabled path)
- Port/adapt rename dialogs only if ≤ scope; GitHub connect controls = disabled

**Interfaces:**

- Consumes: `useProjectResources`, create/put/delete resource hooks.
- Produces: section listing resources; add `github_repo` / `local_directory` buttons `aria-disabled` + `t("projects.capability_unavailable")` khi chưa có capability registry entry `available`.

- [ ] **Step 1: Test — GitHub add control disabled with reason**

```tsx
expect(screen.getByRole("button", { name: /github/i })).toHaveAttribute(
  "aria-disabled",
  "true",
);
```

- [ ] **Step 2: Implement — CRUD label/position cho resource đã có; không import GitHub SDK / daemon**

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projects): resources section with capability stubs

EOF
)"
```

---

### Task 7: Project detail chrome + embed TaskSurface

**Files:**

- Create: `packages/views/projects/project-detail-page.tsx` (+ test)
- Create: `packages/views/projects/project-detail-header.tsx`
- Create: `packages/views/projects/project-properties.tsx` (status/priority/lead/dates — pickers đơn giản UniWork UI)
- Modify: `packages/views/tasks/surface/use-task-surface-controller.ts` (hoặc header filters) — lock project filter khi `scope.type==="project"`

**Interfaces:**

- Produces: `ProjectDetailPage({ workspaceId, projectId, onOpenTask, onBack })`
- Embed:

```tsx
<TaskSurface
  workspaceId={workspaceId}
  scope={{ type: "project", projectId }}
  modes={["board", "list", "table", "gantt", "swimlane"]}
  surfaceKey={`project:${projectId}`}
  onOpenTask={onOpenTask}
/>
```

- Title/description: controlled `Input`/`Textarea` + debounce/blur `usePutProject` với `ifMatch` revision; không port Multica editor.

- [ ] **Step 1: Failing test — mounts surface with project scope; mock query asserts `project_id` in body**

- [ ] **Step 2: Implement detail layout (BreadcrumbHeader); resources section; TaskSurface**

- [ ] **Step 3: Test isolation — tasks from other project không render**

- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projects): detail chrome with project-scoped TaskSurface

EOF
)"
```

---

### Task 8: Routes, paths, sidebar, unavailable

**Files:**

- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/projects/page.tsx`
- Create: `apps/web/app/[orgSlug]/[workspaceSlug]/projects/[projectId]/page.tsx`
- Create: `packages/views/projects/projects-unavailable.tsx`
- Create: `packages/views/projects/index.ts`
- Modify: `packages/core/paths/paths.ts`, consistency tests, reserved slugs
- Modify: `packages/views/layout/app-sidebar.tsx` (+ test)
- Modify: `packages/views/package.json` exports
- Lazy-load list/detail pages giống my-tasks nếu budget cần

**Interfaces:**

- `paths.workspace(org, ws).projects()` → `/{org}/{ws}/projects`
- `.project(id)` → `/{org}/{ws}/projects/{id}`

- [ ] **Step 1: Failing paths + sidebar test — Projects link only when flag true**

- [ ] **Step 2: Implement pages**

```tsx
// projects/page.tsx
const parity = useFlag("tasks_work_management_parity", false);
if (!parity) return <ProjectsUnavailable />;
return (
  <Suspense fallback={null}>
    <ProjectsListPage ... />
  </Suspense>
);
```

- [ ] **Step 3: `pnpm generate:reserved-slugs` nếu thêm slug; consistency tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projects): wire /projects routes and sidebar nav

EOF
)"
```

---

### Task 9: i18n + brand-scan green

**Files:**

- Modify: `packages/core/i18n/locales/en.json`, `vi.json`
- Ensure brand-scan covers locales product keys nếu slice 3 pattern có

- [ ] **Step 1: Add keys `projects.*` (list, detail, resources, unavailable, capability)** — không literal trong views

- [ ] **Step 2: `pnpm exec vitest run` brand-scan + i18n lint views PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(i18n): projects suite en/vi strings

EOF
)"
```

---

### Task 10: Parity overlay + E2E smoke

**Files:**

- Create: `docs/parity/tasks-work-management.slice4-verification.json`
- Modify: `scripts/task-parity-manifest.test.mjs` (merge slice4 overlay như slice3)
- Create: `e2e/projects-suite-parity-smoke.spec.ts`

- [ ] **Step 1: Overlay entries cho list/detail/resources ported**

- [ ] **Step 2: E2E smoke**

```ts
// flag on: goto /projects expect heading; create/open project if seed allows; goto detail expect TaskSurface chrome
// flag off: sidebar Projects hidden; /projects shows unavailable
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(projects): parity overlay and e2e smoke

EOF
)"
```

---

### Task 11: Docs status, gate, PR

**Files:**

- Modify: spec status → plan path; umbrella status line (slice 4 shipped khi xong)
- Modify: `docs/roadmap/FEATURE_ROADMAP.md` F-05 note (vẫn `MỘT PHẦN`, thêm slice 4)
- Modify: plan header `> **Trạng thái:**`

- [ ] **Step 1: `make check-worktree` PASS**

- [ ] **Step 2: `make issue-pr` / mở PR vào `develop` với KEY trong title**

- [ ] **Step 3: `[agent]` comment trên issue — PR URL + residual risks (rich editor deferred, GitHub/local stub)**

- [ ] **Step 4: Không `make issue-done` (human)**

---

## Spec coverage (self-review)

| Spec requirement | Task |
| --- | --- |
| Full list + detail + resources + scoped Surface + nav | 5–8 |
| Same flag on/off | 8 |
| Multica transplant + TaskSurface embed | 5–7 |
| `TaskScope` project + server `project_id` | 2–3 |
| Capability disabled GitHub/local | 6 |
| No rich editor / no hosts / no cutover | explicit skip Task 7 / Global |
| Brand-scan + parity + e2e + check | 1, 9–11 |
| Bundle budget via unavailable + lazy | 8 |

**Placeholder scan:** none intentional.  
**Type consistency:** `project_id` (query body singular) / `project_ids` (table filter array) as defined Tasks 2–3.
