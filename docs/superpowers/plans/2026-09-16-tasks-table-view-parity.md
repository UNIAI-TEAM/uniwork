# View Bảng ngang usf — Implementation Plan

> **Trạng thái:** in-progress — PR1 xong (`5bbae89`), spec + ADR 0020 (`2774938`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View Bảng của Công việc đúng dữ liệu ở mọi quy mô (sort/search/việc con/nhóm phía server, cursor), đủ thao tác như usf, không treo, không N+1, có e2e.

**Architecture:** Backend dựng SQL động cho bảng trong `server/pkg/db/tablequery` (ADR 0020) sau `RequireMember`; ba route `tasks/table/{groups,rows,facets}` đổi hợp đồng sang `query{filter,search,sort}` + `group_by/group_key` + `hierarchy/parent_id` + `cursor`. Client dùng một hook phân trang cursor chung (`useCursorBranches`) cho board và bảng; bảng tải việc con lười theo cha, cột thuộc tính sửa trong ô bằng `PropertyValueEditor` dùng chung.

**Tech Stack:** Go 1.27 + pgx v5 + sqlc (phần còn lại), Next.js/React 19, TanStack Query v5 + Table v8 + Virtual, dnd-kit, Zod, Vitest + RTL, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-tasks-table-view-parity-design.md` (đọc trước mỗi task; plan không lặp lại lý do).

## Global Constraints

- Issue UNI-654; mọi commit trên nhánh `feature/UNI-654-…` (trailer `Refs:` do hook thêm). Commit prefix Conventional (`feat(tasks)`, `fix(tasks)`, `test(tasks)`, `refactor(tasks)`, `docs`).
- Code comment tiếng Anh; chuỗi UI qua `t()`, khóa ở `packages/core/i18n/locales/{vi,en}.json` (và mọi locale khác đang có), giọng văn theo `docs/conventions.md` ("việc", không "task"; ngoặc cong).
- File `.ts/.tsx` ≤ 500 dòng (không tính dòng trống/comment); quá thì tách module.
- `packages/views` không import `next/*`; `packages/ui` không import `@uniwork/core`.
- Endpoint client: `parseWithFallback` + test malformed; không cast JSON mạng.
- Mọi `useQueries` cấp dữ liệu cho memo/bảng phải có `combine` ổn định (bài học PR1).
- dnd-kit `PointerSensor` `activationConstraint: { distance: 5 }`.
- Không FK, index `CONCURRENTLY` một câu/file; bảng mới có `organization_id` (không dự kiến bảng mới).
- `make check` xanh trước mỗi PR; e2e chạy 2 lần nếu đổi provider/CSS toàn cục. Trước khi kết luận flake: `uptime`, chờ load < 6.
- Không đổi `Patch` của `task.updated` (ADR 0015).
- Giới hạn trang: `limit` 1..100, mặc định 50; debounce tìm kiếm 300 ms.

---

## File Structure

**Backend**
- Create `server/pkg/db/tablequery/query.go` — kiểu `Query`, `Filter`, `Sort`, `Group`, `Hierarchy`; chuẩn hóa.
- Create `server/pkg/db/tablequery/groupkey.go` — mã hóa/giải mã `group_key`, vị từ nhóm.
- Create `server/pkg/db/tablequery/cursor.go` — mã hóa/giải mã cursor, fingerprint.
- Create `server/pkg/db/tablequery/build.go` — dựng SQL rows/count/groups/facets (chỉ builder, không I/O).
- Create `server/pkg/db/tablequery/exec.go` — chạy trên `pgx.Tx`, scan dòng.
- Create `server/pkg/db/tablequery/*_test.go` — test builder/cursor/groupkey (không DB).
- Modify `server/pkg/db/queries/task_labels.sql` — `ListLabelsForTasks`.
- Rewrite `server/internal/service/task_table.go` (+ tách `task_table_input.go` nếu > 500 dòng) — service dùng tablequery.
- Rewrite `server/internal/service/task_table_test.go` — test DB thật.
- Modify `server/internal/handler/dto/sdi/task.go`, `dto/sdo/task.go`, `handler/task_table.go`, `handler/task_table_test.go`, `handler/router/tasks.go` (mô tả apiOp).
- Modify `server/internal/arch_test.go` — `TestTableQueryOnlyFromTaskTableService`.
- Modify `CLAUDE.md` § Database and Migration Rules — một dòng luật ADR 0020 + tên test.
- (PR3) Modify `server/internal/service/task.go`, `server/pkg/db/queries/tasks.sql`, `dto/sdi/task.go`, `handler/task*.go` — `start_date` trong PATCH.

**Core**
- Rewrite `packages/core/api/endpoints/tasks-table.ts` (+ `.test.ts`).
- Rewrite `packages/core/tasks/surface/table-query.ts` (+ test).
- Modify `packages/core/tasks/hooks.ts` (chỗ dùng `tableRowsPageBody`), `hooks-suite.ts`.
- Modify `packages/core/tasks/hooks-catalog.ts` — `useSetTaskPropertyValue`, `useUnsetTaskPropertyValue` (PR3).
- Modify `packages/core/api/endpoints/tasks.ts` — `TaskPatch.start_date` (PR3).

**Views**
- Create `packages/views/tasks/surface/use-cursor-branches.ts` (+ test).
- Modify `packages/views/tasks/surface/use-board-columns-data.ts` (+ test), `packages/views/test/board-table-server.ts`.
- Rewrite `packages/views/tasks/modes/use-table-view-data.ts` (+ test); tách `table-branches.ts` (dựng nhánh/dòng hiển thị, hàm thuần).
- Modify `table-view.tsx`, `table-view-columns.tsx`, `table-view-toolbar.tsx`, `table-view-model.ts`, `table-cell-editors.tsx`, `table-column-picker.tsx`, `table-load-more-row.tsx`, `table-group-row.tsx`, `table-inline-title.tsx`.
- Create `packages/views/tasks/modes/table-header-sort-menu.tsx`, `table-branch-error-row.tsx`, `use-debounced-value.ts`.
- Create `packages/views/tasks/properties/property-value-editor.tsx`, `property-value-display.tsx`, `property-value.ts` (+ tests).
- Modify `packages/ui/components/ui/data-table.tsx` (+ `data-table-reorder.test.tsx`) — reorder header tùy chọn.
- Modify `packages/core/tasks/stores/view-store-types.ts` — `TableGrouping` thêm `"priority"`; độ rộng mặc định.
- Create `e2e/tasks-table.spec.ts`, `e2e/tasks-seed.ts`.

---

# PR2 — API cursor + tablequery + board/bảng chạy trên API mới

### Task 1: `tablequery` — kiểu, group key, cursor (không DB)

**Files:**
- Create: `server/pkg/db/tablequery/query.go`, `groupkey.go`, `cursor.go`
- Test: `server/pkg/db/tablequery/groupkey_test.go`, `cursor_test.go`

**Interfaces — Produces:**
```go
package tablequery

type Filter struct{ Statuses, Priorities, AssigneeIDs, ProjectIDs []string }

type PropertyRef struct {
	ID      string
	Type    string   // text|number|select|multi_select|date|checkbox|url
	Options []string // select: option ids in display order (by name), for sort rank
}

type Sort struct {
	Field    string       // position|title|created_at|updated_at|start_date|due_date|status|priority|property
	Desc     bool
	Property *PropertyRef // when Field == "property"
}

type GroupKind string // "none","status","priority","assignee","project","property"

type Group struct {
	Kind     GroupKind
	Property *PropertyRef // when Kind == property; Type must be select|checkbox
}

type Query struct {
	OrganizationID, WorkspaceID string
	Filter Filter
	Search string // already trimmed
	Sort   Sort
	Group  Group
	Hierarchy bool
}

// Normalize sorts+dedupes filter slices, trims search, forces Desc=false for position,
// and falls back Sort to position for property types multi_select/checkbox.
func (q Query) Normalize() Query

// GroupPredicate is one decoded group_key.
type GroupPredicate struct {
	Kind  GroupKind
	None  bool   // the "none"/unassigned bucket
	Value string // status key | priority | project id | option id | "true"/"false"
	ActorKind string // assignee only: human|agent
}

func EncodeGroupKey(g Group, p GroupPredicate) string
func DecodeGroupKey(g Group, key string) (GroupPredicate, error) // ErrInvalidGroupKey

type Cursor struct {
	V          int     `json:"v"`
	FP         string  `json:"fp"`
	GroupKey   *string `json:"group_key"`
	ParentID   *string `json:"parent_id"`
	SortValue  *string `json:"sort_value"` // text form; nil when SortNull
	SortNull   bool    `json:"sort_null"`
	CreatedAt  string  `json:"created_at"` // RFC3339Nano
	ID         string  `json:"id"`
}

func EncodeCursor(c Cursor) string                // base64url, no padding
func DecodeCursor(s string) (Cursor, error)       // ErrInvalidCursor
func Fingerprint(q Query) string                  // hex sha256 of canonical JSON (workspace, filter, search, sort, group, hierarchy)

var ErrInvalidGroupKey, ErrInvalidCursor error
```

- [ ] **Step 1: Write failing tests**

`groupkey_test.go`:
```go
func TestGroupKeyRoundTrip(t *testing.T) {
	prop := &PropertyRef{ID: "01PROP", Type: "select"}
	cases := []struct {
		g Group
		p GroupPredicate
		want string
	}{
		{Group{Kind: "status"}, GroupPredicate{Kind: "status", Value: "todo"}, "status:todo"},
		{Group{Kind: "priority"}, GroupPredicate{Kind: "priority", Value: "high"}, "priority:high"},
		{Group{Kind: "assignee"}, GroupPredicate{Kind: "assignee", None: true}, "assignee:none"},
		{Group{Kind: "assignee"}, GroupPredicate{Kind: "assignee", ActorKind: "agent", Value: "01AG"}, "assignee:agent:01AG"},
		{Group{Kind: "project"}, GroupPredicate{Kind: "project", None: true}, "project:none"},
		{Group{Kind: "project"}, GroupPredicate{Kind: "project", Value: "01PJ"}, "project:01PJ"},
		{Group{Kind: "property", Property: prop}, GroupPredicate{Kind: "property", None: true}, "property:01PROP:none"},
		{Group{Kind: "property", Property: prop}, GroupPredicate{Kind: "property", Value: "opt:1"}, "property:01PROP:v:b3B0OjE"},
	}
	for _, c := range cases {
		if got := EncodeGroupKey(c.g, c.p); got != c.want {
			t.Fatalf("encode %+v = %q, want %q", c.p, got, c.want)
		}
		back, err := DecodeGroupKey(c.g, c.want)
		if err != nil || back != c.p {
			t.Fatalf("decode %q = %+v, %v; want %+v", c.want, back, err, c.p)
		}
	}
}

func TestGroupKeyRejectsMismatch(t *testing.T) {
	for _, key := range []string{"", "priority:high", "status:", "assignee:robot:1", "property:OTHER:none", "property:01PROP:v:!!"} {
		if _, err := DecodeGroupKey(Group{Kind: "status"}, key); key != "priority:high" && err == nil {
			t.Fatalf("status group accepted %q", key)
		}
	}
	if _, err := DecodeGroupKey(Group{Kind: "status"}, "priority:high"); !errors.Is(err, ErrInvalidGroupKey) {
		t.Fatal("kind mismatch must be ErrInvalidGroupKey")
	}
}
```
`cursor_test.go`:
```go
func TestCursorRoundTripAndTamper(t *testing.T) {
	v := "2026-09-01"
	c := Cursor{V: 1, FP: "abc", SortValue: &v, CreatedAt: "2026-09-16T01:02:03.123456Z", ID: "01T"}
	s := EncodeCursor(c)
	if strings.ContainsAny(s, "+/=") {
		t.Fatalf("cursor %q is not base64url without padding", s)
	}
	back, err := DecodeCursor(s)
	if err != nil || back.FP != "abc" || *back.SortValue != v || back.ID != "01T" {
		t.Fatalf("round trip = %+v, %v", back, err)
	}
	for _, bad := range []string{"", "%%%", EncodeCursor(Cursor{V: 2, ID: "x", CreatedAt: c.CreatedAt}), EncodeCursor(Cursor{V: 1})} {
		if _, err := DecodeCursor(bad); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("DecodeCursor(%q) err = %v, want ErrInvalidCursor", bad, err)
		}
	}
}

func TestFingerprintIgnoresFilterOrderAndDuplicates(t *testing.T) {
	a := Query{WorkspaceID: "w", Filter: Filter{Statuses: []string{"todo", "done"}}, Search: "x"}.Normalize()
	b := Query{WorkspaceID: "w", Filter: Filter{Statuses: []string{"done", "todo", "todo"}}, Search: "x"}.Normalize()
	if Fingerprint(a) != Fingerprint(b) {
		t.Fatal("equal queries must share a fingerprint")
	}
	c := b
	c.Sort = Sort{Field: "title"}
	if Fingerprint(c) == Fingerprint(b) {
		t.Fatal("sort must change the fingerprint")
	}
}
```
- [ ] **Step 2:** `cd server && go test ./pkg/db/tablequery/` → FAIL (package/types missing).
- [ ] **Step 3: Implement.** Rules:
  - `EncodeGroupKey`: formats per spec §3.1; property value `base64.RawURLEncoding`.
  - `DecodeGroupKey`: prefix must equal `g.Kind`; status/priority value non-empty and matches `^[a-z0-9_]{1,32}$`; assignee actor kind ∈ {human, agent}; property id must equal `g.Property.ID`; returns `ErrInvalidGroupKey` (wrap with `fmt.Errorf("%w: …")`).
  - `DecodeCursor`: base64url → JSON (`DisallowUnknownFields`), require `V==1`, `ID!=""`, `CreatedAt` parses RFC3339Nano, else `ErrInvalidCursor`.
  - `Normalize`: `sort.Strings` + dedupe each filter slice, nil → empty; `strings.TrimSpace(Search)`; `Sort.Field==""` → position; position → `Desc=false`; property of type multi_select/checkbox or nil Property → `Sort{Field:"position"}`.
  - `Fingerprint`: `json.Marshal` of a struct with fixed field order `{workspace, filter, search, sort{field,desc,property_id}, group{kind,property_id}, hierarchy}` → `sha256` → `hex` (full).
- [ ] **Step 4:** `go test ./pkg/db/tablequery/` → PASS.
- [ ] **Step 5: Commit** `feat(tasks): tablequery types, group keys and cursors for the table API`.

### Task 2: `tablequery` — SQL builder + executor

**Files:**
- Create: `server/pkg/db/tablequery/build.go`, `exec.go`
- Test: `server/pkg/db/tablequery/build_test.go`

**Interfaces — Consumes:** Task 1. **Produces:**
```go
type RowsRequest struct {
	Query    Query            // normalized
	Group    *GroupPredicate  // nil when Group.Kind == none
	ParentID *string          // only with Query.Hierarchy
	After    *Cursor
	Limit    int              // server fetches Limit+1
}

type Row struct {
	Task             db.Task // generated type, same columns as ListTableTaskRows
	DirectChildCount int64
	SortValue        *string
	SortNull         bool
}

type GroupCount struct {
	Predicate GroupPredicate
	Count     int64
	Label     string // project title / member or agent name / option name; "" for status & priority
}

func BuildRows(r RowsRequest) (string, []any)
func BuildCountBranch(r RowsRequest) (string, []any)   // same membership + root/child rule, no cursor/limit
func BuildCountQuery(q Query) (string, []any)          // filter + search only
func BuildGroups(q Query) (string, []any)              // counts per bucket, ordered per spec §3.4
func BuildFacet(q Query, kind string) (string, []any)  // kind: status|priority|assignee|project; filter minus own dimension

func Rows(ctx context.Context, tx pgx.Tx, r RowsRequest) ([]Row, error)
func Count(ctx context.Context, tx pgx.Tx, sql string, args []any) (int64, error)
func Groups(ctx context.Context, tx pgx.Tx, q Query) ([]GroupCount, error)
func Facet(ctx context.Context, tx pgx.Tx, q Query, kind string) ([]GroupCount, error)
```

**SQL rules (implement exactly):**
- Arg builder: `type args struct{ list []any }; func (a *args) add(v any) string { a.list = append(a.list, v); return fmt.Sprintf("$%d", len(a.list)) }`. `$1` = organization id, `$2` = workspace id, always first.
- Base membership `m(alias)` for alias `t`:
  ```sql
  t.organization_id = $1 AND t.workspace_id = $2
  AND ($has_status = false OR t.status = ANY($statuses::text[]))   -- emit only when slice non-empty: `t.status = ANY($n::text[])`
  ... priorities, assignee_ids (t.assignee_id), project_ids (t.project_id)
  ```
  Emit a filter clause only when its slice is non-empty (no boolean flags needed).
- Search (non-empty): words = `strings.Fields(lower(search))`, each `LOWER(t.title) LIKE $n ESCAPE '\'` with value `%` + escape(word) + `%` (escape `\`, `%`, `_`); joined with AND, wrapped: `((w1 AND w2) OR t.number = $k)` where the number clause is present only if the whole search matches `^(?:[A-Za-z]+-)?(\d{1,9})$`.
- Group predicate:
  - status → `t.status = $n`; priority → `t.priority = $n`
  - assignee none → `t.assignee_id IS NULL`; value → `t.assignee_id = $n AND t.assignee_kind = $k`
  - project none → `t.project_id IS NULL`; value → `t.project_id = $n`
  - property select none → `NULLIF(t.properties->>$pid,'') IS NULL`; value → `t.properties->>$pid = $v`
  - property checkbox none → `(t.properties->$pid) IS NULL OR jsonb_typeof(t.properties->$pid) <> 'boolean'`; value → `(t.properties->$pid) = to_jsonb($v::boolean)`
- Membership for a correlated alias (parent `p`, child `c`): same function with alias parameter — reuse exact clauses with a different alias; args are shared (re-add values; duplicates are fine).
- Hierarchy root (`Hierarchy && ParentID == nil`): `AND (t.parent_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks p WHERE p.organization_id = $1 AND p.workspace_id = $2 AND p.id = t.parent_task_id AND <m(p)>))`.
- Hierarchy child: `AND t.parent_task_id = $pid AND EXISTS (SELECT 1 FROM tasks p WHERE p.organization_id = $1 AND p.workspace_id = $2 AND p.id = $pid AND <m(p)>)`.
- `direct_child_count`: `(SELECT count(*) FROM tasks c WHERE c.organization_id = $1 AND c.workspace_id = $2 AND c.parent_task_id = t.id AND <m(c)>)::bigint`.
- Sort expression + cast for cursor comparison:

  | field | expr | cast | nullable |
  | --- | --- | --- | --- |
  | position | `t.position` | `::float8` | no |
  | title | `LOWER(t.title)` | `::text` | no |
  | created_at / updated_at | `t.created_at` | `::timestamptz` | no |
  | start_date / due_date | `t.start_date` | `::date` | yes |
  | status | `COALESCE((SELECT s.position FROM task_statuses s WHERE s.organization_id = $1 AND s.workspace_id = $2 AND s.key = t.status AND s.archived_at IS NULL), 1e9)` | `::float8` | no |
  | priority | `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END` | `::int` | no |
  | property number | `NULLIF(t.properties->>$pid,'')::numeric` | `::numeric` | yes |
  | property date/text/url | `NULLIF(t.properties->>$pid,'')` | `::text` | yes |
  | property select | `array_position($opts::text[], t.properties->>$pid)` | `::int` | yes |

  `sort_value` is selected as `(<expr>)::text AS sort_value` and `(<expr>) IS NULL AS sort_null`.
- ORDER BY: non-nullable: `<expr> <dir>, t.created_at DESC, t.id DESC`. Nullable: `(<expr>) IS NULL ASC, <expr> <dir>, t.created_at DESC, t.id DESC` (NULLS LAST both directions).
- Keyset (`After != nil`), with `v = $n<cast>`, `ca = $m::timestamptz`, `id = $k`:
  - tail `T` = `(t.created_at < ca OR (t.created_at = ca AND t.id < id))`
  - non-nullable asc: `(<expr> > v OR (<expr> = v AND T))`; desc: swap `>` for `<`.
  - nullable, cursor not null: `((<expr>) IS NULL OR <expr> > v OR (<expr> = v AND T))` (desc: `<`).
  - nullable, cursor null: `((<expr>) IS NULL AND T)`.
- `LIMIT $n` with `Limit+1`.
- Groups SELECT: `SELECT <bucket cols>, count(*) FROM tasks t WHERE <m(t) without group> GROUP BY … ORDER BY …`:
  - status: key `t.status`, order by the status sort expr then key.
  - priority: order by priority rank.
  - assignee: `t.assignee_id, t.assignee_kind`, label `COALESCE(u.display_name, u.email, a.name, '')` via `LEFT JOIN users u ON t.assignee_kind='human' AND u.id=t.assignee_id LEFT JOIN agents a ON t.assignee_kind='agent' AND a.id=t.assignee_id AND a.organization_id=$1`; order `t.assignee_id IS NULL, LOWER(label), t.assignee_id`. (Verify table/column names of users/agents with `\d users` `\d agents` before writing.)
  - project: `LEFT JOIN projects pj ON pj.organization_id=$1 AND pj.workspace_id=$2 AND pj.id=t.project_id`; label `COALESCE(pj.title,'')`; order `t.project_id IS NULL, LOWER(label)`.
  - property select: key `NULLIF(t.properties->>$pid,'')`, order `array_position($opts, key) NULLS LAST`; checkbox: key `CASE WHEN jsonb_typeof(t.properties->$pid)='boolean' THEN t.properties->>$pid END`, order `key DESC NULLS LAST`.
- `Rows` scans the same column list as `ListTableTaskRows` (copy the select list from `server/pkg/db/queries/tasks.sql:308-313`) plus `direct_child_count, sort_value, sort_null` into `db.Task` fields.

- [ ] **Step 1: Write failing tests** (`build_test.go`, pure string/args checks):
```go
func baseQuery() Query {
	return Query{OrganizationID: "o", WorkspaceID: "w"}.Normalize()
}

func TestEverySQLStartsWithTenant(t *testing.T) {
	prop := &PropertyRef{ID: "p1", Type: "select", Options: []string{"a", "b"}}
	q := baseQuery()
	q.Search = `50%_off\ WST-12`
	q.Filter.Statuses = []string{"todo"}
	q.Sort = Sort{Field: "property", Property: prop}
	q.Group = Group{Kind: "property", Property: prop}
	q.Hierarchy = true
	pid := "01PARENT"
	gp := GroupPredicate{Kind: "property", Value: "a"}
	after := &Cursor{V: 1, ID: "01T", CreatedAt: "2026-09-16T00:00:00Z"}
	builders := map[string]func() (string, []any){
		"rows":   func() (string, []any) { return BuildRows(RowsRequest{Query: q, Group: &gp, ParentID: &pid, After: after, Limit: 50}) },
		"count":  func() (string, []any) { return BuildCountBranch(RowsRequest{Query: q, Group: &gp}) },
		"query":  func() (string, []any) { return BuildCountQuery(q) },
		"groups": func() (string, []any) { return BuildGroups(q) },
		"facet":  func() (string, []any) { return BuildFacet(q, "project") },
	}
	for name, build := range builders {
		sql, args := build()
		if !strings.Contains(sql, "t.organization_id = $1 AND t.workspace_id = $2") {
			t.Errorf("%s: missing tenant clause: %s", name, sql)
		}
		if len(args) < 2 || args[0] != "o" || args[1] != "w" {
			t.Errorf("%s: args[0:2] = %v", name, args)
		}
		for _, needle := range []string{"50%", "WST", "01PARENT", "p1", "off"} {
			if strings.Contains(sql, needle) {
				t.Errorf("%s: user value %q leaked into SQL", name, needle)
			}
		}
		if strings.Count(sql, "tasks p ") > 0 && !strings.Contains(sql, "p.organization_id = $1 AND p.workspace_id = $2") {
			t.Errorf("%s: correlated parent lookup without tenant clause", name)
		}
	}
}

func TestRowsOrderAndKeysetShape(t *testing.T) {
	q := baseQuery()
	q.Sort = Sort{Field: "due_date", Desc: true}
	sql, _ := BuildRows(RowsRequest{Query: q, After: &Cursor{V: 1, SortNull: true, ID: "x", CreatedAt: "2026-09-16T00:00:00Z"}, Limit: 50})
	if !strings.Contains(sql, "(t.due_date) IS NULL ASC, t.due_date DESC, t.created_at DESC, t.id DESC") {
		t.Fatalf("order by: %s", sql)
	}
	if !strings.Contains(sql, "((t.due_date) IS NULL AND (t.created_at <") {
		t.Fatalf("null cursor keyset: %s", sql)
	}
	if !strings.Contains(sql, "LIMIT $") {
		t.Fatal("missing limit")
	}
}

func TestSearchEscapesLikeWildcards(t *testing.T) {
	q := baseQuery()
	q.Search = `a%b_c\d`
	_, args := BuildCountQuery(q)
	found := false
	for _, a := range args {
		if s, ok := a.(string); ok && s == `%a\%b\_c\\d%` {
			found = true
		}
	}
	if !found {
		t.Fatalf("escaped pattern missing from args: %v", args)
	}
}
```
- [ ] **Step 2:** `go test ./pkg/db/tablequery/` → FAIL.
- [ ] **Step 3:** Implement `build.go` per rules above (one `builder` struct holding `args`; functions `membership(alias string, q Query, g *GroupPredicate) string`, `sortExpr(q Query) (expr, cast string, nullable bool)`, `keyset(...)`). Implement `exec.go` (`tx.Query`, `pgx.CollectRows` with manual `Scan` into `db.Task` fields in the column order).
- [ ] **Step 4:** `go test ./pkg/db/tablequery/` → PASS; `go vet ./pkg/db/...`.
- [ ] **Step 5: Commit** `feat(tasks): tablequery SQL builder for table rows, groups and facets`.

### Task 3: Service `TableGroups/TableRows/TableFacets` trên tablequery + nhãn theo lô

**Files:**
- Modify: `server/pkg/db/queries/task_labels.sql` (+ `make sqlc`)
- Rewrite: `server/internal/service/task_table.go` (split `task_table_input.go` for input normalization if > 500 lines)
- Rewrite: `server/internal/service/task_table_test.go`

**Interfaces — Consumes:** Task 1–2. **Produces (service API used by handler):**
```go
type TableQueryInput struct {
	Filter    tablequery.Filter
	Search    string
	SortField string // "position"… or "property:<id>"
	SortDir   string // "asc"|"desc"
	GroupBy   string // "none"|"status"|"priority"|"assignee"|"project"|"property:<id>"
	Hierarchy bool
}
type TableRowsInput struct {
	TableQueryInput
	GroupKey *string
	ParentID *string
	Cursor   *string
	Limit    int32
}
type TableFacetsInput struct {
	TableQueryInput
	Facets []string
}

type TableGroupValue struct {
	Kind       string         `json:"kind"`
	Status     string         `json:"status,omitempty"`
	Priority   string         `json:"priority,omitempty"`
	Actor      *TableActorRef `json:"actor,omitempty"`   // {type: human|agent, id}
	ProjectID  string         `json:"project_id,omitempty"`
	PropertyID string         `json:"property_id,omitempty"`
	Option     string         `json:"option,omitempty"`  // select option id or "true"/"false"
	Label      string         `json:"label,omitempty"`
}
type TableGroupDescriptor struct{ Key string; Value TableGroupValue; Count int64 }
type TableGroupsResult struct{ QueryFingerprint string; Total int64; Groups []TableGroupDescriptor }
type TableRowLabel struct{ ID, Name, Color string }
type TableRow struct{ Task db.Task; DirectChildCount int64; Labels []TableRowLabel }
type TableRowsResult struct{ QueryFingerprint string; GroupKey, ParentID *string; Total int64; Rows []TableRow; NextCursor *string }
type TableFacet struct{ Kind string; Values []TableFacetValue } // Values: {Key, Count}
type TableFacetsResult struct{ QueryFingerprint string; Total int64; Facets []TableFacet }

func (s *TaskService) TableGroups(ctx context.Context, actor Actor, workspaceID string, in TableQueryInput) (TableGroupsResult, error)
func (s *TaskService) TableRows(ctx context.Context, actor Actor, workspaceID string, in TableRowsInput) (TableRowsResult, error)
func (s *TaskService) TableFacets(ctx context.Context, actor Actor, workspaceID string, in TableFacetsInput) (TableFacetsResult, error)
```
Errors (use existing `coded(status, code, msg)`): `invalid_group_by` 400, `unsupported_group` 422, `invalid_sort` 400, `invalid_group_key` 400, `group_key_required` 400 (group_by≠none and nil key; also non-nil key with none), `parent_requires_hierarchy` 400, `invalid_cursor` 400, `cursor_query_mismatch` 409, `invalid_facets_kind` 400.

Flow for `TableRows`: `requireActorMember` → workspace org id → resolve property refs via `GetTaskPropertyByID` (`archived_at` set or not found → group: 422; sort: fall back to position) with select options ordered by `LOWER(name)` from `config.options[] {id,name}` → `Normalize` → decode group key → decode cursor & compare `FP`, `GroupKey`, `ParentID` (mismatch 409) → `pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})` → `Rows` (limit+1) + `Count(BuildCountBranch)` → labels `ListLabelsForTasks(org, ws, ids)` → `NextCursor` from last kept row when `len == limit+1` → commit.

sqlc query:
```sql
-- name: ListLabelsForTasks :many
SELECT l.task_id, lb.id, lb.name, lb.color
FROM task_label_links l
JOIN task_labels lb ON lb.organization_id = l.organization_id AND lb.workspace_id = l.workspace_id AND lb.id = l.label_id
WHERE l.organization_id = $1 AND l.workspace_id = $2 AND l.task_id = ANY(sqlc.arg('task_ids')::text[])
  AND lb.archived_at IS NULL
ORDER BY l.task_id, LOWER(lb.name), lb.id;
```
(Check `task_label_links` has `organization_id`; if not — it is in `tenantBackfillDebt` — filter by `l.workspace_id` and `lb.organization_id = $1`.)

- [ ] **Step 1: Write failing service tests** (DB; reuse `taskFixture(t)` → `s, _, ua, _, w`). Helper:
```go
func mkTask(t *testing.T, s *TaskService, actor Actor, ws string, in CreateTaskInput) db.Task {
	t.Helper()
	task, err := s.Create(context.Background(), actor, ws, in)
	if err != nil { t.Fatal(err) }
	return task
}

func allRows(t *testing.T, s *TaskService, actor Actor, ws string, in TableRowsInput) []TableRow {
	t.Helper()
	var out []TableRow
	in.Limit = 2
	for i := 0; i < 50; i++ {
		res, err := s.TableRows(context.Background(), actor, ws, in)
		if err != nil { t.Fatal(err) }
		out = append(out, res.Rows...)
		if res.NextCursor == nil { return out }
		in.Cursor = res.NextCursor
	}
	t.Fatal("cursor never ended")
	return nil
}
```
Tests (each a `func Test…(t *testing.T)`):
1. `TestTableRowsSortsAcrossPages`: 7 tasks with titles `g,a,e,c,b,f,d`, due dates some nil; for each field in `title, created_at, due_date, priority, status, position` × `asc, desc`: `allRows` with limit 2 → ids unique, count 7, titles order matches the same sort done in Go (for due_date nil last in both directions).
2. `TestTableRowsSearch`: titles `Báo cáo tuần`, `Kế hoạch quý`, `báo giá`; search `"báo"` → 2 rows (Vietnamese lower works with `LOWER`); search `"WST-2"`-style using the task's `Number` → exactly that task; search `"50%"` with title `giảm 50% phí` and `giảm 500 phí` → only first.
3. `TestTableRowsHierarchy`: P (todo) with children C1 (todo), C2 (done); orphan-in-filter: filter statuses `[done]` → roots include C2 (parent P not in membership); unfiltered roots = P only with `DirectChildCount == 2`; `ParentID=P` → C1, C2; `ParentID` with `Hierarchy=false` → 400 `parent_requires_hierarchy`.
4. `TestTableGroupsByProjectPriorityProperty`: 2 projects (titles `Beta`, `Alpha`) + no-project; groups project order `Alpha, Beta, none`, labels set; rows with each key count matches; priority groups ordered urgent→none; select property with options `Zeta`,`Anh` → groups ordered `Anh, Zeta, none`; text property group → 422 `unsupported_group`.
5. `TestTableRowsCursorErrors`: cursor from sort title reused with sort created_at → 409; `"garbage"` → 400 `invalid_cursor`; cursor from group `status:todo` used with `status:done` → 409.
6. `TestTableRowsTotalIsBranchTotal`: 5 todo + 2 done, group status `todo`, limit 2 → every page `Total == 5`.
7. `TestTableRowsCarryLabels`: attach 2 labels to one task → row `Labels` has both, ordered by name; other rows `[]` (non-nil).
8. `TestTableIsolatesOrganizations`: second fixture org with same titles → rows/groups/facets of workspace A never contain B's ids (use a second `taskFixture(t)`).
9. Keep the existing fixture-counts test, rewritten to the new input types (groups keys now `status:todo`).
- [ ] **Step 2:** `make test-go` scope: `cd server && go test ./internal/service/ -run 'TestTable' -count=1` → FAIL (compile).
- [ ] **Step 3:** Implement service per flow; delete old `countTableGroups`, `countUnassigned`, `tableFilterParams`, `tableRowToTask` and sqlc queries `ListTableTaskRows`, `CountTableTasks*` if nothing else uses them (`grep -rn` first; `make sqlc`).
- [ ] **Step 4:** Tests PASS; `go vet ./... && go tool staticcheck ./...`.
- [ ] **Step 5: Commit** `feat(tasks): table service on tablequery with cursor, sort, search and hierarchy`.

### Task 4: Handler, SDI/SDO, OpenAPI, arch test, CLAUDE.md

**Files:** `server/internal/handler/dto/sdi/task.go`, `dto/sdo/task.go`, `handler/task_table.go`, `handler/task_table_test.go`, `handler/router/tasks.go`, `server/internal/arch_test.go`, `CLAUDE.md`

**Interfaces — Produces (wire contract, spec §3):**
```go
type TableQuerySDI struct {
	Filter TableFilterSDI `json:"filter" description:"Bộ lọc chung"`
	Search string         `json:"search" description:"Tìm theo tiêu đề (mọi từ) hoặc số hiệu" example:"báo cáo"`
	Sort   TableSortSDI   `json:"sort"`
}
type TableSortSDI struct {
	Field     string `json:"field" description:"position, title, created_at, updated_at, start_date, due_date, status, priority hoặc property:<id>" example:"due_date"`
	Direction string `json:"direction" description:"asc hoặc desc" example:"asc"`
}
type TableGroupsSDI struct {
	Query   TableQuerySDI `json:"query"`
	GroupBy string        `json:"group_by" description:"none, status, priority, assignee, project hoặc property:<id>" example:"status"`
}
type TableRowsSDI struct {
	Query     TableQuerySDI `json:"query"`
	GroupBy   string        `json:"group_by" example:"status"`
	GroupKey  *string       `json:"group_key" description:"Key nhóm nguyên văn từ /table/groups; null khi group_by=none" example:"status:todo"`
	Hierarchy bool          `json:"hierarchy" description:"Bật cây việc con" example:"true"`
	ParentID  *string       `json:"parent_id" description:"Tải con của việc này; cần hierarchy=true" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Cursor    *string       `json:"cursor" description:"next_cursor của trang trước" example:"eyJ2IjoxfQ"`
	Limit     int32         `json:"limit" description:"1–100, mặc định 50" example:"50"`
}
type TableFacetsSDI struct {
	Query  TableQuerySDI `json:"query"`
	Facets []string      `json:"facets" description:"status, priority, assignee, project" example:"[\"status\"]"`
}
```
SDO: `TableGroupValueDTO` gains `ProjectID, PropertyID, Option, Label` (`omitempty`); `TableRowDTO` gains `Labels []TableRowLabelDTO \`json:"labels"\`` (`{id,name,color}`); `TableRowsSDO` drops `branch_total`, keeps `next_cursor *string`; `TableGroupsSDO.NextCursor` always null.

- [ ] **Step 1: Failing tests** in `handler/task_table_test.go` (rewrite existing): fixture counts with new body `{"query":{},"group_by":"status"}` and `group_key "status:todo"`; `{"cursor":"%%"}` → 400 `invalid_cursor`; reuse cursor with different sort → 409 `cursor_query_mismatch`; `group_by "property:<text prop>"` → 422 `unsupported_group`; rows response has `labels` array and no `branch_total`. Arch test:
```go
func TestTableQueryOnlyFromTaskTableService(t *testing.T) {
	// ADR 0020: dynamic table SQL is one package, reached from one place.
	root := ".."
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") {
			return err
		}
		slash := filepath.ToSlash(p)
		if strings.Contains(slash, "pkg/db/tablequery/") || strings.HasSuffix(slash, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if strings.Contains(string(src), `"`+module+`pkg/db/tablequery"`) &&
			!regexp.MustCompile(`internal/service/task_table[a-z_]*\.go$`).MatchString(slash) {
			t.Errorf("%s imports pkg/db/tablequery; only internal/service/task_table*.go may (ADR 0020)", slash)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
```
- [ ] **Step 2:** `go test ./internal/handler/ -run TestTable -count=1 && go test ./internal/ -run TestTableQuery` → FAIL.
- [ ] **Step 3:** Implement: handler maps SDI → service input (`GroupBy` empty → `none`); `mapServiceError` already maps coded errors. Update apiOp descriptions in `router/tasks.go`. Add to CLAUDE.md § Database and Migration Rules:
  `- Table-view SQL is built only in server/pkg/db/tablequery (ADR 0020): values are always $n parameters, every statement starts with the organization/workspace clause, and only internal/service/task_table*.go imports it — TestTableQueryOnlyFromTaskTableService and the builder tests in that package hold it.` (wrap to match file style).
- [ ] **Step 4:** `make test-go` → PASS (note known flake `TestAIEndpoints`, memory: clock skew; rerun with `-skip TestAIEndpoints` if only that fails).
- [ ] **Step 5: Commit** `feat(tasks): table API request/response on cursor, sort, search, hierarchy`.

### Task 5: Core client — endpoints, builders, errors

**Files:** `packages/core/api/endpoints/tasks-table.ts` (+ `.test.ts`), `packages/core/tasks/surface/table-query.ts` (+ `table-query.test.ts`), `packages/core/tasks/hooks.ts`, `packages/core/tasks/hooks-suite.ts`

**Interfaces — Produces:**
```ts
export interface TableFilter { statuses?: string[]; priorities?: string[]; assignee_ids?: string[]; project_ids?: string[] }
export interface TableSort { field: string; direction: "asc" | "desc" }
export interface TableQuery { filter?: TableFilter; search?: string; sort?: TableSort }
export interface TableGroupsBody { query: TableQuery; group_by: string }
export interface TableRowsBody {
  query: TableQuery; group_by: string; group_key: string | null;
  hierarchy: boolean; parent_id: string | null; cursor: string | null; limit: number;
}
export interface TableFacetsBody { query: TableQuery; facets: string[] }
export type TableGroupValue = { kind: string; status?: string; priority?: string; actor?: { type: string; id: string }; project_id?: string; property_id?: string; option?: string; label?: string };
export type TableRowLabel = { id: string; name: string; color: string };
export type TableRowsResult = { query_fingerprint: string; group_key: string | null; parent_id: string | null; total: number; rows: Array<{ task: Task; direct_child_count: number; labels: TableRowLabel[] }>; next_cursor: string | null };
// tableGroups / tableRows / tableFacets keep their names and signatures (workspaceId, body)

// table-query.ts
export interface TableQueryParams { query: TableQuery; groupBy: string; hierarchy: boolean }
export function tableGroupsBody(p: { query: TableQuery; groupBy: string }): TableGroupsBody
export function tableRowsPageBody(p: TableQueryParams & { groupKey: string | null; parentId: string | null; cursor: string | null; limit: number }): TableRowsBody
export function tableRowsPageQuery(workspaceId: string, body: TableRowsBody): { queryKey: readonly unknown[]; queryFn: () => Promise<TableRowsResult> }
export function tableRowsBranchPrefix(workspaceId: string, body: TableRowsBody): readonly unknown[] // key prefix for all pages of one branch (body without cursor)
export function normalizeTableQuery(q: TableQuery): TableQuery // drops empty filter arrays, trims search, omits sort when position/asc — stable field order
```
Cache key: `taskKeys.tableRows(workspaceId, JSON.stringify(bodyWithoutCursor), cursor ?? "")` — add an optional trailing segment to `taskKeys.tableRows` so `tableRowsBranchPrefix` = first three segments. Update `realtime-task-patch.ts` only if it slices by length (it uses `.slice(0, -1)` of `tableRows(wsId, "")` → keep it working: verify with its test).
Row schema: `labels: z.array(TableRowLabelSchema).catch([])` so an old server degrades.

- [ ] **Step 1: Failing tests**: endpoint malformed cases (non-object, rows not array, `labels` missing → `[]`, `next_cursor` missing → null) in `tasks-table.test.ts`; `table-query.test.ts`: same params in different filter array order → same body string; `tableRowsBranchPrefix` is a prefix of every page key of that branch and not of another branch's key.
- [ ] **Step 2:** `pnpm --filter @uniwork/core exec vitest run api/endpoints/tasks-table tasks/surface/table-query` → FAIL.
- [ ] **Step 3:** Implement; fix `hooks.ts` usages (`tableRowsPageBody` params) and `hooks-suite.ts` (`useTableRows`, `useTableGroups`, `useTableFacets` bodies).
- [ ] **Step 4:** Tests PASS; `pnpm --filter @uniwork/core typecheck`.
- [ ] **Step 5: Commit** `feat(tasks): core table client on the cursor contract`.

### Task 6: `useCursorBranches` — phân trang cursor dùng chung

**Files:** Create `packages/views/tasks/surface/use-cursor-branches.ts`, test `use-cursor-branches.test.tsx`

**Interfaces — Produces:**
```ts
export interface CursorBranchSpec { key: string; body: TableRowsBody /* cursor ignored */; enabled: boolean }
export interface CursorBranchState {
  key: string;
  rows: TableRowsResult["rows"];       // pages concatenated, first copy of an id wins
  total: number;                        // first page total (largest seen)
  isLoading: boolean;                   // first page pending, no data
  isFetchingMore: boolean;
  isError: boolean;                     // last page failed with no data
  hasMore: boolean;                     // last page has next_cursor
  loadMore: () => void;                 // no-op while fetching; retries when errored
  retry: () => void;                    // refetch the failed page
}
export function useCursorBranches(workspaceId: string, branches: CursorBranchSpec[]): {
  byKey: ReadonlyMap<string, CursorBranchState>;
  isRefreshing: boolean;
};
```
Behaviour:
- State `cursorsByBranch: Record<branchKey + "|" + identity, (string|null)[]>` where `identity = JSON.stringify(body without cursor)`; a branch whose identity changed reads as `[null]` (no reset effect, same pattern as board `paging.identity`).
- Queries: flatten `branches × cursors` into `useQueries({ queries, combine })`; `combine` is a module-level function returning `{ data, isLoading, isError, isFetching, dataUpdatedAt, refetch }` per page (stable identity rule).
- Stale tail: keep a ref `firstPageUpdatedAt[branchIdentity]`; when page 0's `dataUpdatedAt` changes after more pages exist, set cursors back to `[null]` (in a `useEffect`, guarded so it runs once per change).
- `loadMore`: append `lastPage.data.next_cursor` if not already present.
- 409 on a non-first page (`ApiError` with `code === "cursor_query_mismatch"`): reset that branch to `[null]` once.

- [ ] **Step 1: Failing tests** with a fake server (copy `serveBoardTable` style into `packages/views/test/table-cursor-server.ts`: rows per `group_key` + `parent_id`, `limit`, `cursor` = base64 of offset string for the fake only):
  1. loads first page; `loadMore` fetches page 2 with `cursor` = page 1 `next_cursor`; rows 1..N unique; `hasMore` false at end.
  2. `result.current.byKey` identity stable across `rerender()` when nothing changed.
  3. changing `body.query.search` resets to one page (single request with `cursor:null`).
  4. first page refetch with changed data drops tail pages (invalidate query key prefix, expect cursors back to `[null]`).
  5. failed page → `isError`; `retry` refetches and clears.
- [ ] **Step 2:** `cd packages/views && npx vitest run tasks/surface/use-cursor-branches` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(tasks): shared cursor branch paging for table and board`.

