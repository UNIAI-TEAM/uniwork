package service

import (
	"context"
	"testing"
)

func TestUpdateMovesATaskToACustomStatus(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	custom, err := s.CreateTaskStatus(ctx, actor, w.ID, CreateTaskStatusInput{Name: "Waiting QA", Category: "in_review", Color: "#22c55e"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "move me"})
	if err != nil {
		t.Fatal(err)
	}

	up, err := s.Update(ctx, actor, task.ID, UpdateTaskInput{Status: &custom.Key})
	if err != nil {
		t.Fatalf("custom status: %v", err)
	}
	if up.Status != custom.Key {
		t.Fatalf("status = %q, want %q", up.Status, custom.Key)
	}

	unknown := "not-in-catalog"
	if _, err := s.Update(ctx, actor, task.ID, UpdateTaskInput{Status: &unknown}); err == nil {
		t.Fatal("a key outside the catalog must be refused")
	}
}

func TestArchivedStatusStaysOnlyOnTasksAlreadyThere(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	custom, err := s.CreateTaskStatus(ctx, actor, w.ID, CreateTaskStatusInput{Name: "Parked", Category: "backlog", Color: "#64748b"})
	if err != nil {
		t.Fatal(err)
	}
	parked, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "parked", Status: custom.Key})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "other"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteTaskStatus(ctx, actor, w.ID, custom.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Update(ctx, actor, other.ID, UpdateTaskInput{Status: &custom.Key}); err == nil {
		t.Fatal("an archived status must not take new tasks")
	}
	// Clients resend the current status with the rest of the form.
	title := "still parked"
	if _, err := s.Update(ctx, actor, parked.ID, UpdateTaskInput{Title: &title, Status: &custom.Key}); err != nil {
		t.Fatalf("resending the task's own archived status: %v", err)
	}
}
