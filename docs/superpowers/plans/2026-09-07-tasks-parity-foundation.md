# UNI-495 · Tasks parity slice 1 Implementation Plan

> **Trạng thái:** in-progress — kế hoạch đã viết, chưa bắt đầu product code

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo nền dữ liệu có thể kiểm chứng cho toàn bộ Work Management suite: parity manifest cố định ở baseline `3d37828e9`, migration in-place giữ dữ liệu Task/Comment, catalog status/label/property, schema Project và các quan hệ cộng tác, định danh Task tuần tự, cùng capability registry visible-disabled.

**Architecture:** Đây là lát cắt nền, không thay màn hình `/tasks`: schema mới được deploy theo hướng backward-compatible, còn surface/cutover mới nằm sau feature flag `tasks_work_management_parity`; các reader/writer Tasks MVP được nâng cấp để tiếp tục chạy trên schema mới. SQL migration chỉ sở hữu hình dạng và backfill; quan hệ chéo workspace được service kiểm tra, không dùng FK. Capability được công bố qua `GET /api/v1/config`, còn parity manifest là artifact provenance có generator tổng quát và gate CI độc lập.

**Tech Stack:** PostgreSQL 16 migrations, Go 1.27, pgx/sqlc, Chi SDI/SDO, Node 22 test runner, TypeScript strict, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md`

**Tracking:** Parent `UNI-426`; sub-issue `UNI-495`; baseline source commit `3d37828e9`.

## Global Constraints

- Trước khi sửa product code, chạy `make issue-start KEY=UNI-495` từ commit chứa design `26350bd`; không triển khai trực tiếp trên nhánh umbrella `feature/UNI-426-*`.
- Không để tên/branding nguồn, package scope nguồn, API header nguồn, persisted key nguồn hoặc UI copy nguồn trong target code và tests; tên nguồn chỉ được phép trong plan/spec và `docs/parity/tasks-work-management.json`.
- Giữ `Task/Công việc`, `/tasks`, `/my-tasks`, `AgentRun/Lượt chạy`; không tạo domain hoặc compatibility layer `Issue`.
- Migration bắt đầu từ số `107`; mỗi prefix có đủ `.up.sql` và `.down.sql`; không `REFERENCES`, `FOREIGN KEY` hoặc cascade; mỗi `CREATE INDEX CONCURRENTLY` đứng một mình trong một migration.
- Mọi business table mới có `organization_id TEXT NOT NULL` và `workspace_id TEXT NOT NULL`; ID mới do `util.NewID()` tạo, trừ ID backfill deterministic theo pattern đã dùng ở migration `072`.
- Giữ nguyên ULID, title/body, timestamp, `kind=welcome`, attribution và audit hiện có. Không tạo audit history giả cho dữ liệu trước migration.
- Bảy built-in status/category theo đúng thứ tự: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`.
- Integration chưa có backend trả capability `unavailable` với stable `reason_code`; không ghi placeholder rows và không trả mutation success giả.
- Mọi query mới scope đồng thời `organization_id` và `workspace_id`. `WorkspaceService.RequireMember` vẫn là membership gate duy nhất.
- Lát cắt này không thêm Projects/Statuses UI, Task collection modes hay detail collaboration UI; các bề mặt đó thuộc UNI-426 slices 2–7 và chỉ dùng contract được tạo ở đây.
- TDD theo từng task; commit sau khi narrow tests xanh; trước hoàn thành chạy `make check` và ghi `[agent]` comment trên UNI-495.

---

## File map

### Provenance và gates

- Create `scripts/generate-task-parity-manifest.mjs`: đọc một Git checkout + commit được truyền qua CLI, chọn file Work Management và phát manifest deterministic; script không hard-code tên sản phẩm nguồn.
- Create `scripts/task-parity-manifest.test.mjs`: kiểm schema, baseline, uniqueness, route bắt buộc, disposition và verification state.
- Create `docs/parity/tasks-work-management.json`: inventory được generate; đây là nơi provenance được phép chứa tên nguồn.
- Modify `scripts/check.sh`: thêm manifest test vào nhóm repo-contract tests.

### Database

- Create `server/migrations/107_tasks_work_management_foundation.{up,down}.sql`: mở rộng `workspaces`, `tasks`, backfill tenant/identifier/actor fields.
- Create `server/migrations/108_task_catalogs.{up,down}.sql`: `task_statuses`, `task_labels`, `task_properties`.
- Create `server/migrations/109_task_relations.{up,down}.sql`: `task_label_links`, `task_dependencies`, `task_subscribers`, `task_pins`.
- Create `server/migrations/110_task_collaboration.{up,down}.sql`: mở rộng `task_comments`; tạo reactions, attachments và source contexts.
- Create `server/migrations/111_task_views.{up,down}.sql`: saved views và per-user preferences.
- Create `server/migrations/112_projects.{up,down}.sql`: `projects`, `project_resources`.
- Create migrations `113`–`130`: từng concurrent index, đúng một statement/file.
- Create `server/migrations/131_seed_task_status_catalog.{up,down}.sql`: seed bảy built-in status cho workspace hiện có.
- Modify `server/migrations/lint_test.go`: xóa `tasks`, `task_comments` khỏi `tenantBackfillDebt` sau backfill.
- Modify `server/migrations/migrate_test.go`: rehearsal từ schema `106` với Task/Comment thật.
- Modify `server/internal/testutil/db.go`: truncate mọi bảng nền mới theo thứ tự an toàn.

### SQLC và server compatibility

- Modify `server/pkg/db/queries/tasks.sql`: tenant-scoped task lookup, atomic task number, insert normalized foundation fields.
- Modify `server/pkg/db/queries/workspaces.sql`: trả `task_prefix`, `task_counter` và update prefix.
- Create `server/pkg/db/queries/task_statuses.sql`: seed/list/get catalog.
- Create `server/pkg/db/queries/projects.sql`: tenant-scoped persistence primitives cho Project/resources.
- Regenerate `server/pkg/db/generated/{models.go,tasks.sql.go,workspaces.sql.go,task_statuses.sql.go,projects.sql.go,db.go,querier.go}` bằng `make sqlc`.
- Create `server/internal/service/task_status_catalog.go`: canonical built-in definitions và seed helper.
- Modify `server/internal/service/workspace.go`: derive prefix và seed status trong cùng create transaction.
- Modify `server/internal/service/task.go`: allocate identifier trong transaction và ghi normalized actor fields.
- Modify `server/internal/service/onboarding.go`: welcome Task dùng cùng allocator.
- Modify `server/internal/service/{task_test.go,onboarding_test.go,workspace_test.go}`: pin concurrency, backfill-compatible behavior và seed.
- Modify `server/internal/handler/{task.go,dto/sdo/task.go}`: trả `organization_id`, `number`, `identifier`, `revision` mà không đổi route hiện tại.