### Task 7: Board trên `useCursorBranches`

**Files:** `packages/views/tasks/surface/use-board-columns-data.ts`, `use-board-columns-data.test.tsx`, `packages/views/test/board-table-server.ts`

- Board bodies: `query = normalizeTableQuery({ filter })`, `group_by: "status"`, `group_key: "status:<category>"`, `hierarchy: false`, `parent_id: null`, `limit: TABLE_PAGE_SIZE`. Groups keys are now `status:<key>`: build `countByStatus` by stripping the `status:` prefix from `group.value.status`.
- Replace page-index state + `useQueries` with `useCursorBranches`; `BoardColumnState` fields map: `tasks = rows.map(r=>r.task)`, `count = max(groupCount, total, tasks.length)`, `hasMore`, `isLoadingMore = isFetchingMore`, `isError`, `loadMore`.
- Delete `pickPageStates`/`PageState` export (table uses the new hook too after Task 8 — do Task 8 in the same PR before running the full suite).
- [ ] **Step 1:** Update `board-table-server.ts` to the new contract (read `body.group_key` `status:x`, `body.cursor` as opaque offset token `btoa(String(offset))`, return `next_cursor` when more). Update test expectations that read `rowRequests()` to `status:todo@<cursor>` form. Run `npx vitest run tasks/surface/use-board-columns-data tasks/surface/task-surface-board` → FAIL.
- [ ] **Step 2:** Implement; PASS.
- [ ] **Step 3: Commit** `refactor(tasks): board columns page through table cursors`.

