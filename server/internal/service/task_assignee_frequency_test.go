package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAssigneeFrequencyCountsCreatesAndReassignmentsOfTheCaller(t *testing.T) {
	agents, tasks, _, ua, ub, org, w := agentFixture(t)
	ctx := context.Background()
	actorA, actorB := Human(ua.ID), Human(ub.ID)
	addOrgMember(t, tasks.q, org.ID, ub.ID)
	addWorkspaceMember(t, tasks.q, w.ID, ub.ID)
	inWS, err := agents.ListInWorkspace(ctx, ua.ID, w.ID)
	if err != nil || len(inWS) == 0 {
		t.Fatalf("workspace agent: %v %+v", err, inWS)
	}
	agentID := inWS[0].ID

	first, err := tasks.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "t1", AssigneeID: &ub.ID, AssigneeKind: "human"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := tasks.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "t2"})
	if err != nil {
		t.Fatal(err)
	}
	reassign := func(taskID string, id *string, kind string) {
		t.Helper()
		if _, err := tasks.Update(ctx, actorA, taskID, UpdateTaskInput{AssigneeID: &id, AssigneeKind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	reassign(second.ID, &agentID, "agent")
	reassign(second.ID, &ub.ID, "human")
	reassign(second.ID, nil, "")
	title := "renamed"
	if _, err := tasks.Update(ctx, actorA, first.ID, UpdateTaskInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.Create(ctx, actorB, w.ID, CreateTaskInput{Title: "b", AssigneeID: &ub.ID, AssigneeKind: "human"}); err != nil {
		t.Fatal(err)
	}

	got, err := tasks.AssigneeFrequency(ctx, actorA, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []AssigneeFrequency{
		{Kind: "human", ID: ub.ID, Frequency: 2},
		{Kind: "agent", ID: agentID, Frequency: 1},
	}
	if len(got) != len(want) {
		t.Fatalf("frequency = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("frequency[%d] = %+v, want %+v (all %+v)", i, got[i], want[i], got)
		}
	}
}

func TestAssigneeFrequencyStaysInsideTheWorkspace(t *testing.T) {
	_, tasks, ws, ua, ub, org, w := agentFixture(t)
	ctx := context.Background()
	actorA := Human(ua.ID)
	addOrgMember(t, tasks.q, org.ID, ub.ID)
	addWorkspaceMember(t, tasks.q, w.ID, ub.ID)
	other, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	addWorkspaceMember(t, tasks.q, other.Workspace.ID, ub.ID)
	if _, err := tasks.Create(ctx, actorA, other.Workspace.ID, CreateTaskInput{Title: "elsewhere", AssigneeID: &ub.ID, AssigneeKind: "human"}); err != nil {
		t.Fatal(err)
	}

	got, err := tasks.AssigneeFrequency(ctx, actorA, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("another workspace leaked into the count: %+v", got)
	}
}

func TestAssigneeFrequencyOnlyCountsInsideTheWindow(t *testing.T) {
	_, tasks, _, ua, ub, org, w := agentFixture(t)
	ctx := context.Background()
	actorA := Human(ua.ID)
	addOrgMember(t, tasks.q, org.ID, ub.ID)
	addWorkspaceMember(t, tasks.q, w.ID, ub.ID)
	if _, err := tasks.Create(ctx, actorA, w.ID, CreateTaskInput{Title: "t", AssigneeID: &ub.ID, AssigneeKind: "human"}); err != nil {
		t.Fatal(err)
	}

	got, err := tasks.assigneeFrequencySince(ctx, actorA, w.ID, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("rows before the window were counted: %+v", got)
	}
}

func TestAssigneeFrequencyRefusesNonMembers(t *testing.T) {
	_, tasks, _, _, ub, _, w := agentFixture(t)
	_, err := tasks.AssigneeFrequency(context.Background(), Human(ub.ID), w.ID)
	if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member got %v, want forbidden or not found", err)
	}
}
