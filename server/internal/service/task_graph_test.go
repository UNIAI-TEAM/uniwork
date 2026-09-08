package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestListMyTasksReturnsOnlyActorsTasks(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actorA := Human(ua.ID)
	actorB := Human(ub.ID)

	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)

	mineAssigned, err := s.Create(ctx, actorA, w.ID, CreateTaskInput{
		Title: "Assigned to A", AssigneeID: &ua.ID, AssigneeKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	mineCreated, err := s.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "Created by A, unassigned"})
	if err != nil {
		t.Fatal(err)
	}
	theirs, err := s.Create(ctx, actorB, w.ID, CreateTaskInput{
		Title: "B's task", AssigneeID: &ub.ID, AssigneeKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}

	page, err := s.ListMyTasks(ctx, actorA, w.ID, TaskQuery{})
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, task := range page.Tasks {
		ids[task.ID] = true
	}
	if !ids[mineAssigned.ID] || !ids[mineCreated.ID] {
		t.Fatalf("my-tasks missing A's tasks: %+v", ids)
	}
	if ids[theirs.ID] {
		t.Fatal("my-tasks included another actor's task")
	}
}

func TestListMyTasksRelationFilters(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actorA := Human(ua.ID)
	actorB := Human(ub.ID)

	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)

	assigned, err := s.Create(ctx, actorA, w.ID, CreateTaskInput{
		Title: "Assigned to A", AssigneeID: &ua.ID, AssigneeKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "Created by A, unassigned"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, actorB, w.ID, CreateTaskInput{
		Title: "B's task", AssigneeID: &ub.ID, AssigneeKind: "human",
	}); err != nil {
		t.Fatal(err)
	}

	assignedPage, err := s.ListMyTasks(ctx, actorA, w.ID, TaskQuery{Relation: "assigned"})
	if err != nil {
		t.Fatal(err)
	}
	if len(assignedPage.Tasks) != 1 || assignedPage.Tasks[0].ID != assigned.ID {
		t.Fatalf("assigned: want only %s, got %+v", assigned.ID, assignedPage.Tasks)
	}

	createdPage, err := s.ListMyTasks(ctx, actorA, w.ID, TaskQuery{Relation: "created"})
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, task := range createdPage.Tasks {
		ids[task.ID] = true
	}
	if !ids[created.ID] {
		t.Fatalf("created: missing %s in %+v", created.ID, ids)
	}

	involvedPage, err := s.ListMyTasks(ctx, actorA, w.ID, TaskQuery{Relation: "involved"})
	if err != nil {
		t.Fatal(err)
	}
	if len(involvedPage.Tasks) != 0 || involvedPage.Total != 0 {
		t.Fatalf("involved must be empty, got tasks=%d total=%d", len(involvedPage.Tasks), involvedPage.Total)
	}
}

func TestSetDependencyCycleReturnsParentCycle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	a, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "B"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.SetDependency(ctx, actor, a.ID, SetDependencyInput{
		DependsOnTaskID: b.ID, Type: "blocked_by",
	}); err != nil {
		t.Fatal(err)
	}
	_, err = s.SetDependency(ctx, actor, b.ID, SetDependencyInput{
		DependsOnTaskID: a.ID, Type: "blocked_by",
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "parent_cycle" || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want parent_cycle 422, got %v", err)
	}
}

func TestSetParentCycleReturnsParentCycle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	parent, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Child"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetParent(ctx, actor, child.ID, &parent.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.SetParent(ctx, actor, parent.ID, &child.ID)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "parent_cycle" {
		t.Fatalf("want parent_cycle, got %v", err)
	}
}