### Task 8: Bảng trên API mới (tính năng hiện có, sort/search server)

**Files:** `packages/views/tasks/modes/use-table-view-data.ts` (+ test), create `packages/views/tasks/modes/use-debounced-value.ts`, `table-view.tsx`, `table-view-model.ts`, `table-view-render-loop.test.tsx`, `table-row-actions.test.tsx` (fake server contract)

- Body `query = normalizeTableQuery({ filter, search: debouncedSearch, sort: { field: sortBy, direction: sortDirection } })`.
- Grouping in this PR: none/status/assignee (server); `group_by` for none = `"none"`, branch key `__ungrouped` with `group_key: null`.
- `hierarchy: false` in PR2; client tree `buildTaskTableHierarchy` kept on loaded rows (PR3 replaces it).
- Delete `sortTasksForTable` and client search filter (+ their tests in `table-view-model.test.ts`).
- Load-more row: `total` from branch `total`; `state` from `isFetchingMore/isError/hasMore`; `onLoad` = `loadMore` or `retry`.
- `useDebouncedValue<T>(value: T, delayMs: number): T` — setTimeout in effect, cleared on change.
- [ ] **Step 1: Failing tests** (`use-table-view-data.test.tsx`): sort change sends `query.sort` and resets to first page; search "abc" sends after 300 ms (fake timers) and not before; ungrouped body `group_by:"none", group_key:null`; render-loop test still passes.
- [ ] **Step 2:** FAIL → implement → PASS: `cd packages/views && npx vitest run tasks`.
- [ ] **Step 3: Commit** `feat(tasks): table view sorts and searches on the server`.

