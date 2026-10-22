package tablequery

import (
	"strings"
	"testing"
)

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
	sql, args := BuildGroups(q)

	if !strings.Contains(sql, "assignee_id IS NULL") {
		t.Fatalf("missing no-assignee clause: %s", sql)
	}
	if !strings.Contains(sql, "task_label_links") {
		t.Fatalf("missing label EXISTS on task_label_links: %s", sql)
	}
	if !strings.Contains(sql, "properties") {
		t.Fatalf("missing properties filter: %s", sql)
	}
	if !strings.Contains(sql, "created_at::date") {
		t.Fatalf("missing created_at date range: %s", sql)
	}
	for _, needle := range []string{"l1", "p1", "__none__", "2026-01-01", "2026-01-31"} {
		if strings.Contains(sql, needle) {
			t.Errorf("user value %q leaked into SQL: %s", needle, sql)
		}
	}
	assertArgsContain(t, args, "l1", "p1", "2026-01-01", "2026-01-31")
}

func TestMemberFiltersAssigneeAndProjectPositiveSelection(t *testing.T) {
	q := Query{
		OrganizationID: "o",
		WorkspaceID:    "w",
		Filter: Filter{
			AssigneeIDs:       []string{"u2", "u1"},
			IncludeNoAssignee: true,
			ProjectIDs:        []string{"p9"},
			IncludeNoProject:  true,
			CreatorRefs:       []string{"agent:a1", "human:u1", "human:u1", "bogus", "human:"},
			LabelIDs:          []string{"l2", "l1", "l1"},
			Properties: map[string][]string{
				"p1": {"opt", "__none__", "opt"},
			},
			DateField: "updated_at",
			DateFrom:  "2026-02-01",
			DateTo:    "2026-02-28",
		},
	}.Normalize()

	if got := q.Filter.AssigneeIDs; len(got) != 2 || got[0] != "u1" || got[1] != "u2" {
		t.Fatalf("AssigneeIDs normalize = %v", got)
	}
	if got := q.Filter.CreatorRefs; len(got) != 2 || got[0] != "agent:a1" || got[1] != "human:u1" {
		t.Fatalf("CreatorRefs normalize = %v", got)
	}
	if got := q.Filter.LabelIDs; len(got) != 2 || got[0] != "l1" || got[1] != "l2" {
		t.Fatalf("LabelIDs normalize = %v", got)
	}
	if got := q.Filter.Properties["p1"]; len(got) != 2 || got[0] != "__none__" || got[1] != "opt" {
		t.Fatalf("Properties[p1] normalize = %v", got)
	}

	sql, args := BuildGroups(q)
	if !strings.Contains(sql, "assignee_id IS NULL OR") || !strings.Contains(sql, "assignee_id = ANY(") {
		t.Fatalf("expected no-assignee OR assignee ANY: %s", sql)
	}
	if !strings.Contains(sql, "project_id IS NULL OR") || !strings.Contains(sql, "project_id = ANY(") {
		t.Fatalf("expected no-project OR project ANY: %s", sql)
	}
	if !strings.Contains(sql, "created_by_kind") || !strings.Contains(sql, "created_by") {
		t.Fatalf("missing creator pair filter: %s", sql)
	}
	if !strings.Contains(sql, "updated_at::date") {
		t.Fatalf("missing updated_at date range: %s", sql)
	}
	for _, needle := range []string{"u1", "u2", "a1", "p9", "l1", "l2", "opt", "__none__", "2026-02-01"} {
		if strings.Contains(sql, needle) {
			t.Errorf("user value %q leaked into SQL: %s", needle, sql)
		}
	}
	assertArgsContain(t, args, "u1", "u2", "p9", "human", "a1", "l1", "l2", "p1", "opt", "2026-02-01", "2026-02-28")
}

func TestNormalizeClearsUnknownDateField(t *testing.T) {
	got := Query{Filter: Filter{
		DateField: "due_date",
		DateFrom:  "2026-01-01",
		DateTo:    "2026-01-31",
	}}.Normalize().Filter
	if got.DateField != "" || got.DateFrom != "" || got.DateTo != "" {
		t.Fatalf("unknown DateField kept: %+v", got)
	}
}

func TestMemberFiltersRelation(t *testing.T) {
	build := func(relation, actor string) (string, []any) {
		return BuildGroups(Query{
			OrganizationID: "o",
			WorkspaceID:    "w",
			Filter:         Filter{Relation: relation, ActorID: actor},
		}.Normalize())
	}

	sql, args := build("all", "me")
	if !strings.Contains(sql, "assignee_id = $") || !strings.Contains(sql, "created_by = $") || !strings.Contains(sql, " OR ") {
		t.Fatalf("all: want assignee OR created_by: %s", sql)
	}
	assertArgsContain(t, args, "me")
	if strings.Contains(sql, "'me'") {
		t.Errorf("actor id leaked into SQL: %s", sql)
	}

	sql, _ = build("assigned", "me")
	if !strings.Contains(sql, "assignee_id = $") || strings.Contains(sql, "created_by = $") {
		t.Fatalf("assigned: want assignee only: %s", sql)
	}

	sql, _ = build("created", "me")
	if !strings.Contains(sql, "created_by = $") || strings.Contains(sql, "assignee_id = $") {
		t.Fatalf("created: want created_by only: %s", sql)
	}

	// involved is empty until agent involvement exists; an unknown relation
	// fails closed instead of widening to the whole workspace.
	for _, relation := range []string{"involved", "bogus"} {
		sql, _ = build(relation, "me")
		if !strings.Contains(sql, "FALSE") {
			t.Fatalf("%s: want FALSE clause: %s", relation, sql)
		}
	}

	sql, _ = build("", "")
	if strings.Contains(sql, "FALSE") || strings.Contains(sql, "created_by = $") {
		t.Fatalf("empty relation must not constrain: %s", sql)
	}
}

func TestFingerprintBindsRelationAndActor(t *testing.T) {
	base := Query{OrganizationID: "o", WorkspaceID: "w"}
	a := base
	a.Filter = Filter{Relation: "assigned", ActorID: "u1"}
	b := base
	b.Filter = Filter{Relation: "created", ActorID: "u1"}
	c := base
	c.Filter = Filter{Relation: "assigned", ActorID: "u2"}
	fa, fb, fc := Fingerprint(a.Normalize()), Fingerprint(b.Normalize()), Fingerprint(c.Normalize())
	if fa == fb || fa == fc {
		t.Fatalf("a cursor must not carry across relation or actor: %s %s %s", fa, fb, fc)
	}
}

func assertArgsContain(t *testing.T, args []any, want ...string) {
	t.Helper()
	have := map[string]bool{}
	for _, a := range args {
		switch v := a.(type) {
		case string:
			have[v] = true
		case []string:
			for _, s := range v {
				have[s] = true
			}
		}
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("args missing %q: %v", w, args)
		}
	}
}
