package service

import (
	"context"
	"testing"
)

// Fixture: 3 todo, 2 in_progress, 1 done — groups/rows/facets must match counts.
func TestTableGroupsRowsFacetsFixtureCounts(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	mk := func(title, status string) {
		t.Helper()
		task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: title})
		if err != nil {
			t.Fatal(err)
		}
		if status == "todo" {
			return
		}
		st := status
		if _, err := s.Update(ctx, actor, task.ID, UpdateTaskInput{Status: &st}); err != nil {
			t.Fatal(err)
		}
	}
	mk("T1", "todo")
	mk("T2", "todo")
	mk("T3", "todo")
	mk("P1", "in_progress")
	mk("P2", "in_progress")
	mk("D1", "done")

	groups, err := s.TableGroups(ctx, actor, w.ID, TableInput{
		GroupBy: "status",
		Columns: []string{"title", "status", "priority"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 6 {
		t.Fatalf("groups.total = %d, want 6", groups.Total)
	}
	if groups.QueryFingerprint == "" {
		t.Fatal("expected non-empty query_fingerprint")
	}
	byKey := map[string]int64{}
	for _, g := range groups.Groups {
		byKey[g.Key] = g.Count
		if g.Value.Kind != "status" || g.Value.Status != g.Key {
			t.Fatalf("group value = %+v, want status kind matching key %q", g.Value, g.Key)
		}
	}
	if byKey["todo"] != 3 || byKey["in_progress"] != 2 || byKey["done"] != 1 {
		t.Fatalf("status counts = %+v, want todo=3 in_progress=2 done=1", byKey)
	}

	todoKey := "todo"
	rows, err := s.TableRows(ctx, actor, w.ID, TableInput{
		Filter:   TableFilter{},
		GroupBy:  "status",
		GroupKey: &todoKey,
		Columns:  []string{"title", "status"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rows.Total != 3 {
		t.Fatalf("rows.total = %d, want 3", rows.Total)
	}
	if len(rows.Rows) != 3 {
		t.Fatalf("rows len = %d, want 3", len(rows.Rows))
	}
	if rows.GroupKey == nil || *rows.GroupKey != "todo" {
		t.Fatalf("rows.group_key = %v, want todo", rows.GroupKey)
	}
	for _, row := range rows.Rows {
		if row.Task.Status != "todo" {
			t.Fatalf("row status = %s, want todo", row.Task.Status)
		}
	}

	facets, err := s.TableFacets(ctx, actor, w.ID, TableInput{
		Facets:  []string{"status", "priority"},
		Columns: []string{"title"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if facets.Total != 6 {
		t.Fatalf("facets.total = %d, want 6", facets.Total)
	}
	var statusFacet *TableFacet
	for i := range facets.Facets {
		if facets.Facets[i].Kind == "status" {
			statusFacet = &facets.Facets[i]
		}
	}
	if statusFacet == nil {
		t.Fatalf("missing status facet: %+v", facets.Facets)
	}
	facetCounts := map[string]int64{}
	for _, v := range statusFacet.Values {
		facetCounts[v.Key] = v.Count
	}
	if facetCounts["todo"] != 3 || facetCounts["in_progress"] != 2 || facetCounts["done"] != 1 {
		t.Fatalf("status facet = %+v, want todo=3 in_progress=2 done=1", facetCounts)
	}
}

func TestTableGroupsRespectsStatusFilter(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	for _, title := range []string{"A", "B"} {
		if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: title}); err != nil {
			t.Fatal(err)
		}
	}
	doing, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Doing"})
	if err != nil {
		t.Fatal(err)
	}
	st := "in_progress"
	if _, err := s.Update(ctx, actor, doing.ID, UpdateTaskInput{Status: &st}); err != nil {
		t.Fatal(err)
	}

	groups, err := s.TableGroups(ctx, actor, w.ID, TableInput{
		Filter:  TableFilter{Statuses: []string{"todo"}},
		GroupBy: "status",
	})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 2 {
		t.Fatalf("filtered total = %d, want 2", groups.Total)
	}
	if len(groups.Groups) != 1 || groups.Groups[0].Key != "todo" || groups.Groups[0].Count != 2 {
		t.Fatalf("groups = %+v, want single todo=2", groups.Groups)
	}
}

func TestTableRowsUnassignedAssigneeGroupKey(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)

	if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Unassigned"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{
		Title: "Assigned", AssigneeID: &ub.ID, AssigneeKind: "human",
	}); err != nil {
		t.Fatal(err)
	}

	empty := ""
	rows, err := s.TableRows(ctx, actor, w.ID, TableInput{
		GroupBy:  "assignee",
		GroupKey: &empty,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rows.Total != 1 || len(rows.Rows) != 1 {
		t.Fatalf("unassigned rows total=%d len=%d, want 1", rows.Total, len(rows.Rows))
	}
	if rows.Rows[0].Task.AssigneeID.Valid {
		t.Fatal("expected unassigned task")
	}
}