### Task 9: Cổng PR2

- [ ] `make check` (GATE_LEVEL from repo; if `fast`, also run `make check-full` once or at least `make e2e` with app restarted: `make stop && make start`, kill stale 8090).
- [ ] Manual smoke with the temporary Playwright script pattern (memory: `e2e/zz-*.spec.ts`, delete after): 120 tasks, board → table, sort by title, load more, search a task on page 3.
- [ ] Push + PR: `make issue-pr KEY=UNI-654` (title `UNI-654: …`), PR body lists PR1 fix + spec/ADR + API change; comment evidence on issue `make issue-note`.

---

# PR3 — Tính năng view Bảng (spec §5)

Branch: continue on the same issue branch after PR2 merge (`git pull origin develop` / rebase), or stack a new branch `feature/UNI-654-table-features` from PR2 head if PR2 is still in review.

### Task 10: `start_date` sửa được qua PATCH

**Files:** `server/pkg/db/queries/tasks.sql` (`SetTaskStartDate`), `server/internal/service/task.go` (`UpdateTaskInput.StartDate **string`, apply like `DueDate`), `server/internal/handler/dto/sdi/task.go` (`PatchTaskSDI.StartDate`), handler PATCH mapping (same null-vs-absent handling as `due_date`), tests in `server/internal/service/task_test.go` + handler PATCH test; `packages/core/api/endpoints/tasks.ts` `TaskPatch.start_date?: string | null`; `use-task-surface-controller.ts` `taskPatchFromSurfaceUpdates` accepts `start_date`.
- [ ] Failing Go test: PATCH `start_date:"2026-09-20"` → task start_date set, revision +1, audit row written (`audit_coverage_test.go` unchanged: same `task.update` command); `null` clears; `"bad"` → 400.
- [ ] Failing TS test: `taskPatchFromSurfaceUpdates({start_date:"2026-09-20"})` keeps it (export the function for test only if a test already imports siblings; else test through `actions.updateTask` in `task-surface.test.tsx`).
- [ ] Implement, `make sqlc`, PASS, commit `feat(tasks): edit a task's start date through PATCH`.

