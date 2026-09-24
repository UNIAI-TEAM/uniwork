package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/db/tablequery"
)

func mkTask(t *testing.T, s *TaskService, actor Actor, ws string, in CreateTaskInput) db.Task {
	t.Helper()
	task, err := s.Create(context.Background(), actor, ws, in)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func allRows(t *testing.T, s *TaskService, actor Actor, ws string, in TableRowsInput) []TableRow {
	t.Helper()
	var out []TableRow
	in.Limit = 2
	for i := 0; i < 50; i++ {
		res, err := s.TableRows(context.Background(), actor, ws, in)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, res.Rows...)
		if res.NextCursor == nil {
			return out
		}
		in.Cursor = res.NextCursor
	}
	t.Fatal("cursor never ended")
	return nil
}

func setTableStatus(t *testing.T, s *TaskService, actor Actor, taskID, status string) {
	t.Helper()
	st := status
	if _, err := s.Update(context.Background(), actor, taskID, UpdateTaskInput{Status: &st}); err != nil {
		t.Fatal(err)
	}
}

func rowIDs(rows []TableRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Task.ID
	}
	return out
}

func wantTableCode(t *testing.T, err error, status int, code string) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != code || ce.Status != status {
		t.Fatalf("err = %v, want %d %s", err, status, code)
	}
}

func b64url(v string) string { return base64.RawURLEncoding.EncodeToString([]byte(v)) }

// Fixture: 3 todo, 2 in_progress, 1 done — groups/rows/facets must match counts.
func TestTableGroupsRowsFacetsFixtureCounts(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	for _, sp := range []struct{ title, status string }{
		{"T1", "todo"}, {"T2", "todo"}, {"T3", "todo"},
		{"P1", "in_progress"}, {"P2", "in_progress"}, {"D1", "done"},
	} {
		task := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: sp.title})
		if sp.status != "todo" {
			setTableStatus(t, s, actor, task.ID, sp.status)
		}
	}

	groups, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: "status"})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 6 || groups.QueryFingerprint == "" {
		t.Fatalf("groups total=%d fp=%q, want 6 and non-empty", groups.Total, groups.QueryFingerprint)
	}
	byKey := map[string]int64{}
	for _, g := range groups.Groups {
		byKey[g.Key] = g.Count
		if g.Value.Kind != "status" || "status:"+g.Value.Status != g.Key {
			t.Fatalf("group value = %+v, want status kind matching key %q", g.Value, g.Key)
		}
	}
	if byKey["status:todo"] != 3 || byKey["status:in_progress"] != 2 || byKey["status:done"] != 1 {
		t.Fatalf("status counts = %+v", byKey)
	}

	rows, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{GroupBy: "status"},
		GroupKey:        strPtr("status:todo"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if rows.Total != 3 || len(rows.Rows) != 3 || rows.NextCursor != nil {
		t.Fatalf("rows total=%d len=%d next=%v, want 3/3/nil", rows.Total, len(rows.Rows), rows.NextCursor)
	}
	if rows.GroupKey == nil || *rows.GroupKey != "status:todo" || rows.QueryFingerprint != groups.QueryFingerprint {
		t.Fatalf("rows group_key=%v fp=%q", rows.GroupKey, rows.QueryFingerprint)
	}
	for _, row := range rows.Rows {
		if row.Task.Status != "todo" {
			t.Fatalf("row status = %s, want todo", row.Task.Status)
		}
	}

	facets, err := s.TableFacets(ctx, actor, w.ID, TableFacetsInput{Facets: []string{"status", "priority"}})
	if err != nil {
		t.Fatal(err)
	}
	if facets.Total != 6 {
		t.Fatalf("facets.total = %d, want 6", facets.Total)
	}
	counts := facetCounts(t, facets, "status")
	if counts["todo"] != 3 || counts["in_progress"] != 2 || counts["done"] != 1 {
		t.Fatalf("status facet = %+v", counts)
	}
}

func facetCounts(t *testing.T, res TableFacetsResult, kind string) map[string]int64 {
	t.Helper()
	for _, f := range res.Facets {
		if f.Kind == kind {
			out := map[string]int64{}
			for _, v := range f.Values {
				out[v.Key] = v.Count
			}
			return out
		}
	}
	t.Fatalf("missing %s facet: %+v", kind, res.Facets)
	return nil
}

