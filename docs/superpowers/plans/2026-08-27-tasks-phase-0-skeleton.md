# Tasks Phase 0 — Skeleton (Multica Issues parity) Implementation Plan

> **Trạng thái:** superseded — bởi `docs/superpowers/specs/2026-09-04-tasks-complete-design.md` (2026-09-04): mã vẫn ở mức 4 status, chưa có `task_statuses`/`identifier`; phần còn lại làm trong F-05.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MVP `tasks` schema/API/UI path with Multica-shaped tasks: 7 built-in statuses, `number`/`identifier`, workspace `task_prefix`, seeded `task_statuses`, and board/list/detail that create/list/update/delete on the new model.

**Architecture:** New migrations (008+) evolve `tasks` and add `task_statuses` + workspace prefix/counter (no rewrite of 001–004). Go validates the 7 built-in status keys and seeds catalog rows on workspace create; FE types/endpoints widen; board columns become the 7 categories. Custom status CRUD, labels, projects, views, agent runtime stay out of this plan (later phases).

**Tech Stack:** Go (Chi, pgx, sqlc), React Query, Zod `parseWithFallback`, Vitest, existing `@dnd-kit` board.

**Spec:** `docs/superpowers/specs/2026-08-27-tasks-multica-parity-design.md` (Phase 0 only)

## Global Constraints

- No `FOREIGN KEY` / cascading deletes in migrations after 004; relationships enforced in service + tx.
- Indexes after 004: `CREATE INDEX CONCURRENTLY` (or `UNIQUE … CONCURRENTLY`) alone in a single-statement migration file.
- Ids are ULID `TEXT` (`util.NewID()`).
- Domain naming: `task` / công việc — never ship `issue` or `multica` in source (`scripts/no-usf-leak.test.mjs`).
- Every workspace query gated by `WorkspaceService.RequireMember`.
- FE: `parseWithFallback` + malformed-response test for every changed/new endpoint.
- `packages/views/`: every JSX string through `t()`; vi/en parity.
- Realtime stays id-only invalidate (`task.created|updated|deleted`); carry `revision` on the row/DTO.
- Out of scope this plan: custom status CRUD UI, labels, projects, sub-tasks, saved views, gantt/table/swimlane, reactions, attachments, properties, inbox, GitHub/channel, agent/squad runtime (columns may exist nullable for forward shape).
- Conventional commits; do not commit unless the user asks mid-execution (steps still show suggested messages).

## File map

| Path | Responsibility |
|------|----------------|
| `server/migrations/008_workspace_task_prefix.up.sql` (+ down) | `task_prefix`, `task_counter` on `workspaces` |
| `server/migrations/009_task_statuses.up.sql` (+ down) | `task_statuses` table (no inline PK index) |
| `server/migrations/010_task_statuses_pkey.up.sql` (+ down) | unique index CONCURRENTLY → later attach if needed, or unique on (id) |
| `server/migrations/011_task_statuses_ws_key.up.sql` (+ down) | unique `(workspace_id, key)` CONCURRENTLY |
| `server/migrations/012_tasks_parity_columns.up.sql` (+ down) | alter `tasks`: number, identifier, expand checks, actor fields, revision, metadata, … + backfill |
| `server/migrations/013_tasks_identifier_idx.up.sql` (+ down) | unique `(workspace_id, number)` CONCURRENTLY |
| `server/pkg/db/queries/workspaces.sql` | create/update prefix+counter; next number |
| `server/pkg/db/queries/task_statuses.sql` | seed + list built-ins |
| `server/pkg/db/queries/tasks.sql` | create/list/update with new columns |
| `server/internal/taskstatus/` | `Ensure`, built-in keys/categories (port Multica `issuestatus` rename) |
| `server/internal/service/workspace.go` | seed statuses + set prefix on create |
| `server/internal/service/task.go` | allocate number/identifier; validate 7 statuses + priority incl. `none` |
| `server/internal/handler/dto/sdo/task.go` | DTO fields Multica-shaped |
| `server/internal/handler/task.go` | map DTO |
| `packages/core/types/task.ts` | types + schemas |
| `packages/core/api/endpoints/tasks.ts` (+ test) | parse new fields |
| `packages/views/tasks/*` | board 7 columns; show identifier; i18n |
| `packages/core/i18n/locales/{en,vi}.json` | status_* backlog/in_review/blocked; priority_none |

