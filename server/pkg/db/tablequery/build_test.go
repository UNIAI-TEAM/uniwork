package tablequery

import (
	"strings"
	"testing"
)

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
		"rows": func() (string, []any) {
			return BuildRows(RowsRequest{Query: q, Group: &gp, ParentID: &pid, After: after, Limit: 50})
		},
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
