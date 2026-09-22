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

func TestNumberPropertySortGuardsNonNumbers(t *testing.T) {
	q := baseQuery()
	q.Sort = Sort{Field: "property", Property: &PropertyRef{ID: "n1", Type: "number"}}
	sql, _ := BuildRows(RowsRequest{Query: q, Limit: 10})
	if !strings.Contains(sql, "CASE WHEN jsonb_typeof(t.properties->$3::text) = 'number' THEN (t.properties->>$3::text)::numeric END") {
		t.Fatalf("number sort without jsonb_typeof guard: %s", sql)
	}
	if strings.Contains(sql, "'')::numeric") {
		t.Fatalf("unguarded numeric cast still present: %s", sql)
	}
}

func TestNormalizeCoercesUnknownSortToPositionAsc(t *testing.T) {
	for name, s := range map[string]Sort{
		"unknown field":   {Field: "foo", Desc: true},
		"person property": {Field: "property", Desc: true, Property: &PropertyRef{ID: "x", Type: "person"}},
	} {
		got := Query{Sort: s}.Normalize().Sort
		if got.Field != "position" || got.Desc || got.Property != nil {
			t.Errorf("%s: Normalize sort = %+v, want position asc", name, got)
		}
	}
}

func TestSortExprFallbackIsAscending(t *testing.T) {
	q := Query{OrganizationID: "o", WorkspaceID: "w", Sort: Sort{Field: "foo", Desc: true}}
	sql, _ := BuildRows(RowsRequest{Query: q, Limit: 10})
	if strings.Contains(sql, "t.position DESC") || !strings.Contains(sql, "t.position ASC") {
		t.Fatalf("fallback sort not ascending: %s", sql)
	}
}

func TestGroupPredicateBranchesAndFacetReject(t *testing.T) {
	q := baseQuery()
	cases := []struct {
		name string
		g    GroupPredicate
		want string
	}{
		{name: "status", g: GroupPredicate{Kind: GroupKindStatus, Value: "todo"}, want: "t.status = $"},
		{name: "priority", g: GroupPredicate{Kind: GroupKindPriority, Value: "high"}, want: "t.priority = $"},
		{name: "assignee none", g: GroupPredicate{Kind: GroupKindAssignee, None: true}, want: "t.assignee_id IS NULL"},
		{name: "assignee", g: GroupPredicate{Kind: GroupKindAssignee, Value: "u1", ActorKind: "human"}, want: "t.assignee_id = $"},
		{name: "project none", g: GroupPredicate{Kind: GroupKindProject, None: true}, want: "t.project_id IS NULL"},
		{name: "project", g: GroupPredicate{Kind: GroupKindProject, Value: "p1"}, want: "t.project_id = $"},
		{name: "property none select", g: GroupPredicate{Kind: GroupKindProperty, None: true}, want: "NULLIF(t.properties->>"},
		{name: "property value", g: GroupPredicate{Kind: GroupKindProperty, Value: "a"}, want: "t.properties->>"},
		{name: "unknown", g: GroupPredicate{Kind: GroupKind("nope")}, want: "FALSE"},
	}
	q.Group = Group{Kind: GroupKindProperty, Property: &PropertyRef{ID: "p1", Type: "select"}}
	for _, tc := range cases {
		sql, _ := BuildRows(RowsRequest{Query: q, Group: &tc.g, Limit: 5})
		if !strings.Contains(sql, tc.want) {
			t.Fatalf("%s: missing %q in %s", tc.name, tc.want, sql)
		}
	}
	q.Group = Group{Kind: GroupKindProperty, Property: &PropertyRef{ID: "c1", Type: "checkbox"}}
	cbNone := GroupPredicate{Kind: GroupKindProperty, None: true}
	sql, _ := BuildRows(RowsRequest{Query: q, Group: &cbNone, Limit: 5})
	if !strings.Contains(sql, "jsonb_typeof") {
		t.Fatalf("checkbox none: %s", sql)
	}
	cb := GroupPredicate{Kind: GroupKindProperty, Value: "true"}
	sql, _ = BuildRows(RowsRequest{Query: q, Group: &cb, Limit: 5})
	if !strings.Contains(sql, "to_jsonb") {
		t.Fatalf("checkbox value: %s", sql)
	}
	q.Group = Group{Kind: GroupKindProperty}
	sql, _ = BuildRows(RowsRequest{Query: q, Group: &GroupPredicate{Kind: GroupKindProperty, Value: "x"}, Limit: 5})
	if !strings.Contains(sql, "FALSE") {
		t.Fatalf("nil property ref: %s", sql)
	}
	if _, err := Facet(t.Context(), nil, q, "not-a-facet"); err == nil || !strings.Contains(err.Error(), "unsupported facet") {
		t.Fatalf("facet reject: %v", err)
	}
}