---

### Task 1: Migration — workspace `task_prefix` + `task_counter`

**Files:**
- Create: `server/migrations/008_workspace_task_prefix.up.sql`
- Create: `server/migrations/008_workspace_task_prefix.down.sql`

**Interfaces:**
- Produces: columns `workspaces.task_prefix TEXT NOT NULL DEFAULT 'TASK'`, `workspaces.task_counter INT NOT NULL DEFAULT 0`

- [ ] **Step 1: Write up migration**

`server/migrations/008_workspace_task_prefix.up.sql`:

```sql
ALTER TABLE workspaces
  ADD COLUMN task_prefix TEXT NOT NULL DEFAULT 'TASK',
  ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0;

-- Derive a short uppercase prefix from slug for existing rows (A–Z0–9, max 8).
UPDATE workspaces
SET task_prefix = UPPER(SUBSTRING(REGEXP_REPLACE(slug, '[^a-zA-Z0-9]', '', 'g') FROM 1 FOR 8))
WHERE REGEXP_REPLACE(slug, '[^a-zA-Z0-9]', '', 'g') <> '';

UPDATE workspaces SET task_prefix = 'TASK' WHERE task_prefix = '' OR task_prefix IS NULL;
```

- [ ] **Step 2: Write down migration**

```sql
ALTER TABLE workspaces
  DROP COLUMN IF EXISTS task_prefix,
  DROP COLUMN IF EXISTS task_counter;
```

- [ ] **Step 3: Apply locally**

Run: `make migrate-up`  
Expected: applies `008_workspace_task_prefix` without error.

- [ ] **Step 4: Commit** (when asked)

```bash
git add server/migrations/008_workspace_task_prefix.*.sql
git commit -m "feat(tasks): add workspace task_prefix and task_counter"
```

---

### Task 2: Migration — `task_statuses` table + indexes

**Files:**
- Create: `server/migrations/009_task_statuses.up.sql` / `.down.sql`
- Create: `server/migrations/010_task_statuses_id_uidx.up.sql` / `.down.sql` (UNIQUE INDEX CONCURRENTLY on `id`)
- Create: `server/migrations/011_task_statuses_ws_key_uidx.up.sql` / `.down.sql` (UNIQUE INDEX CONCURRENTLY on `(workspace_id, key)`)

**Interfaces:**
- Produces: table `task_statuses` ready for seed inserts

Follow Multica MUL-6243 shape with UniWork naming. No FK. No inline PRIMARY KEY (index must be CONCURRENTLY in its own file). Application treats `id` as unique via the concurrent unique index; if the repo later needs `PRIMARY KEY USING INDEX`, add a dedicated migration — for Phase 0 the unique index on `id` is enough for sqlc/`Get`.

- [ ] **Step 1: Create table (009)**

`009_task_statuses.up.sql`:

```sql
CREATE TABLE task_statuses (
  id           TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  key          TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_]{0,31}$'),
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  description  TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 256),
  category     TEXT NOT NULL CHECK (
    category IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')
  ),
  color        TEXT NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  position     DOUBLE PRECISION NOT NULL DEFAULT 0,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`009_task_statuses.down.sql`:

```sql
DROP TABLE IF EXISTS task_statuses;
```

- [ ] **Step 2: Unique index on id (010) — sole statement**

`010_task_statuses_id_uidx.up.sql`:

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_id ON task_statuses (id);
```

Down: `DROP INDEX CONCURRENTLY IF EXISTS idx_task_statuses_id;`

- [ ] **Step 3: Unique (workspace_id, key) (011)**

