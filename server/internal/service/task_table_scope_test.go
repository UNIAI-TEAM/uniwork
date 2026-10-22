package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/pkg/db/tablequery"
)

func TestTableRowsCarryLabels(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	tagged := mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "tagged"})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "plain"})
	zulu, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "Zulu", Color: "#112233"})
	if err != nil {
		t.Fatal(err)
	}
	alpha, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "alpha", Color: "#445566"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{zulu.ID, alpha.ID} {
		if err := s.AttachTaskLabel(ctx, actor, tagged.ID, id); err != nil {
			t.Fatal(err)
		}
	}

	res, err := s.TableRows(ctx, actor, w.ID, TableRowsInput{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range res.Rows {
		if row.Labels == nil {
			t.Fatalf("row %s labels = nil, want non-nil", row.Task.Title)
		}
		if row.Task.ID != tagged.ID {
			if len(row.Labels) != 0 {
				t.Fatalf("plain labels = %+v", row.Labels)
			}
			continue
		}
		want := []TableRowLabel{{ID: alpha.ID, Name: "alpha", Color: "#445566"}, {ID: zulu.ID, Name: "Zulu", Color: "#112233"}}
		if len(row.Labels) != 2 || row.Labels[0] != want[0] || row.Labels[1] != want[1] {
			t.Fatalf("tagged labels = %+v, want %+v", row.Labels, want)
		}
	}
}

func TestTableFacetsProjectWithSearch(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	alpha, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Alpha"})
	if err != nil {
		t.Fatal(err)
	}
	beta, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Beta"})
	if err != nil {
		t.Fatal(err)
	}
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "report x", ProjectID: &alpha.ID})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "report y", ProjectID: &beta.ID})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "other", ProjectID: &alpha.ID})
	mkTask(t, s, actor, w.ID, CreateTaskInput{Title: "report z"})

	res, err := s.TableFacets(ctx, actor, w.ID, TableFacetsInput{
		TableQueryInput: TableQueryInput{
			Search: "report",
			Filter: tableFilter(func(f *tablequery.Filter) { f.ProjectIDs = []string{alpha.ID} }),
		},
		Facets: []string{"project", "status"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 1 {
		t.Fatalf("total = %d, want 1", res.Total)
	}
	projects := facetCounts(t, res, "project")
	if len(projects) != 3 || projects[alpha.ID] != 1 || projects[beta.ID] != 1 || projects[""] != 1 {
		t.Fatalf("project facet = %+v", projects)
	}
	if statuses := facetCounts(t, res, "status"); len(statuses) != 1 || statuses["todo"] != 1 {
		t.Fatalf("status facet = %+v", statuses)
	}
}

func TestTableIsolatesOrganizations(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actorA, actorB := Human(ua.ID), Human(ub.ID)
	orgB, err := NewOrganizationService(s.pool, s.q).Create(ctx, ub.ID, "Org B", "org-beta")
	if err != nil {
		t.Fatal(err)
	}
	wsB, err := s.ws.CreateInOrg(ctx, ub.ID, orgB.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	projB, err := s.CreateProject(ctx, actorB, wsB.Workspace.ID, CreateProjectInput{Title: "Alpha"})
	if err != nil {
		t.Fatal(err)
	}
	aIDs := map[string]bool{}
	for _, title := range []string{"same 1", "same 2"} {
		aIDs[mkTask(t, s, actorA, w.ID, CreateTaskInput{Title: title}).ID] = true
		mkTask(t, s, actorB, wsB.Workspace.ID, CreateTaskInput{Title: title, ProjectID: &projB.ID})
	}

	rows := allRows(t, s, actorA, w.ID, TableRowsInput{TableQueryInput: TableQueryInput{Search: "same"}})
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	for _, r := range rows {
		if !aIDs[r.Task.ID] {
			t.Fatalf("row %s leaked from another organization", r.Task.ID)
		}
	}
	groups, err := s.TableGroups(ctx, actorA, w.ID, TableQueryInput{GroupBy: "project"})
	if err != nil {
		t.Fatal(err)
	}
	if groups.Total != 2 || len(groups.Groups) != 1 || groups.Groups[0].Key != "project:none" {
		t.Fatalf("groups = %+v total=%d", groups.Groups, groups.Total)
	}
	facets, err := s.TableFacets(ctx, actorA, w.ID, TableFacetsInput{Facets: []string{"project", "status"}})
	if err != nil {
		t.Fatal(err)
	}
	if p := facetCounts(t, facets, "project"); len(p) != 1 || p[""] != 2 {
		t.Fatalf("project facet = %+v", p)
	}
	if _, err := s.TableRows(ctx, actorA, wsB.Workspace.ID, TableRowsInput{}); err != ErrForbidden {
		t.Fatalf("cross-org rows err = %v, want forbidden", err)
	}
}

func TestTableRelationMatchesMyTasks(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actorA, actorB := Human(ua.ID), Human(ub.ID)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)

	mkTask(t, s, actorA, w.ID, CreateTaskInput{Title: "assigned to A", AssigneeID: &ua.ID, AssigneeKind: "human"})
	mkTask(t, s, actorA, w.ID, CreateTaskInput{Title: "created by A"})
	mkTask(t, s, actorB, w.ID, CreateTaskInput{Title: "B assigns A", AssigneeID: &ua.ID, AssigneeKind: "human"})
	mkTask(t, s, actorB, w.ID, CreateTaskInput{Title: "B's own", AssigneeID: &ub.ID, AssigneeKind: "human"})

	for _, relation := range []string{"all", "assigned", "created", "involved"} {
		want, err := s.ListMyTasks(ctx, actorA, w.ID, TaskQuery{Relation: relation})
		if err != nil {
			t.Fatal(err)
		}
		in := TableQueryInput{Filter: tableFilter(func(f *tablequery.Filter) { f.Relation = relation })}
		rows, err := s.TableRows(ctx, actorA, w.ID, TableRowsInput{TableQueryInput: in, Limit: 50})
		if err != nil {
			t.Fatalf("%s rows: %v", relation, err)
		}
		if rows.Total != want.Total || len(rows.Rows) != len(want.Tasks) {
			t.Fatalf("%s: table total=%d rows=%d, my-tasks total=%d tasks=%d", relation, rows.Total, len(rows.Rows), want.Total, len(want.Tasks))
		}
		groups, err := s.TableGroups(ctx, actorA, w.ID, in)
		if err != nil {
			t.Fatalf("%s groups: %v", relation, err)
		}
		if groups.Total != want.Total {
			t.Fatalf("%s: groups total=%d, my-tasks total=%d", relation, groups.Total, want.Total)
		}
	}
}

func TestTableRelationActorComesFromTheSession(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	mkTask(t, s, Human(ub.ID), w.ID, CreateTaskInput{Title: "B's", AssigneeID: &ub.ID, AssigneeKind: "human"})

	// A client cannot name the viewer: the service overwrites ActorID.
	in := TableQueryInput{Filter: tableFilter(func(f *tablequery.Filter) { f.Relation = "all"; f.ActorID = ub.ID })}
	rows, err := s.TableRows(ctx, Human(ua.ID), w.ID, TableRowsInput{TableQueryInput: in, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if rows.Total != 0 || len(rows.Rows) != 0 {
		t.Fatalf("A saw B's tasks through a spoofed ActorID: total=%d", rows.Total)
	}
}

func TestTableRelationRejectsUnknownValue(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	in := TableQueryInput{Filter: tableFilter(func(f *tablequery.Filter) { f.Relation = "everyone" })}
	_, err := s.TableGroups(context.Background(), Human(ua.ID), w.ID, in)
	if !codedIs(err, "invalid_relation") {
		t.Fatalf("err = %v, want invalid_relation", err)
	}
}