func TestSetDependencyCrossWorkspaceRejected(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	a, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "In W"})
	if err != nil {
		t.Fatal(err)
	}

	orgs := NewOrganizationService(s.pool, s.q)
	wsSvc := NewWorkspaceService(s.pool, s.q, orgs, s.ws.render, &fakeOutbox{})
	org2, err := orgs.Create(ctx, ua.ID, "Org Two", "org-two")
	if err != nil {
		t.Fatal(err)
	}
	v2, err := wsSvc.CreateInOrg(ctx, ua.ID, org2.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	s2 := NewTaskService(s.pool, s.q, wsSvc)
	other, err := s2.Create(ctx, actor, v2.Workspace.ID, CreateTaskInput{Title: "Other WS"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.SetDependency(ctx, actor, a.ID, SetDependencyInput{
		DependsOnTaskID: other.ID, Type: "blocked_by",
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "cross_workspace_reference" {
		t.Fatalf("want cross_workspace_reference, got %v", err)
	}
}

func TestListChildrenAndByParents(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	p1, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "P1"})
	if err != nil {
		t.Fatal(err)
	}
	p2, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	c1, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "C1"})
	if err != nil {
		t.Fatal(err)
	}
	c2, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "C2"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetParent(ctx, actor, c1.ID, &p1.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetParent(ctx, actor, c2.ID, &p2.ID); err != nil {
		t.Fatal(err)
	}

	kids, err := s.ListChildren(ctx, actor, p1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(kids) != 1 || kids[0].ID != c1.ID {
		t.Fatalf("ListChildren = %+v, want [%s]", kids, c1.ID)
	}

	batch, err := s.ListChildrenByParents(ctx, actor, w.ID, []string{p1.ID, p2.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(batch) != 2 {
		t.Fatalf("batch len = %d, want 2", len(batch))
	}
}

func TestSetDependencyInvisibleOtherWorkspaceNotCrossWorkspace(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actorA := Human(ua.ID)

	a, err := s.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "In A"})
	if err != nil {
		t.Fatal(err)
	}

	orgs := NewOrganizationService(s.pool, s.q)
	wsSvc := NewWorkspaceService(s.pool, s.q, orgs, s.ws.render, &fakeOutbox{})
	orgB, err := orgs.Create(ctx, ub.ID, "Org B Only", "org-b-only")
	if err != nil {
		t.Fatal(err)
	}
	vB, err := wsSvc.CreateInOrg(ctx, ub.ID, orgB.ID, "Beta", "beta-b")
	if err != nil {
		t.Fatal(err)
	}
	sB := NewTaskService(s.pool, s.q, wsSvc)
	foreign, err := sB.Create(ctx, Human(ub.ID), vB.Workspace.ID, CreateTaskInput{Title: "Foreign"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.SetDependency(ctx, actorA, a.ID, SetDependencyInput{
		DependsOnTaskID: foreign.ID, Type: "blocked_by",
	})
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "cross_workspace_reference" {
		t.Fatalf("existence leak: got cross_workspace_reference for invisible task")
	}
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for invisible other-workspace task, got %v", err)
	}

	_, err = s.SetParent(ctx, actorA, a.ID, &foreign.ID)
	if errors.As(err, &ce) && ce.Code == "cross_workspace_reference" {
		t.Fatalf("existence leak on SetParent: got cross_workspace_reference")
	}
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("SetParent want ErrNotFound, got %v", err)
	}
}

func TestSetDependencyDuplicateReturnsConflict(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	a, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "B"})
	if err != nil {
		t.Fatal(err)
	}
	in := SetDependencyInput{DependsOnTaskID: b.ID, Type: "blocked_by"}
	if _, err := s.SetDependency(ctx, actor, a.ID, in); err != nil {
		t.Fatal(err)
	}
	_, err = s.SetDependency(ctx, actor, a.ID, in)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate dependency: want ErrConflict, got %v", err)
	}
}

func TestDetectParentCyclePropagatesLookupError(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	parent, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Parent"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Child"})
	if err != nil {
		t.Fatal(err)
	}
	// Break the chain: parent points at a missing ancestor so walk must error,
	// not silently treat lookup failure as no-cycle.
	missing := "01MISSINGPARENT000000000000"
	_, err = s.pool.Exec(ctx,
		`UPDATE tasks SET parent_task_id = $1 WHERE id = $2`,
		missing, parent.ID,
	)
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.SetParent(ctx, actor, child.ID, &parent.ID)
	if err == nil {
		t.Fatal("want parent-cycle walk to surface GetTask failure, got nil")
	}
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "parent_cycle" {
		t.Fatalf("lookup failure must not be treated as cycle/no-cycle success: %v", err)
	}
}