`011_task_statuses_ws_key_uidx.up.sql`:

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_ws_key ON task_statuses (workspace_id, key);
```

Down: `DROP INDEX CONCURRENTLY IF EXISTS idx_task_statuses_ws_key;`

- [ ] **Step 4: migrate-up + lint**

Run: `make migrate-up` then `cd server && go test ./migrations/ -count=1`  
Expected: PASS (no FK; concurrent indexes alone in file).

- [ ] **Step 5: Commit** (when asked)

```bash
git add server/migrations/009_task_statuses.* server/migrations/010_task_statuses_id_uidx.* server/migrations/011_task_statuses_ws_key_uidx.*
git commit -m "feat(tasks): add task_statuses catalog table"
```

---

### Task 3: Migration — evolve `tasks` columns + backfill

**Files:**
- Create: `server/migrations/012_tasks_parity_columns.up.sql` / `.down.sql`
- Create: `server/migrations/013_tasks_ws_number_uidx.up.sql` / `.down.sql`

**Interfaces:**
- Produces: Multica-shaped core columns on `tasks`; existing rows backfilled

- [ ] **Step 1: Alter + backfill (012)**

```sql
-- Expand status / priority checks (Postgres auto-name: tasks_status_check / tasks_priority_check).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS number INTEGER,
  ADD COLUMN IF NOT EXISTS identifier TEXT,
  ADD COLUMN IF NOT EXISTS assignee_type TEXT,
  ADD COLUMN IF NOT EXISTS creator_type TEXT,
  ADD COLUMN IF NOT EXISTS creator_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_task_id TEXT,
  ADD COLUMN IF NOT EXISTS project_id TEXT,
  ADD COLUMN IF NOT EXISTS stage INTEGER,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

UPDATE tasks SET
  creator_type = 'member',
  creator_id = created_by
WHERE creator_id IS NULL;

UPDATE tasks SET
  assignee_type = 'member'
WHERE assignee_id IS NOT NULL AND assignee_type IS NULL;

-- Assign sequential numbers per workspace.
WITH ranked AS (
  SELECT id, workspace_id,
         ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC, id ASC) AS rn
  FROM tasks
)
UPDATE tasks t
SET number = ranked.rn
FROM ranked
WHERE t.id = ranked.id AND t.number IS NULL;

UPDATE tasks t
SET identifier = w.task_prefix || '-' || t.number::text
FROM workspaces w
WHERE w.id = t.workspace_id AND (t.identifier IS NULL OR t.identifier = '');

UPDATE workspaces w
SET task_counter = COALESCE((SELECT MAX(number) FROM tasks t WHERE t.workspace_id = w.id), 0);

ALTER TABLE tasks
  ALTER COLUMN number SET NOT NULL,
  ALTER COLUMN identifier SET NOT NULL,
  ALTER COLUMN creator_type SET NOT NULL,
  ALTER COLUMN creator_id SET NOT NULL;

ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (
  status IN ('backlog','todo','in_progress','in_review','done','blocked','cancelled')
);
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK (
  priority IN ('urgent','high','medium','low','none')
);
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_type_check CHECK (
  assignee_type IS NULL OR assignee_type IN ('member','agent','squad')
);
ALTER TABLE tasks ADD CONSTRAINT tasks_creator_type_check CHECK (
  creator_type IN ('member','agent','squad')
);

UPDATE tasks SET last_activity_at = COALESCE(last_activity_at, updated_at);
```

Down migration: drop new columns/constraints and restore old status/priority checks (`todo|in_progress|done|cancelled`, `low|medium|high|urgent`). Document that down loses new-status rows if any were created — acceptable pre-launch.

- [ ] **Step 2: Unique (workspace_id, number) (013)**

```sql
CREATE UNIQUE INDEX CONCURRENTLY idx_tasks_ws_number ON tasks (workspace_id, number);
```

- [ ] **Step 3: migrate-up**

Run: `make migrate-up`  
Expected: all tasks have `number`/`identifier`; counters updated.

- [ ] **Step 4: Commit** (when asked)

```bash
git add server/migrations/012_tasks_parity_columns.* server/migrations/013_tasks_ws_number_uidx.*
git commit -m "feat(tasks): evolve tasks schema toward Multica parity"
```

---

### Task 4: sqlc queries — workspaces, task_statuses, tasks

**Files:**
- Modify: `server/pkg/db/queries/workspaces.sql`
- Create: `server/pkg/db/queries/task_statuses.sql`
- Modify: `server/pkg/db/queries/tasks.sql`
- Regenerate: `make sqlc`

**Interfaces:**
- Produces: `SeedTaskStatusEntries`, `ListTaskStatusesByWorkspace`, `AllocateTaskNumber` (or increment counter + return), updated `CreateTask` / `CreateWelcomeTask` params

- [ ] **Step 1: Workspace queries**

Append to `workspaces.sql`:

```sql
-- name: UpdateWorkspaceTaskPrefix :one
UPDATE workspaces
SET task_prefix = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: NextTaskNumber :one
UPDATE workspaces
SET task_counter = task_counter + 1, updated_at = now()
WHERE id = $1
RETURNING task_counter, task_prefix;
```

Update `CreateWorkspace` INSERT to include `task_prefix` (derive in service before insert, or default `TASK` and update after).

Ensure all `SELECT` workspace queries that map to `Workspace` include the new columns (sqlc will fail until SELECTs list them or use `SELECT *` consistently — match existing style in file).

- [ ] **Step 2: task_statuses.sql**

```sql
-- name: SeedTaskStatusEntries :exec
INSERT INTO task_statuses (id, workspace_id, key, name, description, category, color, is_system, position)
VALUES
  ($1,  sqlc.arg(workspace_id), 'backlog',     'Backlog',     '', 'backlog',     '#94a3b8', true, 0),
  ($2,  sqlc.arg(workspace_id), 'todo',        'Todo',        '', 'todo',        '#3b82f6', true, 1),
  ($3,  sqlc.arg(workspace_id), 'in_progress', 'In Progress', '', 'in_progress', '#f59e0b', true, 2),
  ($4,  sqlc.arg(workspace_id), 'in_review',   'In Review',   '', 'in_review',   '#a855f7', true, 3),
  ($5,  sqlc.arg(workspace_id), 'done',        'Done',        '', 'done',        '#22c55e', true, 4),
  ($6,  sqlc.arg(workspace_id), 'blocked',     'Blocked',     '', 'blocked',     '#ef4444', true, 5),
  ($7,  sqlc.arg(workspace_id), 'cancelled',   'Cancelled',   '', 'cancelled',   '#6b7280', true, 6)
