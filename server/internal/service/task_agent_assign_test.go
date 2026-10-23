package service

import (
	"context"
	"testing"
)

// agentAssignFixture returns the workspace's seeded agent plus a way to move
// it to another status.
func agentAssignFixture(t *testing.T) (context.Context, *TaskService, Actor, string, string, func(string)) {
	t.Helper()
	agents, tasks, _, ua, _, _, w := agentFixture(t)
	ctx := context.Background()
	inWS, err := agents.ListInWorkspace(ctx, ua.ID, w.ID)
	if err != nil || len(inWS) == 0 {
		t.Fatalf("workspace agent: %v %+v", err, inWS)
	}
	agentID := inWS[0].ID
	setStatus := func(status string) {
		t.Helper()
		if _, err := agents.Update(ctx, ua.ID, agentID, UpdateAgentInput{Status: &status}); err != nil {
			t.Fatal(err)
		}
	}
	return ctx, tasks, Human(ua.ID), w.ID, agentID, setStatus
}

func TestAssignToAgentRequiresAnActiveAgent(t *testing.T) {
	for _, tc := range []struct {
		status string
		code   string
	}{
		{"paused", "agent_paused"},
		{"archived", "agent_archived"},
	} {
		t.Run(tc.status, func(t *testing.T) {
			ctx, tasks, actor, wsID, agentID, setStatus := agentAssignFixture(t)
			setStatus(tc.status)

			_, err := tasks.Create(ctx, actor, wsID, CreateTaskInput{Title: "c", AssigneeID: &agentID, AssigneeKind: "agent"})
			if !codedIs(err, tc.code) {
				t.Fatalf("create: want %s, got %v", tc.code, err)
			}

			task, err := tasks.Create(ctx, actor, wsID, CreateTaskInput{Title: "u"})
			if err != nil {
				t.Fatal(err)
			}
			id := &agentID
			_, err = tasks.Update(ctx, actor, task.ID, UpdateTaskInput{AssigneeID: &id, AssigneeKind: "agent"})
			if !codedIs(err, tc.code) {
				t.Fatalf("update: want %s, got %v", tc.code, err)
			}

			_, err = tasks.BatchUpdateTasks(ctx, actor, wsID, BatchUpdateTasksInput{
				TaskIDs: []string{task.ID},
				Patch:   UpdateTaskInput{AssigneeID: &id, AssigneeKind: "agent"},
			})
			if !codedIs(err, tc.code) {
				t.Fatalf("batch: want %s, got %v", tc.code, err)
			}
		})
	}
}

func TestAssignToActiveAgentSucceeds(t *testing.T) {
	ctx, tasks, actor, wsID, agentID, _ := agentAssignFixture(t)

	task, err := tasks.Create(ctx, actor, wsID, CreateTaskInput{Title: "a", AssigneeID: &agentID, AssigneeKind: "agent"})
	if err != nil {
		t.Fatal(err)
	}
	if task.AssigneeKind != "agent" || !task.AssigneeID.Valid || task.AssigneeID.String != agentID {
		t.Fatalf("assignee: %+v %s", task.AssigneeID, task.AssigneeKind)
	}
}

func TestTaskKeepsItsPausedAgentWhileOtherFieldsChange(t *testing.T) {
	ctx, tasks, actor, wsID, agentID, setStatus := agentAssignFixture(t)
	task, err := tasks.Create(ctx, actor, wsID, CreateTaskInput{Title: "k", AssigneeID: &agentID, AssigneeKind: "agent"})
	if err != nil {
		t.Fatal(err)
	}
	setStatus("paused")

	title := "renamed"
	if _, err := tasks.Update(ctx, actor, task.ID, UpdateTaskInput{Title: &title}); err != nil {
		t.Fatalf("editing another field: %v", err)
	}
	// Clients resend the current assignee with the rest of the form.
	id := &agentID
	if _, err := tasks.Update(ctx, actor, task.ID, UpdateTaskInput{Title: &title, AssigneeID: &id, AssigneeKind: "agent"}); err != nil {
		t.Fatalf("resending the same assignee: %v", err)
	}
	var none *string
	if _, err := tasks.Update(ctx, actor, task.ID, UpdateTaskInput{AssigneeID: &none}); err != nil {
		t.Fatalf("unassigning: %v", err)
	}
}