### Task 11: Hook giá trị thuộc tính (optimistic)

**Files:** `packages/core/tasks/hooks-catalog.ts` (+ test `hooks-catalog.test.tsx` or existing)
```ts
export function useSetTaskPropertyValue(workspaceId: string): UseMutationResult<void, Error, { taskId: string; propertyId: string; value: unknown }>
export function useUnsetTaskPropertyValue(workspaceId: string): UseMutationResult<void, Error, { taskId: string; propertyId: string }>
```
- `onMutate`: cancel + snapshot `taskKeys.tableRoot(ws)` rows entries and `taskKeys.detail(taskId)`; set `task.properties[propertyId] = value` (unset: delete key) in every rows page containing the task and in detail. `onError`: restore snapshot. `onSettled`: invalidate `tableRoot` + `detail`.
- [ ] Failing test: seeded cache with a rows page → mutate → cache shows new value before the request resolves; request rejects → value restored.
- [ ] Implement (endpoints `putTaskPropertyValue`/`deleteTaskPropertyValue` exist — read their signatures first), PASS, commit `feat(tasks): optimistic hooks for task property values`.

### Task 12: `PropertyValueEditor` + hiển thị

**Files:** Create `packages/views/tasks/properties/property-value.ts` (pure: parse/format per type), `property-value-display.tsx`, `property-value-editor.tsx`, tests `property-value.test.ts`, `property-value-editor.test.tsx`
```ts
// property-value.ts
export type PropertyOption = { id: string; name: string; color?: string };
export function propertyOptions(property: TaskProperty): PropertyOption[];      // config.options, tolerant of junk
export function readPropertyValue(property: TaskProperty, raw: unknown): unknown; // typed or undefined when invalid
export function formatPropertyValue(property: TaskProperty, raw: unknown, locale: string): string; // "" when empty
// property-value-editor.tsx
export function PropertyValueEditor(props: {
  property: TaskProperty; value: unknown; disabled?: boolean; disabledReason?: string;
  onChange: (value: unknown) => void; onClear: () => void; ariaLabel: string;
  triggerClassName?: string; onTriggerNavigationGuard?: (e: React.SyntheticEvent) => void;
}): JSX.Element
```
Per type: `text`/`url` — trigger shows value; click → inline `Input` (Enter/blur commits trimmed, Escape cancels; url validated with `URL` and `http(s)` scheme, invalid shows `aria-invalid` + message `tasks.properties.invalid_url`); `number` — `Input type="text" inputMode="decimal"`, accepts `,` as decimal separator, commits `Number`; `select` — `DropdownMenu` radio list with color dot + "Xóa giá trị"; `multi_select` — checkbox items, commits array of ids; `date` — `DateField` (from `../../common/date-field`), commits `YYYY-MM-DD`; `checkbox` — `Checkbox` toggles immediately. Archived property → display only + clear action.
- [ ] Failing tests: one `it` per type (render, change, assert `onChange` payload); url invalid does not call `onChange`; Escape cancels text edit; archived shows no editor.
- [ ] Implement; i18n keys `tasks.properties.{clear,invalid_url,invalid_number,empty}` in all locales; PASS; commit `feat(tasks): shared property value editor for seven property types`.