ON CONFLICT DO NOTHING;
```

Note: `ON CONFLICT DO NOTHING` requires the unique index on `(workspace_id, key)`. Pass seven ULIDs from Go `Ensure`. If sqlc struggles with multi-row + arg, use seven single-row inserts in a Go loop instead — prefer loop for clarity:

```sql
-- name: InsertTaskStatus :exec
INSERT INTO task_statuses (id, workspace_id, key, name, description, category, color, is_system, position)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT DO NOTHING;
```

```sql
-- name: ListTaskStatusesByWorkspace :many
SELECT * FROM task_statuses
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY position ASC, created_at ASC;
```

- [ ] **Step 3: Update CreateTask / CreateWelcomeTask**

```sql
-- name: CreateTask :one
INSERT INTO tasks (
  id, workspace_id, title, description, status, priority,
  assignee_type, assignee_id, creator_type, creator_id,
  number, identifier, position, kind, created_by,
  metadata, properties, revision, last_activity_at
) VALUES (
  $1, $2, $3, $4, COALESCE(sqlc.narg('status'), 'todo'), $5,
  $6, $7, $8, $9,
  $10, $11, $12, COALESCE(sqlc.narg('kind'), 'normal'), $13,
  '{}'::jsonb, '{}'::jsonb, 1, now()
)
RETURNING *;
```

Align `CreateWelcomeTask` similarly (status `in_progress`, set number/identifier/creator_*).

Bump `revision` on `UpdateTask`:

```sql
revision = revision + 1,
last_activity_at = now(),
updated_at = now()
```

- [ ] **Step 4: Regenerate**

Run: `make sqlc`  
Expected: compiles; `Workspace` struct includes `TaskPrefix`, `TaskCounter`.

- [ ] **Step 5: Commit** (when asked)

```bash
git add server/pkg/db/queries/*.sql server/pkg/db/generated/
git commit -m "feat(tasks): sqlc queries for statuses and task identity"
```

---

### Task 5: Go — `taskstatus.Ensure` + seed on workspace create

**Files:**
- Create: `server/internal/taskstatus/taskstatus.go`
- Create: `server/internal/taskstatus/taskstatus_test.go`
- Modify: `server/internal/service/workspace.go` (`CreateInOrg`)
- Modify: onboarding path that creates workspace if it bypasses `CreateInOrg`

**Interfaces:**
- Produces: `taskstatus.Ensure(ctx, q, workspaceID) error`
- Consumes: `Queries.InsertTaskStatus`

- [ ] **Step 1: Failing test**

```go
func TestEnsure_SeedsSevenSystemStatuses(t *testing.T) {
  // use existing test DB helper pattern from workspace_test / task_test
  // create workspace row, call taskstatus.Ensure, ListTaskStatusesByWorkspace
  // assert len==7 and keys match built-ins
}
```

- [ ] **Step 2: Run — expect FAIL** (package missing)

- [ ] **Step 3: Implement**

Port Multica `issuestatus` built-in list (keys, names, colors, positions). `Ensure` loops seven `InsertTaskStatus` with `util.NewID()`, `is_system=true`. Idempotent via `ON CONFLICT DO NOTHING`.

```go
var BuiltIns = []struct {
  Key, Name, Category, Color string
  Position float64
}{ /* backlog…cancelled */ }