func TestTableGroupsRespectsStatusFilter(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "A"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "B"})
	doing := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "Doing"})
	setTableStatus(t, s, actor, doing.ID, "in_progress")

	groups, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{
		Filter:  tableFilter(func(f *tablequery.Filter) { f.Statuses = []string{"todo"} }),
		GroupBy: "status",
	})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 2 || len(groups.Groups) != 1 || groups.Groups[0].Key != "status:todo" || groups.Groups[0].Count != 2 {
		t.Fatalf("groups = %+v total=%d, want single status:todo=2", groups.Groups, groups.Total)
	}
}

func TestTableRowsAssigneeGroups(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)

	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "Unassigned"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "Assigned", AssigneeID: &ub.ID, AssigneeKind: "human"})

	groups, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: "assignee"})
	if err != nil {
		t.Fatal(err)
	}
	if len(groups.Groups) != 2 {
		t.Fatalf("groups = %+v, want 2", groups.Groups)
	}
	first := groups.Groups[0]
	if first.Key != "assignee:human:"+ub.ID || first.Value.Actor == nil || first.Value.Actor.ID != ub.ID ||
		first.Value.Actor.Type != "human" || first.Value.Label == "" {
		t.Fatalf("assigned group = %+v", first)
	}
	if groups.Groups[1].Key != "assignee:none" || groups.Groups[1].Value.Actor != nil {
		t.Fatalf("none group = %+v", groups.Groups[1])
	}

	rows, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{GroupBy: "assignee"},
		GroupKey:        strPtr("assignee:none"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if rows.Total != 1 || len(rows.Rows) != 1 || rows.Rows[0].Task.AssigneeID.Valid {
		t.Fatalf("unassigned rows total=%d rows=%+v", rows.Total, rows.Rows)
	}
}

func tableFilter(edit func(*tablequery.Filter)) tablequery.Filter {
	var f tablequery.Filter
	edit(&f)
	return f
}

func TestTableRowsSearch(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	weekly := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "Báo cáo tuần"})
	plan := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "Kế hoạch quý"})
	quote := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "báo giá"})
	pct := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "giảm 50% phí"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "giảm 500 phí"})

	search := func(q string) []string {
		t.Helper()
		res, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{Search: q}, Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		if res.Total != int64(len(res.Rows)) {
			t.Fatalf("search %q: total=%d rows=%d", q, res.Total, len(res.Rows))
		}
		return rowIDs(res.Rows)
	}
	if got := search("báo"); !sameIDs(got, weekly.ID, quote.ID) {
		t.Fatalf("search báo = %v", got)
	}
	if got := search(fmt.Sprintf("WST-%d", plan.Number)); !sameIDs(got, plan.ID) {
		t.Fatalf("search by number = %v, want %s", got, plan.ID)
	}
	if got := search("50%"); !sameIDs(got, pct.ID) {
		t.Fatalf("search 50%% = %v, want %s", got, pct.ID)
	}
}

func sameIDs(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	set := map[string]bool{}
	for _, id := range got {
		set[id] = true
	}
	for _, id := range want {
		if !set[id] {
			return false
		}
	}
	return true
}

func TestTableRowsHierarchy(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "P"})
	c1 := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "C1", ParentTaskID: &p.ID})
	c2 := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "C2", ParentTaskID: &p.ID})
	setTableStatus(t, s, actor, c2.ID, "done")

	filtered := allRows(t, s, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{
		Hierarchy: true,
		Filter:    tableFilter(func(f *tablequery.Filter) { f.Statuses = []string{"done"} }),
	}})
	if !sameIDs(rowIDs(filtered), c2.ID) {
		t.Fatalf("filtered roots = %v, want C2", titlesOf(filtered))
	}

	roots := allRows(t, s, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{Hierarchy: true}})
	if len(roots) != 1 || roots[0].Task.ID != p.ID || roots[0].DirectChildCount != 2 {
		t.Fatalf("roots = %v", roots)
	}

	children, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{Hierarchy: true}, ParentID: &p.ID, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !sameIDs(rowIDs(children.Rows), c1.ID, c2.ID) || children.Total != 2 || children.ParentID == nil || *children.ParentID != p.ID {
		t.Fatalf("children = %+v", children)
	}

	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{ParentID: &p.ID})
	wantTableCode(t, err, 400, "parent_requires_hierarchy")
}