### Capability contract

- Create `server/internal/workcapability/catalogue.go` và test: catalog có kiểu, immutable-by-copy, stable reason codes.
- Modify `server/internal/featureflags/keys.go`: flag public `tasks_work_management_parity`, default false, review date `2026-12-15`.
- Modify `server/internal/handler/{config.go,config_test.go,dto/sdo/common.go}`: công bố capabilities trong config.
- Create `packages/core/capabilities/{types.ts,registry.ts,registry.test.ts,index.ts}`.
- Modify `packages/core/api/endpoints/{config.ts,config.test.ts}` và `packages/core/package.json`: parse/fallback và export contract.

---

### Task 1: Parity manifest deterministic

**Files:**

- Create: `scripts/generate-task-parity-manifest.mjs`
- Create: `scripts/task-parity-manifest.test.mjs`
- Create: `docs/parity/tasks-work-management.json`
- Modify: `scripts/check.sh:88`

**Interfaces:**

- Consumes: `node scripts/generate-task-parity-manifest.mjs --source-root multica --baseline 3d37828e9 --output docs/parity/tasks-work-management.json --source-brand multica`.
- Produces: JSON `{schema_version, baseline_commit, source_product, generated_at, entries[]}`; mỗi entry có `source_path`, `target_path`, `kind`, `disposition`, `verification_state`, `owner_issue`.

- [ ] **Step 1: Viết manifest contract test đang đỏ**

```js
// scripts/task-parity-manifest.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = new URL("../docs/parity/tasks-work-management.json", import.meta.url);

test("Tasks parity manifest pins and classifies the complete baseline", async () => {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.baseline_commit, "3d37828e9");
  assert.ok(manifest.entries.length >= 709);

  const sources = manifest.entries.map((entry) => entry.source_path);
  assert.equal(new Set(sources).size, sources.length);
  for (const entry of manifest.entries) {
    assert.match(entry.source_path, /\S/);
    assert.match(entry.target_path, /\S/);
    assert.equal(entry.target_path.toLowerCase().includes(manifest.source_product.toLowerCase()), false);
    assert.ok(["source", "route", "test", "locale", "capability"].includes(entry.kind));
    assert.ok(["ported", "adapted", "stubbed"].includes(entry.disposition));
    assert.ok(["pending", "verified"].includes(entry.verification_state));
    assert.equal(entry.owner_issue, "UNI-426");
  }

  for (const route of [
    "apps/web/app/[workspaceSlug]/(dashboard)/issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/my-issues/page.tsx",
    "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx",
  ]) {
    assert.ok(sources.includes(route), `missing route ${route}`);
  }
  assert.equal(manifest.entries.some((entry) => entry.disposition === "stubbed"), true);
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ vì manifest chưa tồn tại**

Run: `node --test scripts/task-parity-manifest.test.mjs`

Expected: FAIL với `ENOENT` cho file `docs/parity/tasks-work-management.json`.

- [ ] **Step 3: Viết generator tổng quát, không hard-code tên nguồn**

```js
// scripts/generate-task-parity-manifest.mjs
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

const sourceRoot = option("--source-root");
const baseline = option("--baseline");
const output = option("--output");
const sourceProduct = option("--source-brand");
const resolved = execFileSync("git", ["-C", sourceRoot, "rev-parse", baseline], { encoding: "utf8" }).trim();
if (!resolved.startsWith(baseline)) throw new Error(`baseline resolved to ${resolved}`);