func IsBuiltIn(key string) bool { /* map lookup */ }
```

- [ ] **Step 4: Wire `CreateInOrg`**

After `AddWorkspaceMember`, before return:

```go
prefix := deriveTaskPrefix(slug) // uppercase alnum, max 8, fallback "TASK"
if _, err := s.q.UpdateWorkspaceTaskPrefix(ctx, db.UpdateWorkspaceTaskPrefixParams{ID: w.ID, TaskPrefix: prefix}); err != nil {
  return WorkspaceView{}, err
}
if err := taskstatus.Ensure(ctx, s.q, w.ID); err != nil {
  return WorkspaceView{}, err
}
```

Also backfill: one-shot in test helper or a small service method `EnsureWorkspaceTaskInfra` called from RequireMember only if missing — **prefer not**. Instead add a Go test that seeds existing workspaces via migrate + optional `make` script is out of scope; for existing DBs after migrate, run a one-off in `task_test` setup calling `Ensure` for fixtures. For production pre-launch checkouts: document running a tiny SQL/Go seed — implement `TaskService` or workspace list admin call later. **Minimum:** call `Ensure` from `CreateInOrg` and from onboarding workspace creation; add `TestEnsure_Idempotent`.

For existing workspaces already in DB after migrate 012: add migration **014** that cannot easily call Go. Options: (a) leave unseeded until next workspace touch, (b) SQL insert 7 rows per workspace in 014. Prefer **(b)** SQL backfill in a new migration `014_seed_task_statuses.up.sql` inserting the 7 keys for every workspace lacking them (generate ids with a SQL expression — UniWork uses TEXT ULID from app; for SQL use `replace(gen_random_uuid()::text, '-', '')` or similar unique text). Keep 014 in this task if CreateInOrg-only seed is insufficient for `make test-go` fixtures.

- [ ] **Step 5: Tests PASS + commit** (when asked)

```bash
git add server/internal/taskstatus/ server/internal/service/workspace.go server/migrations/014_seed_task_statuses.*
git commit -m "feat(tasks): seed built-in task statuses per workspace"
```

---

### Task 6: Go — TaskService create/update on new model

**Files:**
- Modify: `server/internal/service/task.go`
- Modify: `server/internal/service/task_test.go`
- Modify: `server/internal/service/templates/welcome_task.go` / onboarding create welcome if needed

**Interfaces:**
- Consumes: `NextTaskNumber`, expanded `CreateTask`
- Produces: tasks with `number`, `identifier`, `creator_*`, `revision`; status ∈ 7 built-ins; priority includes `none`

- [ ] **Step 1: Failing tests**

```go
func TestCreateTask_AssignsIdentifier(t *testing.T) { /* prefix-N */ }
func TestUpdateTask_AcceptsInReview(t *testing.T) { /* status in_review */ }
func TestUpdateTask_RejectsUnknownStatus(t *testing.T) { /* custom-foo → Invalid */ }
func TestCreateTask_PriorityNone(t *testing.T) {}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```go
var validStatus = map[string]bool{
  "backlog": true, "todo": true, "in_progress": true, "in_review": true,
  "done": true, "blocked": true, "cancelled": true,
}
var validPriority = map[string]bool{
  "urgent": true, "high": true, "medium": true, "low": true, "none": true,
}
```

In `Create`:

1. `RequireMember`
2. `NextTaskNumber` → `n`, `prefix`
3. `identifier := fmt.Sprintf("%s-%d", prefix, n)`
4. `CreateTask` with `CreatorType: "member", CreatorID: userID, CreatedBy: userID`, default status `todo`, `AssigneeType` set when assignee present
5. Publish `task.created`

Default priority: keep `medium` if empty (Multica default is `none` — **use `medium` for MVP continuity** unless product asks otherwise; document in commit body).

Welcome task: allocate number the same way.