func TestTableGroupsByProjectPriorityProperty(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	beta, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Beta"})
	if err != nil {
		t.Fatal(err)
	}
	alpha, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Alpha"})
	if err != nil {
		t.Fatal(err)
	}
	sel, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{
		Name: "Mức", Type: "select",
		Config: json.RawMessage(`{"options":[{"value":"z","label":"Zeta"},{"id":"a","name":"anh"},42]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	box, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{Name: "Duyệt", Type: "checkbox"})
	if err != nil {
		t.Fatal(err)
	}
	text, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{Name: "Ghi chú", Type: "text"})
	if err != nil {
		t.Fatal(err)
	}

	props := func(opt, checked string) map[string]json.RawMessage {
		m := map[string]json.RawMessage{}
		if opt != "" {
			m[sel.ID] = json.RawMessage(`"` + opt + `"`)
		}
		if checked != "" {
			m[box.ID] = json.RawMessage(checked)
		}
		return m
	}
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "t1", ProjectID: &beta.ID, Priority: "urgent", Properties: props("z", "true")})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "t2", ProjectID: &alpha.ID, Priority: "low", Properties: props("a", "false")})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "t3", ProjectID: &alpha.ID, Priority: "high", Properties: props("a", "")})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "t4", Properties: props("", "")})

	type want struct {
		key, label string
		count      int64
	}
	check := func(groupBy string, wants []want, value func(TableGroupValue) string, values []string) {
		t.Helper()
		res, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: groupBy})
		if err != nil {
			t.Fatal(err)
		}
		if res.Total != 4 || len(res.Groups) != len(wants) {
			t.Fatalf("%s: total=%d groups=%+v", groupBy, res.Total, res.Groups)
		}
		for i, g := range res.Groups {
			if g.Key != wants[i].key || g.Value.Label != wants[i].label || g.Count != wants[i].count {
				t.Fatalf("%s group %d = %+v, want %+v", groupBy, i, g, wants[i])
			}
			if value != nil && value(g.Value) != values[i] {
				t.Fatalf("%s group %d value = %+v, want %q", groupBy, i, g.Value, values[i])
			}
			rows, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{
				TableQueryInput: TableQueryInput{GroupBy: groupBy}, GroupKey: &g.Key, Limit: 50,
			})
			if err != nil {
				t.Fatal(err)
			}
			if rows.Total != g.Count || int64(len(rows.Rows)) != g.Count {
				t.Fatalf("%s rows for %s: total=%d len=%d, want %d", groupBy, g.Key, rows.Total, len(rows.Rows), g.Count)
			}
		}
	}

	check("project", []want{
		{"project:" + alpha.ID, "Alpha", 2}, {"project:" + beta.ID, "Beta", 1}, {"project:none", "", 1},
	}, func(v TableGroupValue) string { return v.ProjectID }, []string{alpha.ID, beta.ID, ""})
	check("priority", []want{
		{"priority:urgent", "", 1}, {"priority:high", "", 1}, {"priority:low", "", 1}, {"priority:none", "", 1},
	}, func(v TableGroupValue) string { return v.Priority }, []string{"urgent", "high", "low", "none"})
	selKey := func(v string) string { return "property:" + sel.ID + ":v:" + b64url(v) }
	check("property:"+sel.ID, []want{
		{selKey("a"), "anh", 2}, {selKey("z"), "Zeta", 1}, {"property:" + sel.ID + ":none", "", 1},
	}, func(v TableGroupValue) string { return v.PropertyID + "/" + v.Option }, []string{sel.ID + "/a", sel.ID + "/z", sel.ID + "/"})
	boxKey := func(v string) string { return "property:" + box.ID + ":v:" + b64url(v) }
	check("property:"+box.ID, []want{
		{boxKey("true"), "", 1}, {boxKey("false"), "", 1}, {"property:" + box.ID + ":none", "", 2},
	}, func(v TableGroupValue) string { return v.Option }, []string{"true", "false", ""})

	_, err = s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: "property:" + text.ID})
	wantTableCode(t, err, 422, "unsupported_group")
	_, err = s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: "property:missing"})
	wantTableCode(t, err, 422, "unsupported_group")
	_, err = s.TableGroups(ctx, actor, w.ID, TableQueryInput{GroupBy: "colour"})
	wantTableCode(t, err, 400, "invalid_group_by")
}

func TestTableInputErrors(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "x"})

	_, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{GroupBy: "status"}})
	wantTableCode(t, err, 400, "group_key_required")
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{GroupKey: strPtr("status:todo")})
	wantTableCode(t, err, 400, "group_key_required")
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{GroupBy: "status"}, GroupKey: strPtr("priority:high"),
	})
	wantTableCode(t, err, 400, "invalid_group_key")
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{SortField: "colour"}})
	wantTableCode(t, err, 400, "invalid_sort")
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{SortField: "title", SortDir: "up"}})
	wantTableCode(t, err, 400, "invalid_sort")
	_, err = s.TableFacets(ctx, actor, w.ID, TableFacetsInput{Facets: []string{"colour"}})
	wantTableCode(t, err, 400, "invalid_facets_kind")

	// An archived or missing sort property falls back to position.
	res, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{SortField: "property:missing"}})
	if err != nil || len(res.Rows) != 1 {
		t.Fatalf("missing sort property: err=%v rows=%d", err, len(res.Rows))
	}
}

func TestTableRowsCursorErrors(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	for _, title := range []string{"a", "b", "c"} {
		mkTask(t, s, actor, w.ID, CreateTaskInput{Title: title})
	}
	done := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "d"})
	setTableStatus(t, s, actor, done.ID, "done")

	first, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{SortField: "title"}, Limit: 2})
	if err != nil || first.NextCursor == nil {
		t.Fatalf("first page: err=%v next=%v", err, first.NextCursor)
	}
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{SortField: "created_at"}, Cursor: first.NextCursor, Limit: 2,
	})
	wantTableCode(t, err, 409, "cursor_query_mismatch")
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{Cursor: strPtr("garbage"), Limit: 2})
	wantTableCode(t, err, 400, "invalid_cursor")

	// A well-formed cursor of this very query whose sort value does not cast
	// to the sort's type is a bad cursor, not a failed statement.
	for _, sort := range []string{"position", "created_at", "priority", "due_date"} {
		in := TableRowsInput{TableQueryInput: TableQueryInput{SortField: sort}, Limit: 2}
		page, err := s.TableRows(ctx, actor, w.ID, in)
		if err != nil || page.NextCursor == nil {
			t.Fatalf("%s page: err=%v next=%v", sort, err, page.NextCursor)
		}
		c, err := tablequery.DecodeCursor(*page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		c.SortValue, c.SortNull = strPtr("abc"), false
		in.Cursor = strPtr(tablequery.EncodeCursor(c))
		_, err = s.TableRows(ctx, actor, w.ID, in)
		wantTableCode(t, err, 400, "invalid_cursor")
	}

	grouped := TableQueryInput{GroupBy: "status"}
	todo, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{TableQueryInput: grouped, GroupKey: strPtr("status:todo"), Limit: 2})
	if err != nil || todo.NextCursor == nil {
		t.Fatalf("todo page: err=%v next=%v", err, todo.NextCursor)
	}
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: grouped, GroupKey: strPtr("status:done"), Cursor: todo.NextCursor, Limit: 2,
	})
	wantTableCode(t, err, 409, "cursor_query_mismatch")

	// A cursor minted under one hierarchy parent must not be reusable under
	// another; ParentID is part of the cursor's scope, not just GroupKey.
	parentA := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "PA"})
	parentB := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "PB"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "CA1", ParentTaskID: &parentA.ID})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "CA2", ParentTaskID: &parentA.ID})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "CB1", ParentTaskID: &parentB.ID})
	underA, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{Hierarchy: true}, ParentID: &parentA.ID, Limit: 1,
	})
	if err != nil || underA.NextCursor == nil {
		t.Fatalf("parentA page: err=%v next=%v", err, underA.NextCursor)
	}
	_, err = s.TableRows(ctx, actor, w.ID, TableRowsInput{
		TableQueryInput: TableQueryInput{Hierarchy: true}, ParentID: &parentB.ID, Cursor: underA.NextCursor, Limit: 1,
	})
	wantTableCode(t, err, 409, "cursor_query_mismatch")
}

func TestTableRowsTotalIsBranchTotal(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	for i := 0; i < 7; i++ {
		task := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: fmt.Sprintf("t%d", i)})
		if i >= 5 {
			setTableStatus(t, s, actor, task.ID, "done")
		}
	}
	in := TableRowsInput{TableQueryInput: TableQueryInput{GroupBy: "status"}, GroupKey: strPtr("status:todo"), Limit: 2}
	var seen int
	for pages := 0; ; pages++ {
		if pages > 10 {
			t.Fatal("cursor never ended")
		}
		res, err := s.TableRows(ctx, actor, w.ID, in)
		if err != nil {
			t.Fatal(err)
		}
		if res.Total != 5 {
			t.Fatalf("page %d total = %d, want 5", pages, res.Total)
		}
		seen += len(res.Rows)
		if res.NextCursor == nil {
			break
		}
		in.Cursor = res.NextCursor
	}
	if seen != 5 {
		t.Fatalf("rows across pages = %d, want 5", seen)
	}
}

// TestTableGroupsFilterByProjectID is the table half of what used to be
// TestQueryAndTableFilterByProjectID (see TestQueryTasksFilterByProjectID in
// task_query_test.go for the QueryTasks half); split so only
// task_table*.go files import pkg/db/tablequery (ADR 0020).
func TestTableGroupsFilterByProjectID(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	projectA, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Project A"})
	if err != nil {
		t.Fatal(err)
	}
	projectB, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Project B"})
	if err != nil {
		t.Fatal(err)
	}

	taskA := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "In A"})
	taskB := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "In B"})
	linkTask := func(taskID, projectID string) {
		t.Helper()
		if _, err := s.pool.Exec(ctx,
			`UPDATE tasks SET project_id = $1 WHERE id = $2 AND organization_id = $3 AND workspace_id = $4`,
			projectID, taskID, w.OrganizationID, w.ID,
		); err != nil {
			t.Fatal(err)
		}
	}
	linkTask(taskA.ID, projectA.ID)
	linkTask(taskB.ID, projectB.ID)

	groups, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{
		Filter:  tablequery.Filter{ProjectIDs: []string{projectA.ID}},
		GroupBy: "status",
	})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 1 {
		t.Fatalf("TableGroups total = %d, want 1", groups.Total)
	}
}

func TestTableGroupsRowsLabelFilter(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	tagged := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "tagged"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "plain"})
	label, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "L", Color: "#112233"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachTaskLabel(ctx, actor, tagged.ID, label.ID); err != nil {
		t.Fatal(err)
	}

	filter := tableFilter(func(f *tablequery.Filter) { f.LabelIDs = []string{label.ID} })
	groups, err := s.TableGroups(ctx, actor, w.ID, TableQueryInput{Filter: filter, GroupBy: "status"})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 1 {
		t.Fatalf("groups.Total = %d, want 1", groups.Total)
	}

	rows := allRows(t, s, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{Filter: filter}})
	if !sameIDs(rowIDs(rows), tagged.ID) {
		t.Fatalf("rows = %v, want tagged only", rowIDs(rows))
	}
}

func TestTableRowsDateFilter(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	inRange := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "in-range"})
	outOfRange := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "out-of-range"})
	if _, err := s.pool.Exec(ctx,
		`UPDATE tasks SET created_at = $1 WHERE id = $2 AND organization_id = $3 AND workspace_id = $4`,
		"2020-01-15T12:00:00Z", outOfRange.ID, w.OrganizationID, w.ID,
	); err != nil {
		t.Fatal(err)
	}

	filter := tableFilter(func(f *tablequery.Filter) {
		f.DateField = "created_at"
		f.DateFrom = "2026-01-01"
		f.DateTo = "2026-12-31"
	})
	rows := allRows(t, s, actor, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{Filter: filter}})
	if !sameIDs(rowIDs(rows), inRange.ID) {
		t.Fatalf("rows = %v, want in-range only", rowIDs(rows))
	}
}