const tracked = execFileSync("git", ["-C", sourceRoot, "ls-tree", "-r", "--name-only", baseline], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

const pathMatch = /^(packages\/(core\/(issues|issue-statuses|projects)|views\/(issues|my-issues|projects|locales\/[^/]+\/(issues|my-issues|projects)\.json))|apps\/web\/app\/\[workspaceSlug\]\/\(dashboard\)\/(issues|my-issues|projects)|apps\/mobile\/.*(issue|project)|server\/.*(issue|project)|e2e\/issues\.spec\.ts)/;
const contentMatch = /(@[^/]+\/(issues|issue-statuses|projects)|\/(issues|my-issues|projects)(\/|\")|Issue|Project)/;

function contentAt(path) {
  return execFileSync("git", ["-C", sourceRoot, "show", `${baseline}:${path}`], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function targetPath(path) {
  return path
    .replaceAll(sourceProduct, "uniwork")
    .replaceAll("my-issues", "my-tasks")
    .replaceAll("issue-statuses", "task-statuses")
    .replaceAll("issues", "tasks")
    .replaceAll("issue", "task");
}

function kind(path) {
  if (/\.test\.|\.spec\.|\/testdata\//.test(path)) return "test";
  if (/\/locales\//.test(path)) return "locale";
  if (/\/app\/.*page\.tsx$/.test(path)) return "route";
  return "source";
}

const selected = tracked.filter((path) => {
  if (pathMatch.test(path)) return true;
  if (!/\.(go|sql|ts|tsx|json)$/.test(path)) return false;
  try { return contentMatch.test(contentAt(path)); } catch { return false; }
});

const stubPathPattern = /(agent-task|agent_task|squad|pull-request|pull_request|github|daemon|workdir)/i;
const entries = selected.sort().map((sourcePath) => {
  return {
    source_path: sourcePath,
    target_path: targetPath(sourcePath),
    kind: kind(sourcePath),
    disposition: stubPathPattern.test(sourcePath) ? "stubbed" : "adapted",
    verification_state: "pending",
    owner_issue: "UNI-426",
  };
});

for (const capability of ["tasks.agent_runs", "tasks.squads", "tasks.vcs", "tasks.local_workdir", "desktop.host", "mobile.host"]) {
  entries.push({
    source_path: `capability:${capability}`,
    target_path: `capability:${capability}`,
    kind: "capability",
    disposition: "stubbed",
    verification_state: "pending",
    owner_issue: "UNI-426",
  });
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  schema_version: 1,
  baseline_commit: baseline,
  source_product: sourceProduct,
  generated_at: "2026-09-07",
  entries,
}, null, 2)}\n`);
```

- [ ] **Step 4: Generate manifest và kiểm tra contract**

Run: `node scripts/generate-task-parity-manifest.mjs --source-root multica --baseline 3d37828e9 --output docs/parity/tasks-work-management.json --source-brand multica`

Run: `node --test scripts/task-parity-manifest.test.mjs`

Expected: PASS; manifest có ít nhất 709 source entries cộng 6 capability entries, không có disposition `skipped` hoặc `unknown`.

- [ ] **Step 5: Nối gate vào `scripts/check.sh`**

Thêm `scripts/task-parity-manifest.test.mjs` vào đúng lệnh `node --test` đang chạy các repo contract. Chạy:

Run: `bash -n scripts/check.sh && node --test scripts/task-parity-manifest.test.mjs`

Expected: cả hai PASS.

- [ ] **Step 6: Commit artifact và gate**

```bash
git add scripts/generate-task-parity-manifest.mjs scripts/task-parity-manifest.test.mjs scripts/check.sh docs/parity/tasks-work-management.json
git commit -m "test(tasks): pin Work Management parity manifest"
```

### Task 2: Migration schema và backfill in-place

**Files:**

- Create: `server/migrations/107_tasks_work_management_foundation.{up,down}.sql`
- Create: `server/migrations/108_task_catalogs.{up,down}.sql`
- Create: `server/migrations/109_task_relations.{up,down}.sql`
- Create: `server/migrations/110_task_collaboration.{up,down}.sql`
- Create: `server/migrations/111_task_views.{up,down}.sql`
- Create: `server/migrations/112_projects.{up,down}.sql`
- Create: `server/migrations/113_tasks_workspace_number_uidx` đến `130_task_source_contexts_task_idx`, đủ hai chiều
- Create: `server/migrations/131_seed_task_status_catalog.{up,down}.sql`
- Modify: `server/migrations/lint_test.go:240-247`

**Interfaces:**

- Consumes: schema hiện tại tới migration `106`; `tasks.created_by(_kind)` và `tasks.assignee_id/_kind` là nguồn backfill.
- Produces: schema foundation dưới đây; unique identifier `(workspace_id, number)`; catalog bảy status; không xóa legacy attribution columns trong lát cắt này.

Schema bắt buộc:

| Table | Columns ngoài `id`, tenant và timestamps |
| --- | --- |
| `tasks` | `number BIGINT`, `project_id`, `parent_task_id`, `assignee_type`, `creator_type`, `creator_id`, `acceptance_criteria`, `context_refs`, `metadata`, `properties`, `start_date`, `stage`, `origin_type`, `origin_id`, `first_executed_at`, `revision`, `last_activity_at` |
| `task_statuses` | `key`, `name`, `description`, `category`, `color`, `is_system`, `position`, `archived_at`, creator pair |
| `task_labels` | `name`, `color`, `description`, `archived_at`, creator pair |
| `task_properties` | `name`, `type`, `description`, `config`, `position`, `archived_at`, creator pair |
| `task_label_links` | `task_id`, `label_id` |
| `task_dependencies` | `task_id`, `depends_on_task_id`, `type` |
| `task_subscribers` | `task_id`, `actor_type`, `actor_id`, `reason` |
| `task_pins` | `user_id`, `item_type`, `item_id`, `position` |
| `task_comments` | thêm tenant, `parent_comment_id`, `comment_type`, resolve pair, `revision`, `updated_at` |
| `comment_reactions`, `task_reactions` | resource id, actor pair, `emoji` |
| `attachments` | task/comment id, uploader pair, object key/url metadata, size, `source_context_id` |
| `task_source_contexts` | task/origin ids, snapshot version/body/digest/state, capture/attach timestamps |
| `task_views` | owner, scope type/id/variant, visibility, definition/query/display, revision |
| `task_view_preferences` | user, scope type/id, prefs |
| `projects` | title, description, icon, status, priority, lead pair, dates, revision, creator pair |
| `project_resources` | project id, type/ref, label, position, creator pair |

- [ ] **Step 1: Viết static migration contract đang đỏ**

Thêm test vào `server/migrations/lint_test.go`:

```go
func TestTaskFoundationTablesAndColumnsExist(t *testing.T) {
	required := map[string][]string{
		"task_statuses": {"organization_id", "workspace_id", "key", "category", "is_system"},
		"task_labels": {"organization_id", "workspace_id", "name", "color"},
		"task_properties": {"organization_id", "workspace_id", "name", "type", "config"},
		"projects": {"organization_id", "workspace_id", "title", "status", "priority", "revision"},
		"project_resources": {"organization_id", "workspace_id", "project_id", "resource_type", "resource_ref"},
		"task_views": {"organization_id", "workspace_id", "scope_type", "query", "display", "revision"},
	}
	all := ""
	for _, name := range newMigrationUpFiles(t) { all += "\n" + stripSQLComments(readMigration(t, name)) }
	for table, columns := range required {
		body, ok := createdTables(all)[table]
		if !ok { t.Errorf("missing table %s", table); continue }
		for _, column := range columns {
			if !regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(column) + `\b`).MatchString(body) {
				t.Errorf("%s missing %s", table, column)
			}
		}
	}
}
```

- [ ] **Step 2: Chạy test và xác nhận đỏ**

Run: `cd server && go test ./migrations -run 'TestTaskFoundationTablesAndColumnsExist|TestNewTablesCarryOrganizationID' -count=1`

Expected: FAIL với `missing table task_statuses`, `projects`, `task_views`.

- [ ] **Step 3: Viết migrations `107`–`112`**

Các CHECK phải dùng đúng contract:

```sql
CHECK (category IN ('backlog','todo','in_progress','in_review','done','blocked','cancelled'))
CHECK (priority IN ('urgent','high','medium','low','none'))
CHECK (status IN ('planned','in_progress','paused','completed','cancelled'))
CHECK (assignee_type IS NULL OR assignee_type IN ('member','agent','squad'))
CHECK (creator_type IN ('member','agent','system'))
CHECK (jsonb_typeof(properties) = 'object' AND pg_column_size(properties) <= 16384)
CHECK (resource_type IN ('github_repo','local_directory'))
```

Backfill trong `107` phải deterministic và không đổi Task ID:

```sql
UPDATE tasks t
SET organization_id = w.organization_id,
    creator_id = t.created_by,
    creator_type = CASE t.created_by_kind WHEN 'human' THEN 'member' ELSE t.created_by_kind END,
    assignee_type = CASE WHEN t.assignee_id IS NULL THEN NULL WHEN t.assignee_kind = 'human' THEN 'member' ELSE t.assignee_kind END,
    last_activity_at = t.updated_at
FROM workspaces w
WHERE w.id = t.workspace_id;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n
  FROM tasks
)
UPDATE tasks t SET number = numbered.n FROM numbered WHERE numbered.id = t.id;

UPDATE workspaces w
SET task_prefix = COALESCE(NULLIF(upper(left(regexp_replace(w.slug, '[^a-zA-Z0-9]', '', 'g'), 3)), ''), 'UW'),
    task_counter = COALESCE((SELECT max(t.number) FROM tasks t WHERE t.workspace_id = w.id), 0);
```

Sau backfill, đặt `tasks.organization_id`, `tasks.number`, `tasks.creator_id`, `tasks.creator_type`, `tasks.revision`, `tasks.last_activity_at` thành `NOT NULL`. Giữ `created_by`, `created_by_kind`, `assignee_kind` để MVP reader còn chạy; không thêm trigger và không dual-write bằng DB.

Các link/idempotency keys được khóa ngay trong schema: composite key cho
`task_label_links`, `task_subscribers`, `task_view_preferences`; unique constraint
cho `(workspace_id, task_id, depends_on_task_id, type)`, reactions theo
`(resource_id, actor_type, actor_id, emoji)`, pin theo
`(workspace_id, user_id, item_type, item_id)` và resource theo
`(workspace_id, project_id, resource_type, resource_ref)`.

- [ ] **Step 4: Viết migrations concurrent index `113`–`130`**

Mỗi `.up.sql` chứa đúng một statement; tên/index contract:

```text
113 CREATE UNIQUE INDEX CONCURRENTLY idx_tasks_workspace_number ON tasks(workspace_id, number)
114 CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_workspace_key ON task_statuses(workspace_id, key)
115 CREATE UNIQUE INDEX CONCURRENTLY idx_task_statuses_workspace_name ON task_statuses(workspace_id, lower(name)) WHERE archived_at IS NULL
116 CREATE UNIQUE INDEX CONCURRENTLY idx_task_labels_workspace_name ON task_labels(workspace_id, lower(name)) WHERE archived_at IS NULL
117 CREATE INDEX CONCURRENTLY idx_task_properties_workspace_position ON task_properties(workspace_id, position)
118 CREATE INDEX CONCURRENTLY idx_tasks_workspace_project ON tasks(workspace_id, project_id)
119 CREATE INDEX CONCURRENTLY idx_tasks_workspace_parent ON tasks(workspace_id, parent_task_id)
120 CREATE INDEX CONCURRENTLY idx_task_dependencies_task ON task_dependencies(workspace_id, task_id)
121 CREATE INDEX CONCURRENTLY idx_task_subscribers_actor ON task_subscribers(workspace_id, actor_type, actor_id)
122 CREATE INDEX CONCURRENTLY idx_comment_reactions_comment ON comment_reactions(workspace_id, comment_id)
123 CREATE INDEX CONCURRENTLY idx_task_reactions_task ON task_reactions(workspace_id, task_id)
124 CREATE INDEX CONCURRENTLY idx_attachments_task ON attachments(workspace_id, task_id) WHERE task_id IS NOT NULL
125 CREATE INDEX CONCURRENTLY idx_attachments_comment ON attachments(workspace_id, comment_id) WHERE comment_id IS NOT NULL
126 CREATE INDEX CONCURRENTLY idx_task_views_scope ON task_views(workspace_id, scope_type, scope_id)
127 CREATE INDEX CONCURRENTLY idx_projects_workspace ON projects(workspace_id, updated_at DESC)
128 CREATE INDEX CONCURRENTLY idx_project_resources_project ON project_resources(workspace_id, project_id, position)
129 CREATE INDEX CONCURRENTLY idx_task_pins_user ON task_pins(workspace_id, user_id, position)
130 CREATE INDEX CONCURRENTLY idx_task_source_contexts_task ON task_source_contexts(workspace_id, task_id)
```

Mỗi `.down.sql` dùng `DROP INDEX CONCURRENTLY IF EXISTS` với đúng tên index ở danh sách
trên; ví dụ `113.down.sql` là
`DROP INDEX CONCURRENTLY IF EXISTS idx_tasks_workspace_number;`.

- [ ] **Step 5: Seed bảy built-in status trong migration `131`**

```sql
INSERT INTO task_statuses (
  id, organization_id, workspace_id, key, name, description, category,
  color, is_system, position, created_by, created_by_kind
)
SELECT
  '01K4F05STS' || upper(substr(md5(w.id || ':' || s.key), 1, 16)),
  w.organization_id, w.id, s.key, s.name, s.description, s.key,
  s.color, true, s.position, w.created_by, 'system'
FROM workspaces w
CROSS JOIN (VALUES
  ('backlog', 'Backlog', 'Parked work.', '#6b7280', 0::float8),
  ('todo', 'Todo', 'Queued for work.', '#6b7280', 1024::float8),
  ('in_progress', 'In Progress', 'Actively being worked on.', '#f59e0b', 2048::float8),
  ('in_review', 'In Review', 'Waiting on human review.', '#22c55e', 3072::float8),
  ('done', 'Done', 'Completed.', '#3b82f6', 4096::float8),
  ('blocked', 'Blocked', 'Stalled on a dependency.', '#ef4444', 5120::float8),
  ('cancelled', 'Cancelled', 'Decided not to do.', '#6b7280', 6144::float8)
) AS s(key, name, description, color, position)
ON CONFLICT (workspace_id, key) DO NOTHING;
```

`131.down.sql` chỉ xóa `WHERE is_system = true`; không chạm custom rows.

- [ ] **Step 6: Cập nhật tenant debt và chạy migration lints**

Xóa `tasks`, `task_comments` khỏi `tenantBackfillDebt`. Chạy:

Run: `cd server && go test ./migrations -run 'TestMigration|TestNew|TestTablesWithout|TestActorKind|TestTaskFoundation' -count=1`

Expected: PASS; không có foreign key, plain index, thiếu tenant column hoặc reused prefix.

- [ ] **Step 7: Commit schema foundation**

```bash
git add server/migrations
git commit -m "feat(db): add Tasks parity foundation schema"
```

### Task 3: SQLC query contracts và generated code

**Files:**

- Modify: `server/pkg/db/queries/tasks.sql`
- Modify: `server/pkg/db/queries/workspaces.sql`
- Create: `server/pkg/db/queries/task_statuses.sql`
- Create: `server/pkg/db/queries/projects.sql`
- Modify: `server/internal/testutil/db.go:54-69`
- Regenerate: `server/pkg/db/generated/*`

**Interfaces:**

- Consumes: tables/migrations của Task 2.
- Produces: `NextTaskNumber(ctx, workspaceID) (int64, error)`, `CreateTaskStatus`, `ListTaskStatuses`, `GetTaskStatusByKey`, tenant-scoped Project/resource CRUD primitives.

- [ ] **Step 1: Viết query-scope regression test đang đỏ**

Thêm vào `server/internal/arch_test.go` một case quét bốn query files mới, yêu cầu mọi statement đọc/ghi business table chứa cả `organization_id` và `workspace_id`; miễn duy nhất `NextTaskNumber` vì nó update chính row workspace đã được service authorize.

```go
var taskFoundationQueryFiles = []string{
	"../pkg/db/queries/tasks.sql",
	"../pkg/db/queries/task_statuses.sql",
	"../pkg/db/queries/projects.sql",
}
```

Run: `cd server && go test ./internal -run TestTaskFoundationQueriesCarryTenantScope -count=1`

Expected: FAIL vì file/query mới chưa có hoặc query Tasks cũ chỉ lọc theo `workspace_id`/`id`.

- [ ] **Step 2: Viết query atomic identifier và tenant-scoped Tasks**

```sql
-- name: NextTaskNumber :one
UPDATE workspaces
SET task_counter = task_counter + 1, updated_at = now()
WHERE id = $1
RETURNING task_counter;

-- name: GetTaskInWorkspace :one
SELECT * FROM tasks
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id');
```

Đổi `CreateTask` và `CreateWelcomeTask` để nhận `organization_id`, `number`, `assignee_type`, `creator_type`, `creator_id`, `revision`, `last_activity_at`; vẫn ghi legacy attribution columns trong giai đoạn chuyển tiếp đã được spec cho phép. Đổi list/max-position/comment queries để filter cả tenant và workspace.

- [ ] **Step 3: Viết status catalog queries**

```sql
-- name: ListTaskStatuses :many
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2
ORDER BY position, created_at, id;

-- name: GetTaskStatusByKey :one
SELECT * FROM task_statuses
WHERE organization_id = $1 AND workspace_id = $2 AND key = $3;

-- name: CreateTaskStatus :one
INSERT INTO task_statuses (
  id, organization_id, workspace_id, key, name, description, category,
  color, is_system, position, created_by, created_by_kind
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING *;
```

- [ ] **Step 4: Viết Project/resource persistence primitives**

`projects.sql` phải có `ListProjects`, `GetProject`, `CreateProject`, `UpdateProject`, `DeleteProject`, `ListProjectResources`, `CreateProjectResource`, `UpdateProjectResource`, `DeleteProjectResource`; mọi `WHERE` nhận cả `organization_id` và `workspace_id`. Mutation chưa được handler gọi trong slice này.

```sql
-- name: GetProject :one
SELECT * FROM projects
WHERE id = $1 AND organization_id = $2 AND workspace_id = $3;

-- name: ListProjectResources :many
SELECT * FROM project_resources
WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3
ORDER BY position, created_at, id;
```

- [ ] **Step 5: Generate và compile sqlc**

Run: `make sqlc`

Run: `cd server && go test ./pkg/db/generated ./internal -run TestTaskFoundationQueriesCarryTenantScope -count=1`

Expected: PASS; generated package compile, scope guard xanh.

- [ ] **Step 6: Cập nhật test cleanup**

Thêm các bảng mới vào `TRUNCATE` trước `projects`, `tasks`, `workspaces`: `project_resources`, `projects`, `task_source_contexts`, `attachments`, `task_reactions`, `comment_reactions`, `task_view_preferences`, `task_views`, `task_pins`, `task_subscribers`, `task_dependencies`, `task_label_links`, `task_properties`, `task_labels`, `task_statuses`.

Run: `cd server && go test ./internal/testutil ./internal/service -run TestTaskCRUD -count=1`

Expected: PASS và không có lỗi unique từ test trước.

- [ ] **Step 7: Commit query layer**

```bash
git add server/pkg/db/queries server/pkg/db/generated server/internal/arch_test.go server/internal/testutil/db.go
git commit -m "feat(db): add tenant-scoped Work Management queries"
```

### Task 4: Workspace prefix và status seed

**Files:**

- Create: `server/internal/service/task_status_catalog.go`
- Create: `server/internal/service/task_status_catalog_test.go`
- Modify: `server/internal/service/workspace.go:55-127`
- Modify: `server/internal/service/workspace_test.go`

**Interfaces:**

- Consumes: `db.CreateTaskStatus`, `db.ListTaskStatuses`; workspace create transaction.
- Produces: `BuiltInTaskStatuses() []BuiltInTaskStatus`, `deriveTaskPrefix(slug string) string`, `seedBuiltInTaskStatuses(ctx, q, workspace) error`.

- [ ] **Step 1: Viết test canonical catalog và workspace seed đang đỏ**

```go
func TestBuiltInTaskStatusesCanonicalOrder(t *testing.T) {
	got := BuiltInTaskStatuses()
	want := []string{"backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"}
	if len(got) != len(want) { t.Fatalf("len = %d", len(got)) }
	for i := range want {
		if got[i].Key != want[i] || got[i].Category != want[i] || got[i].Position != float64(i*1024) {
			t.Fatalf("status[%d] = %+v", i, got[i])
		}
	}
}
```

Trong `workspace_test.go`, sau `CreateInOrg`, gọi `ListTaskStatuses` và assert đủ 7 row, `is_system=true`, `workspace.task_prefix` bằng `ALP` cho slug `alpha`.

Run: `cd server && go test ./internal/service -run 'TestBuiltInTaskStatusesCanonicalOrder|TestWorkspaceCreateSeedsTaskStatuses' -count=1`

Expected: FAIL do helper/seed chưa tồn tại.

- [ ] **Step 2: Viết canonical catalog immutable-by-copy**

```go
type BuiltInTaskStatus struct {
	Key, Name, Description, Color, Category string
	Position                                float64
}

var builtInTaskStatuses = []BuiltInTaskStatus{
	{Key: "backlog", Name: "Backlog", Description: "Parked work.", Color: "#6b7280", Category: "backlog", Position: 0},
	{Key: "todo", Name: "Todo", Description: "Queued for work.", Color: "#6b7280", Category: "todo", Position: 1024},
	{Key: "in_progress", Name: "In Progress", Description: "Actively being worked on.", Color: "#f59e0b", Category: "in_progress", Position: 2048},
	{Key: "in_review", Name: "In Review", Description: "Waiting on human review.", Color: "#22c55e", Category: "in_review", Position: 3072},
	{Key: "done", Name: "Done", Description: "Completed.", Color: "#3b82f6", Category: "done", Position: 4096},
	{Key: "blocked", Name: "Blocked", Description: "Stalled on a dependency.", Color: "#ef4444", Category: "blocked", Position: 5120},
	{Key: "cancelled", Name: "Cancelled", Description: "Decided not to do.", Color: "#6b7280", Category: "cancelled", Position: 6144},
}

func BuiltInTaskStatuses() []BuiltInTaskStatus {
	return append([]BuiltInTaskStatus(nil), builtInTaskStatuses...)
}
```

- [ ] **Step 3: Seed trong cùng workspace transaction**

`deriveTaskPrefix` bỏ ký tự ngoài `[A-Za-z0-9]`, uppercase ba ký tự đầu và fallback `UW`. Ngay sau `AddWorkspaceMember`, lặp canonical catalog, gọi `CreateTaskStatus` với `util.NewID()`, `organization_id`, workspace ID, `created_by=w.CreatedBy`, `created_by_kind=system`. Bất kỳ insert lỗi phải rollback workspace, membership, quota và audit.

Run: `cd server && go test ./internal/service -run 'TestBuiltInTaskStatuses|TestWorkspaceCreateSeedsTaskStatuses|TestWorkspace' -count=1`

Expected: PASS.

- [ ] **Step 4: Commit workspace initialization**

```bash
git add server/internal/service/task_status_catalog.go server/internal/service/task_status_catalog_test.go server/internal/service/workspace.go server/internal/service/workspace_test.go
git commit -m "feat(tasks): seed workspace Task catalog"
```

### Task 5: Atomic Task identifiers và MVP compatibility

**Files:**

- Modify: `server/internal/service/task.go`
- Modify: `server/internal/service/onboarding.go`
- Modify: `server/internal/service/{task_test.go,onboarding_test.go}`
- Modify: `server/internal/handler/task.go`
- Modify: `server/internal/handler/dto/sdo/task.go`

**Interfaces:**

- Consumes: `NextTaskNumber`, `tasks.organization_id`, `number`, normalized actor fields.
- Produces: mỗi Task mới có unique `<task_prefix>-<number>`, revision `1`; existing HTTP response thêm fields nhưng không bỏ fields MVP.

- [ ] **Step 1: Viết concurrency test đang đỏ**

```go
func TestTaskNumbersAreAtomicPerWorkspace(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	const count = 12
	numbers := make(chan int64, count)
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		go func(i int) {
			task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: fmt.Sprintf("T-%d", i)})
			if err != nil { errs <- err; return }
			numbers <- task.Number
		}(i)
	}
	seen := map[int64]bool{}
	for i := 0; i < count; i++ {
		select {
		case err := <-errs: t.Fatal(err)
		case number := <-numbers:
			if seen[number] { t.Fatalf("duplicate number %d", number) }
			seen[number] = true
		}
	}
}
```

Run: `cd server && go test ./internal/service -run TestTaskNumbersAreAtomicPerWorkspace -count=1`

Expected: FAIL vì `Task.Number`/allocator chưa được nối.

Trong cùng test, thử tạo/gán Task cho `ub.ID` là người ngoài workspace và assert
`errors.As(err, &CodedError{})` có code `assignee_not_member`.

- [ ] **Step 2: Allocate number trong transaction tạo Task**

Sau khi mở transaction và bind `q`, gọi `NextTaskNumber`. `CreateTaskParams` nhận:

```go
number, err := q.NextTaskNumber(ctx, workspaceID)
if err != nil { return db.Task{}, err }
task, err := q.CreateTask(ctx, db.CreateTaskParams{
	ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	Number: number, Title: strings.TrimSpace(in.Title), Description: in.Description,
	Priority: in.Priority, AssigneeID: optText(in.AssigneeID), AssigneeKind: assigneeKind,
	AssigneeType: normalizedAssigneeType(in.AssigneeID, assigneeKind), DueDate: due,
	Position: maxPos + 1024, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	CreatorID: actor.ID, CreatorType: normalizedCreatorType(actor.Kind),
})
```

`normalizedCreatorType(human)=member`; `agent=agent`; `system=system`. Unassigned Task có `assignee_type=NULL`. Welcome Task giữ legacy creator pair `userID/human` để reader và unique constraint cũ hoạt động, đồng thời ghi normalized creator pair `onboarding/system`.

Đổi validation assignee người từ “nhận mọi id” sang `WorkspaceService.RequireMember`;
agent vẫn qua `RequireAgentMember`; squad trả
`capability_unavailable/squad_directory_missing` trong slice này. Mapping lỗi người
ngoài workspace là HTTP 422 `assignee_not_member`, không lộ thêm dữ liệu tenant.

- [ ] **Step 3: Dùng cùng allocator cho welcome Task**

Trong `SeedWelcomeTask`, allocate number trong transaction trước `CreateWelcomeTask`; creator normalized là `system`, nhưng legacy `created_by=userID` vẫn giữ để unique welcome constraint và reader cũ hoạt động. Test assert lần gọi idempotent không tăng counter lần hai.

- [ ] **Step 4: Mở rộng response additive**

```go
type TaskDTO struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	WorkspaceID    string `json:"workspace_id"`
	Number         int64  `json:"number"`
	Identifier     string `json:"identifier"`
	Revision       int64  `json:"revision"`
}
```

Giữ các field hiện có trong struct. `taskDTOs` nhận workspace prefix theo batch hoặc query projection, không query per Task. Nếu list chỉ chứa một workspace, load prefix đúng một lần.

Trong slice này, thêm `TaskPrefix` vào `WorkspaceView`; `taskDTOs` gọi
`Workspaces.GetView(ctx, userID, workspaceID)` đúng một lần cho list workspace-scoped,
rồi dùng mapper sau cho mọi row:

```go
func toTaskDTO(task db.Task, prefix string) sdo.TaskDTO {
	out := sdo.TaskDTO{
		ID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Number: task.Number, Identifier: fmt.Sprintf("%s-%d", prefix, task.Number),
		Revision: task.Revision,
	}
	return fillLegacyTaskDTOFields(out, task)
}
```

`fillLegacyTaskDTOFields` chứa nguyên mapping MVP hiện tại (title, description, status,
priority, assignee, due date, position, kind, creator, timestamps), nên response chỉ
được cộng field, không mất field.

- [ ] **Step 5: Chạy service và handler tests**

Run: `cd server && go test ./internal/service ./internal/handler -run 'TestTask|TestSeedWelcomeTask' -count=1`

Expected: PASS; 12 concurrent creates có 12 số khác nhau, welcome Task idempotent, CRUD cũ vẫn xanh.

- [ ] **Step 6: Commit compatibility writers/readers**

```bash
git add server/internal/service/task.go server/internal/service/onboarding.go server/internal/service/task_test.go server/internal/service/onboarding_test.go server/internal/handler/task.go server/internal/handler/dto/sdo/task.go
git commit -m "feat(tasks): allocate stable Task identifiers"
```

### Task 6: Capability registry và rollout flag

**Files:**

- Create: `server/internal/workcapability/catalogue.go`
- Create: `server/internal/workcapability/catalogue_test.go`
- Modify: `server/internal/featureflags/keys.go`
- Modify: `server/internal/handler/config.go`
- Create or modify: `server/internal/handler/config_test.go`
- Modify: `server/internal/handler/dto/sdo/common.go`
- Create: `packages/core/capabilities/{types.ts,registry.ts,registry.test.ts,index.ts}`
- Modify: `packages/core/api/endpoints/{config.ts,config.test.ts}`
- Modify: `packages/core/package.json`

**Interfaces:**

- Produces Go `workcapability.Catalogue() map[string]Entry` và TS `capabilityState(config, key): CapabilityState`.
- Public config shape thêm `work_management_capabilities: Record<string, {status, reason_code, explanation_key}>`.

- [ ] **Step 1: Viết Go catalog test đang đỏ**

```go
func TestCatalogueMatchesInitialRolloutContract(t *testing.T) {
	got := Catalogue()
	want := map[string]Status{
		"tasks.core": Available, "tasks.projects": Unavailable, "tasks.attachments": Unavailable,
		"tasks.agent_runs": Unavailable, "tasks.squads": Unavailable,
		"tasks.vcs": Unavailable, "tasks.local_workdir": Unavailable,
		"desktop.host": Unavailable, "mobile.host": Unavailable,
	}
	for key, status := range want {
		if got[key].Status != status { t.Fatalf("%s = %+v", key, got[key]) }
		if status == Unavailable && got[key].ReasonCode == "" { t.Fatalf("%s has no reason", key) }
	}
	delete(got, "tasks.core")
	if _, ok := Catalogue()["tasks.core"]; !ok { t.Fatal("Catalogue leaked mutable map") }
}
```

Run: `cd server && go test ./internal/workcapability -count=1`

Expected: FAIL vì package chưa tồn tại.

- [ ] **Step 2: Implement typed Go catalog**

```go
type Status string
const (
	Available Status = "available"
	Unavailable Status = "unavailable"
)
type Entry struct {
	Status Status `json:"status"`
	ReasonCode string `json:"reason_code,omitempty"`
	ExplanationKey string `json:"explanation_key,omitempty"`
}
```

Available entries để reason rỗng. `tasks.projects` và `tasks.attachments` dùng
`surface_not_ready` cho tới slice sở hữu surface qua gate. Các unavailable entry còn
lại dùng stable codes: `agent_runtime_missing`, `squad_directory_missing`,
`vcs_provider_missing`, `local_daemon_missing`, `host_not_built`; explanation keys có
prefix `capabilities.`.

- [ ] **Step 3: Thêm rollout flag và config SDO**

Thêm catalog flag:

```go
{Key: "tasks_work_management_parity", Description: "Cutover Work Management suite mới", Default: false, Public: true, Owner: "tasks", ReviewAt: day(2026, 12, 15)},
```

`config` trả `WorkManagementCapabilities: workcapability.Catalogue()`. Handler test assert flag false theo default và đủ 9 capability entries.

- [ ] **Step 4: Viết TS malformed-response test đang đỏ**

```ts
it("degrades malformed capability entries to the unavailable fallback", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({
    flags: {},
    rum_sample_rate: 0,
    work_management_capabilities: { "tasks.vcs": { status: 7 } },
  }));
  const config = await getPublicConfig();
  expect(config.work_management_capabilities).toEqual({});
  expect(capabilityState(config, "tasks.vcs")).toEqual({
    status: "unavailable",
    reason_code: "capability_unknown",
    explanation_key: "capabilities.unknown",
  });
});
```

Run: `pnpm --filter @uniwork/core test -- api/endpoints/config.test.ts capabilities/registry.test.ts`

Expected: FAIL vì schema/registry chưa tồn tại.

- [ ] **Step 5: Implement TS types, fallback và export**

```ts
export type CapabilityStatus = "available" | "unavailable";
export type WorkManagementCapability =
  | "tasks.core" | "tasks.projects" | "tasks.attachments" | "tasks.agent_runs"
  | "tasks.squads" | "tasks.vcs" | "tasks.local_workdir" | "desktop.host" | "mobile.host";
export interface CapabilityState {
  status: CapabilityStatus;
  reason_code: string;
  explanation_key: string;
}
```

Zod schema dùng `z.string()` cho status rồi refine/fallback toàn map; không cast network JSON. Export `./capabilities` từ `package.json` và dùng module trong config endpoint test để tránh orphan package.

- [ ] **Step 6: Chạy contract tests hai phía**

Run: `cd server && go test ./internal/workcapability ./internal/handler -run 'TestCatalogue|TestConfig' -count=1`

Run: `pnpm --filter @uniwork/core test -- api/endpoints/config.test.ts capabilities/registry.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit capability contract**

```bash
git add server/internal/workcapability server/internal/featureflags/keys.go server/internal/handler/config.go server/internal/handler/config_test.go server/internal/handler/dto/sdo/common.go packages/core/capabilities packages/core/api/endpoints/config.ts packages/core/api/endpoints/config.test.ts packages/core/package.json
git commit -m "feat(tasks): publish Work Management capabilities"
```

### Task 7: Migration rehearsal và tenant isolation

**Files:**

- Modify: `server/migrations/migrate_test.go`
- Modify: `server/internal/service/task_test.go`
- Modify: `server/migrations/lint_test.go` nếu rehearsal tìm ra contract guard còn thiếu

**Interfaces:**

- Consumes: migrations `107`–`131`, Task create compatibility.
- Produces: bằng chứng upgrade từ `106`, dữ liệu không đổi, numbering deterministic và cross-tenant lookup không đọc nhầm.

- [ ] **Step 1: Viết rehearsal test từ migration 106**

Test giữ advisory lock `727273`, `Up`, rồi `Down` đến khi version `107_tasks_work_management_foundation` chưa applied. Chèn hai organizations, hai workspaces, ba Tasks có cùng timestamp và hai comments theo schema cũ; sau đó `Up` lại.

```go
rows, err := pool.Query(ctx, `
  SELECT id, organization_id, number, creator_id, creator_type, last_activity_at
  FROM tasks WHERE workspace_id=$1 ORDER BY number`, workspaceID)
if err != nil { t.Fatal(err) }
defer rows.Close()
```

Assert: IDs/title/description/comment body/timestamps giữ nguyên; numbers là `1,2,3` theo `(created_at,id)`; prefix/counter là `ALP/3`; mỗi workspace có đúng 7 system statuses; không có audit row được tạo bởi migration.

- [ ] **Step 2: Chạy rehearsal và xác nhận kết quả**

Run: `cd server && go test ./migrations -run TestTasksWorkManagementUpgradeFrom106 -count=1 -v`

Expected: PASS. Nếu test skip vì DB không chạy, dùng `make migrate-up` để khởi động DB test rồi chạy lại; không chấp nhận SKIP làm bằng chứng hoàn thành.

- [ ] **Step 3: Viết two-organization isolation test**

Tạo org/workspace A và B, một Task mỗi bên. Gọi tenant-scoped query/service của A với task ID B và assert `ErrNotFound`/zero rows; lặp lại cho status/project/resource query primitives bằng organization/workspace mismatch.

Run: `cd server && go test ./internal/service -run 'TestTaskTenantIsolation|TestTaskFoundationTenantIsolation' -count=1`

Expected: PASS; không case nào trả row tenant B.

- [ ] **Step 4: Chạy migration + service suite**

Run: `cd server && go test ./migrations ./internal/service ./internal/handler -count=1`

Expected: PASS, không SKIP migration rehearsal.

- [ ] **Step 5: Commit rehearsal evidence**

```bash
git add server/migrations/migrate_test.go server/migrations/lint_test.go server/internal/service/task_test.go
git commit -m "test(tasks): prove foundation migration and isolation"
```

### Task 8: Full verification và handoff

**Files:**

- Modify: `docs/superpowers/plans/2026-09-07-tasks-parity-foundation.md`
- Modify: `docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md`
- Modify: `docs/roadmap/FEATURE_ROADMAP.md` chỉ khi trạng thái F-05 evidence thay đổi

**Interfaces:**

- Produces: verified slice-1 checkpoint; manifest entries của slice 1 chuyển `verification_state` sang `verified` kèm evidence path/commit.

- [ ] **Step 1: Quét placeholder, provenance leak và manifest state**

Run: `rg -n 'T[B]D|T[O]DO|implement[[:space:]]+later|skipped|unknown' docs/superpowers/plans/2026-09-07-tasks-parity-foundation.md docs/parity/tasks-work-management.json`

Expected: không có placeholder/disposition bị cấm; `capability_unknown` trong code là fallback contract hợp lệ và không nằm trong manifest disposition.

Run: `rg -ni 'multica' server packages apps scripts --glob '!generate-task-parity-manifest.mjs' --glob '!task-parity-manifest.test.mjs'`

Expected: không có hit mới từ branch này; provenance chỉ nằm trong docs/manifest. Nếu repo có hit lịch sử, lưu baseline trước/sau và yêu cầu delta bằng 0.

- [ ] **Step 2: Chạy narrow gates**

Run: `node --test scripts/task-parity-manifest.test.mjs scripts/events-catalogue.test.mjs scripts/governance.test.mjs`

Run: `pnpm --filter @uniwork/core typecheck && pnpm --filter @uniwork/core lint && pnpm --filter @uniwork/core test`

Run: `make test-go`

Expected: tất cả PASS; không claim xanh nếu migration rehearsal bị SKIP.

- [ ] **Step 3: Chạy full gate**

Run: `make check`

Expected: PASS. Nếu gate governance orphan-module có từ baseline, tách fix nhỏ bằng cách wire module vừa tạo hoặc cập nhật authoritative list đúng code state; không hạ/skip gate.

- [ ] **Step 4: Cập nhật trạng thái tài liệu**

Đổi plan thành `> **Trạng thái:** shipped` chỉ sau `make check` xanh. Giữ umbrella spec `in-progress`, thêm evidence rằng slice 1/UNI-495 shipped; không đánh dấu UNI-426 done.

- [ ] **Step 5: Commit checkpoint cuối**

```bash
git add docs/superpowers/plans/2026-09-07-tasks-parity-foundation.md docs/superpowers/specs/2026-09-07-tasks-work-management-parity-design.md docs/roadmap/FEATURE_ROADMAP.md docs/parity/tasks-work-management.json
git commit -m "docs: record UNI-495 foundation evidence"
```

- [ ] **Step 6: Ghi UniAI stop comment**

Chạy `uniai issue comment add UNI-495 --content "[agent] Hoàn tất slice 1: parity manifest, schema/backfill, Task identifiers, workspace status seed và capability registry. Đã chạy manifest contract, core tests, make test-go và make check; kết quả chi tiết nằm trong output của task. Bước kế tiếp là review PR và lập plan slice 2."`. Nếu một gate không đạt thì thay câu “Đã chạy” bằng tên gate, lỗi thực tế và trạng thái chưa hoàn thành. Chỉ người dùng đặt `done`; agent dừng ở `in_review` sau khi mở PR bằng `make issue-pr`.

---

## Spec coverage của lát cắt 1

| Spec | Task |
| --- | --- |
| Baseline cố định, không skipped/unknown | Task 1 |
| Schema Task, catalogs, relations, collaboration, views, Projects | Task 2 |
| Tenant-scoped query contracts | Task 3 |
| Bảy built-in statuses cho existing/new workspace | Tasks 2, 4 |
| ULID/data/comment/attribution preservation | Tasks 2, 5, 7 |
| Stable Task identifier và counter | Tasks 2, 3, 5 |
| Capability visible-disabled contract | Task 6 |
| Migration rehearsal, tenant isolation, no fake audit | Task 7 |
| No source-brand leak và full verification | Task 8 |

Các API collection/detail, Project CRUD handlers, Status/Label/Property settings handlers, UI và realtime mutation behavior không bị bỏ quên: parity manifest gán chúng cho các slice UNI-426 tiếp theo; chúng không thuộc deliverable độc lập UNI-495.