- [ ] **Step 4: `make test-go` focused**

Run: `cd server && go test ./internal/service/ -run Task -count=1`  
Expected: PASS

- [ ] **Step 5: Commit** (when asked)

```bash
git add server/internal/service/task.go server/internal/service/task_test.go
git commit -m "feat(tasks): allocate identifier and widen status/priority"
```

---

### Task 7: Handler DTO + API response shape

**Files:**
- Modify: `server/internal/handler/dto/sdo/task.go`
- Modify: `server/internal/handler/task.go` (`toTaskDTO`)
- Modify: `server/internal/handler/dto/sdi/task.go` if create/patch fields change

**Interfaces:**
- Produces JSON task object with Multica-like fields (UniWork names)

- [ ] **Step 1: Extend TaskDTO**

```go
type TaskDTO struct {
  ID             string  `json:"id"`
  WorkspaceID    string  `json:"workspace_id"`
  Number         int32   `json:"number"`
  Identifier     string  `json:"identifier"`
  Title          string  `json:"title"`
  Description    string  `json:"description"`
  Status         string  `json:"status"`
  Priority       string  `json:"priority"`
  AssigneeType   *string `json:"assignee_type,omitempty"`
  AssigneeID     *string `json:"assignee_id,omitempty"`
  CreatorType    string  `json:"creator_type"`
  CreatorID      string  `json:"creator_id"`
  ParentTaskID   *string `json:"parent_task_id,omitempty"`
  ProjectID      *string `json:"project_id,omitempty"`
  Position       float64 `json:"position"`
  Stage          *int32  `json:"stage,omitempty"`
  StartDate      *string `json:"start_date,omitempty"`
  DueDate        *string `json:"due_date,omitempty"`
  Kind           string  `json:"kind"`
  Revision       int32   `json:"revision"`
  CreatedBy      string  `json:"created_by"` // keep for FE welcome/compat this phase
  CreatedAt      string  `json:"created_at"`
  UpdatedAt      string  `json:"updated_at"`
  LastActivityAt *string `json:"last_activity_at,omitempty"`
}
```

Map in `toTaskDTO`. Keep comment endpoints unchanged.

- [ ] **Step 2: Compile**

Run: `cd server && go build ./...`  
Expected: success

- [ ] **Step 3: Commit** (when asked)

```bash
git add server/internal/handler/
git commit -m "feat(tasks): expose Multica-shaped task DTO fields"
```

---

### Task 8: FE types + endpoints + malformed tests

**Files:**
- Modify: `packages/core/types/task.ts`
- Modify: `packages/core/api/endpoints/tasks.ts`
- Modify: `packages/core/api/endpoints/tasks.test.ts`
- Re-export from `packages/core/types` index if needed

**Interfaces:**
- Produces: `TASK_STATUSES` 7 keys; `TASK_PRIORITIES` includes `none`; `Task` with `number`, `identifier`, `creator_*`, `revision`, optional stub fields

- [ ] **Step 1: Failing malformed / shape tests**

Extend `tasks.test.ts`:

- parse response with `identifier` + `number`
- unknown `status: "custom_qa"` does not throw (lenient `z.string()`)
- missing `tasks` array → fallback `[]`

- [ ] **Step 2: Update schemas**

```ts
export const TASK_STATUSES = [
  "backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled",
] as const;
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

export const TaskSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  number: z.number().optional().default(0),
  identifier: z.string().optional().default(""),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  assignee_type: z.string().nullish(),
  assignee_id: z.string().optional(),
  creator_type: z.string().optional().default("member"),
  creator_id: z.string().optional(),
  parent_task_id: z.string().nullish(),
  project_id: z.string().nullish(),
  position: z.number(),
  stage: z.number().nullish(),
  start_date: z.string().optional(),
  due_date: z.string().optional(),
  kind: z.string().optional().default("normal"),
  revision: z.number().optional().default(1),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_activity_at: z.string().nullish(),
});
```

Keep request unions narrowed; every `switch` on status/priority gets `default`.

- [ ] **Step 3: Run**

Run: `pnpm exec vitest run packages/core/api/endpoints/tasks.test.ts packages/core/types/`  
Expected: PASS (adjust paths to package scripts: `pnpm --filter @uniwork/core test -- tasks`)

- [ ] **Step 4: Commit** (when asked)