### Task 13: Bảng — việc con lười, nhóm mới, 422

**Files:** `use-table-view-data.ts` (split pure part into `table-branches.ts` + `table-branches.test.ts`), `table-view-model.ts`, `table-view-toolbar.tsx`, `table-view.tsx`, `packages/core/tasks/stores/view-store-types.ts` (`TableGrouping` + `"priority"`), `table-group-row.tsx`
```ts
// table-branches.ts (pure)
export function tableGroupByParam(grouping: TableGrouping): string; // none|status|priority|assignee|project|property:<id>
export function planBranches(input: {
  groupBy: string; groups: TableGroupsResult["groups"] | undefined;
  collapsedGroups: ReadonlySet<string>; hierarchy: boolean;
  expandedParents: ReadonlyArray<{ groupKey: string | null; parentId: string }>;
  baseBody: Omit<TableRowsBody, "group_key" | "parent_id" | "cursor">;
}): CursorBranchSpec[];                  // key `${groupKey ?? "__ungrouped"}::${parentId ?? "root"}`
export function buildDisplayRows(input: {
  groupBy: string; groups: TableGroupsResult["groups"] | undefined;
  branches: ReadonlyMap<string, CursorBranchState>;
  collapsedGroups: ReadonlySet<string>; collapsedParents: ReadonlySet<string>;
  groupLabel: (group: TableGroupsResult["groups"][number]) => string;
}): TaskTableDisplayRow[];
```
- Hierarchy (`showSubTasks=true`): root branch per group; a task row with `direct_child_count>0` has `hasChildren`; parents are **collapsed by default** — store holds expanded ids instead: rename semantics of `tableCollapsedParents` → keep the field, treat membership as "expanded" (`toggleTableParentCollapsed` flips) and migrate persisted state by clearing it (bump store `version` + `migrate` returning `tableCollapsedParents: []`). Expanded parent → child branch; its rows at `depth+1` directly after the parent, then its own load-more/error row at that depth. A task id rendered once (skip duplicates).
- `showSubTasks=false`: `hierarchy:false`, flat.
- Grouping menu options: none, status, priority, assignee, project, then `useTaskProperties` non-archived `select`/`checkbox` as `property:<id>` with the property name. Remove forced `projectGroupingDisabled` (`table-view.tsx:291`, `:84`).
- Group labels: status/priority translated; assignee `value.label || t("tasks.unassigned")`; project `value.label || t("tasks.table.no_project")`; property option name from catalog, `t("tasks.table.no_value")` for none, checkbox `t("tasks.table.checked")`/`t("tasks.table.unchecked")`.
- Groups request error with `code === "unsupported_group"` → `setTableGrouping("none")` + `toast.info(t("tasks.table.grouping_reset"))` once.
- [ ] Failing tests: `table-branches.test.ts` (plan: collapsed group → no branch; expanded parent → child branch key; display rows order parent→children→child load-more; duplicate id once); view test: expand parent requests `parent_id`; group by project renders labels; 422 resets to none.
- [ ] Implement; PASS; commit `feat(tasks): table subtasks load per parent; group by priority, project and property`.