```bash
git add packages/core/types/task.ts packages/core/api/endpoints/tasks.ts packages/core/api/endpoints/tasks.test.ts
git commit -m "feat(tasks): widen FE task schema for parity skeleton"
```

---

### Task 9: FE board / list / detail / i18n

**Files:**
- Modify: `packages/views/tasks/board-view.tsx`
- Modify: `packages/views/tasks/list-view.tsx`
- Modify: `packages/views/tasks/task-card.tsx`
- Modify: `packages/views/tasks/task-detail-view.tsx`
- Modify: `packages/views/tasks/new-task-dialog.tsx` (+ test if status/priority options change)
- Modify: `packages/core/i18n/locales/en.json`, `vi.json`
- Modify: `packages/views/tasks/tasks-page-view.tsx` only if header needs identifier count copy (optional)

**Interfaces:**
- Consumes: `TASK_STATUSES` from types
- Board columns = 7 built-in keys (Phase 0: no catalog fetch yet)

- [ ] **Step 1: i18n keys**

Add `tasks.status_backlog`, `status_in_review`, `status_blocked`, `priority_none`. Vietnamese: Backlog / Đang review / Đang chặn / Không ưu tiên (check `docs/conventions.md` glossary voice).

- [ ] **Step 2: Board columns**

```ts
const COLUMNS: TaskStatus[] = [
  "backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled",
];
```

Update drag target validation accordingly.

- [ ] **Step 3: Task card / list show `identifier`**

Muted caption before title: `{task.identifier}` when non-empty.

- [ ] **Step 4: Detail status/priority selects**

Include new statuses + `none` priority. Keep assignee as members-only (no agent picker UI this phase).

- [ ] **Step 5: Tests**

Run existing `new-task-dialog.test.tsx` + any board tests; update assertions for new options.

Run: `pnpm --filter @uniwork/views test -- tasks`  
Expected: PASS

- [ ] **Step 6: Commit** (when asked)

```bash
git add packages/views/tasks/ packages/core/i18n/locales/
git commit -m "feat(tasks): board and detail for seven built-in statuses"
```

---

### Task 10: Verification gate

**Files:** none new (fix only)

- [ ] **Step 1: Go**

Run: `make test-go`  
Expected: PASS

- [ ] **Step 2: FE unit**

Run: `pnpm typecheck && pnpm --filter @uniwork/core test && pnpm --filter @uniwork/views test -- tasks`  
Expected: PASS

- [ ] **Step 3: Leak + lint**

Run: `pnpm lint` and ensure `scripts/no-usf-leak.test.mjs` still PASS (no `issue`/`multica` in shipped source).

- [ ] **Step 4: Manual smoke** (app running via `make start`)

1. Open `/{org}/{ws}/tasks`
2. Create task → appears with `PREFIX-n`
3. Drag across new columns (e.g. to `in_review`)
4. Open detail, change priority to none, comment still works
5. New workspace from onboarding/settings → 7 statuses seeded (spot-check DB or later list API)

- [ ] **Step 5: Optional e2e**

If an existing Playwright task flow exists under `e2e/`, update selectors for new columns; otherwise skip and note in PR.

- [ ] **Step 6: Final commit** (when asked) if verification fixed stragglers

---

## Self-review (plan vs Phase 0 spec)

| Spec Phase 0 item | Task |
|-------------------|------|
| Schema cutover + seed 7 statuses + prefix | Tasks 1–5, 014 seed |
| Types/endpoints core | Tasks 7–8 |
| TaskSurface shell board/list minimal | Task 9 (evolve existing page; full Multica `TaskSurface` controller deferred to Phase 4) |
| Migrate MVP rows | Task 3 backfill |
| Detail cơ bản | Task 9 |
| Create/list/update/delete + board | Tasks 6–9 |
| Agent/channel stubs | Deferred (nullable columns only in Task 3) — matches Phase 0 YAGNI |
| Realtime invalidate-only + revision | Task 3/6/7 (`revision` column + bump) |

**Explicit deferrals (later phases, not gaps):** custom status CRUD API/UI, labels, projects, hierarchy, views/gantt, rich comments/attachments, inbox, GitHub/channel UI, full `IssueSurface` port rename.

**Placeholder scan:** none intentional.

**Type consistency:** `task_prefix` / `task_counter` / `task_statuses` / `identifier` / `number` / seven status keys used uniformly FE↔BE.