### Task 14: Cột — thuộc tính, dự án, ngày bắt đầu, agent, menu sort

**Files:** `table-view-columns.tsx` (split `table-task-cell.tsx` if > 500 lines), `table-cell-editors.tsx`, create `table-header-sort-menu.tsx`, `table-column-picker.tsx`, `table-view.tsx`, `task-surface.tsx` (pass `propertiesDisabled={false}`; agents list)
- `columnKeys` no longer filters `property:` keys; `useTaskProperties` catalog in `viewMeta.properties: ReadonlyMap<string, TaskProperty>`; unknown property id → column header `t("tasks.table.unavailable_cell")`, cell `—`.
- Property cell: `PropertyValueEditor` with `useSetTaskPropertyValue`/`useUnsetTaskPropertyValue`; errors → `toastApiError`.
- Project cell: picker listing `projects` + "Không có dự án" → `updateTask(id, { project_id })`.
- Start date cell: `DateField` like due date → `updateTask(id, { start_date })`.
- Assignee cell: options = members (human) + `useWorkspaceAgents(workspaceId)` (agent), mirror `properties-sidebar.tsx:126-159`; `onChange(ref)` → `{ assignee_id: ref?.id ?? null, assignee_kind: ref?.kind ?? "human" }`. Remove the "table deliberately humans only" comment in the sidebar.
- `SORTABLE_COLUMNS` add `start_date`, `position` not a column; property columns sortable unless type multi_select/checkbox. Header renders `TableHeaderSortMenu` (Tăng dần / Giảm dần / Ẩn cột) — keep `HeaderLabel` layout.
- Column picker: properties section enabled, lists non-archived properties.
- [ ] Failing tests: property select cell edits call PUT value endpoint with option id; project cell sends `project_id`; start date sends `start_date`; assignee agent sends `assignee_kind:"agent"`; header "Giảm dần" on a property column sets `sortBy "property:<id>"` desc; picker toggles property column.
- [ ] Implement; PASS; commit `feat(tasks): table edits properties, project, start date and agent assignees`.

### Task 15: Kéo đổi thứ tự cột

**Files:** `packages/ui/components/ui/data-table.tsx` (+ `data-table-reorder.test.tsx`), `table-view.tsx`
```ts
// DataTableProps additions
reorderableColumnIds?: string[];                       // columns that can be dragged (visible order)
onColumnReorder?: (activeId: string, overId: string) => void;
reorderHandleLabel?: (columnId: string) => string;     // aria-label for the grip
```
- When `onColumnReorder` set: wrap header row in `DndContext` (`PointerSensor` distance 5, `KeyboardSensor` + `sortableKeyboardCoordinates`, `closestCenter`, modifier `restrictToHorizontalAxis` from `@dnd-kit/modifiers` — add to `packages/ui/package.json` via catalog if missing), `SortableContext` `horizontalListSortingStrategy`; each reorderable `<th>` uses `useSortable({ id })`, transform x only, grip button (`GripVertical` 14px, visible on hover/focus) with `aria-label`. Non-reorderable ids (`__select`, `title`, `__add`) render as today.
- `table-view.tsx`: `reorderableColumnIds = columnKeys.filter(k => k !== "title")`, `onColumnReorder = (a, o) => reorderTableColumn(a as TableColumnKey, o as TableColumnKey)`, label `t("tasks.table.reorder_column", { name })`.
- [ ] Failing test (ui): keyboard reorder — focus grip, Space, ArrowRight, Space → `onColumnReorder("a","b")`; title column has no grip.
- [ ] Implement; PASS (`cd packages/ui && npx vitest run components/ui/data-table`); commit `feat(ui): reorder data table columns by drag or keyboard`.

### Task 16: Lỗi, thử lại, rỗng khi tìm

**Files:** create `table-branch-error-row.tsx`, modify `table-load-more-row.tsx`, `table-view.tsx`, `use-table-view-data.ts`
- Branch error row (`kind: "load_more"`, `state:"error"`) shows `t("tasks.table.branch_error")` + button `t("tasks.table.load_more_retry")` calling `retry`.
- Groups error: `CollectionPageState`-style block inside the table area with retry button calling `groupsQuery.refetch()` (views may use `../../layout/collection-page`).
- Empty with search: message `t("tasks.table.empty_search", { query })` + button `t("tasks.table.search_clear")` → `setSearch("")`.
- Refreshing (query changed, previous data kept via `placeholderData: keepPreviousData` on page 0 of each branch): thin progress bar at top of table (`role="progressbar"` aria-label `t("tasks.table.refreshing")`).
- [ ] Failing tests: failed branch shows retry and refetch clears; groups failure shows retry; search with no result shows clear button that empties search.
- [ ] Implement; PASS; commit `feat(tasks): table branch and group errors retry in place`.

### Task 17: Cổng PR3 — `make check`, smoke, PR (`make issue-pr` or open PR with `gh pr create` title `UNI-654: table features`), issue note.

---

# PR4 — Giao diện, hiệu năng, e2e (spec §6–§7)

### Task 18: Nhãn từ rows, bỏ N+1

**Files:** `table-cell-editors.tsx` (`TableLabelsCell` props `attached: TableRowLabel[]`), `table-view-columns.tsx`, `TaskTableDisplayRow` task row gains `labels: TableRowLabel[]`, `pickers` `useTaskLabelToggle` (after success also invalidate `taskKeys.tableRoot(ws)`)
- [ ] Failing test: rendering 30 rows issues zero `/labels` requests (`requestMock` calls filter `path.endsWith("/labels")` length 0); toggling a label invalidates table root.
- [ ] Implement; PASS; commit `perf(tasks): table labels come with rows`.

### Task 19: Chọn dòng không render lại cả bảng

**Files:** `packages/views/tasks/surface/selection-context.tsx`, `table-view.tsx`, `table-view-columns.tsx`
```ts
export interface TaskSurfaceSelectionStore {
  subscribe(listener: () => void): () => void;
  isSelected(id: string): boolean;
  getSnapshot(): Set<string>;
}
export function useIsTaskSelected(id: string): boolean;               // useSyncExternalStore
export function useSelectionSummary(ids: readonly string[]): "none" | "some" | "all";
```
- Selection keeps `selectedIds` state for existing consumers (batch toolbar) and exposes a store backed by a ref + listeners notified in an effect after state changes.
- `viewMeta` drops `selectedIds`; `SelectCell` uses `useIsTaskSelected`; `SelectHeader` uses `useSelectionSummary(meta.visibleTaskIds)`.
- [ ] Failing test: `table-view-columns.tsx` exports `tableCellRenderCounter` (`{ count: number }`, incremented at the top of `TaskCellContent` only when `process.env.NODE_ENV === "test"`). Render the table with 50 rows, wait for settle, record the count, click one row checkbox, assert the counter did not increase and that checkbox is checked.
- [ ] Implement; PASS; commit `perf(tasks): selecting a table row re-renders only its checkbox`.

### Task 20: Giao diện bảng

**Files:** `packages/ui/components/ui/data-table.tsx` (cell/header border classes via props `gridLines?: "full" | "horizontal"`, default `"full"` to keep other tables), `table-view.tsx` (`gridLines="horizontal"`, `virtualRowHeight={40}`), `table-view-columns.tsx` (sizes: status 148, priority 128, assignee 176, due_date/start_date/created_at/updated_at 128, labels 180, project 168, identifier 96, property 160), `table-inline-title.tsx` (expand button `size-6` with `coarse:size-11` per touch contract, icon 14px, `aria-expanded`, `aria-label`), row class `h-10`, `table-view.tsx` scroll container `pb-16` when `selection.selectedIds.size > 0`.
- [ ] Failing tests: `table-inline-title.test.tsx` expand button has `aria-expanded` and toggles; data-table test `gridLines="horizontal"` cells have no `border-r` except pinned edge.
- [ ] Implement; verify both themes with the temporary screenshot spec (memory `uniwork-visual-verify-screenshots`); run `e2e/onboarding-contrast.spec.ts` unaffected; commit `style(tasks): lighter table grid, readable default widths, larger expand target`.

### Task 21: E2E `e2e/tasks-table.spec.ts`

**Files:** Create `e2e/tasks-seed.ts` (API seeding using the bearer captured from page requests, pattern proven in the PR1 investigation), `e2e/tasks-table.spec.ts`
```ts
export async function captureAuth(page: Page): Promise<{ auth: string; wsId: string }>;
export async function seedTasks(page: Page, a: { auth: string; wsId: string }, n: number, opts?: { withChildrenEvery?: number; projectIds?: string[] }): Promise<Array<{ id: string; title: string; number: number }>>;
export async function createProject(page: Page, a: { auth: string; wsId: string }, title: string): Promise<string>;
export async function createSelectProperty(page: Page, a: { auth: string; wsId: string }, name: string, options: string[]): Promise<{ id: string; optionIds: string[] }>;
```
Scenarios (one `test.describe.serial`, one registered user via `registerVerified` + onboarding steps from `tasks-collection-parity-smoke.spec.ts`):
1. Board → Bảng: after switch, `page.evaluate(() => 1)` resolves < 500 ms three times over 3 s; sidebar link "Dự án" navigates.
2. Sort by Tiêu đề tăng dần; click "Tải thêm"; collected titles in DOM order are sorted (`localeCompare('vi')`).
3. Search the title of task #110 → row visible, row count 1.
4. Child of a parent seeded on page 3 appears indented under its parent after expanding (`aria-expanded`).
5. Group by Dự án → group rows "Alpha", "Beta", "Không có dự án"; group by Ưu tiên → "Khẩn cấp" first.
6. Property column: enable via Cột → edit select → reload → value persists.
7. Reorder column by keyboard (grip focus, Space, ArrowRight, Space) → reload → order persists.
- [ ] Run `make e2e` twice (app restarted with current code); both green.
- [ ] Commit `test(tasks): end-to-end table view parity`.

### Task 22: Cổng PR4 + đóng

- [ ] `make check`; e2e twice; `uptime` before judging any flake.
- [ ] Update spec status line to `shipped` (after merge) and this plan's status; `make issue-pr KEY=UNI-654`; `make issue-note` with evidence (commands + results + screenshots path); after merge `make issue-done KEY=UNI-654`.
