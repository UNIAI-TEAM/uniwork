package service

import (
	"context"
	"testing"
)

// An update that names the revision it read is refused, and writes nothing,
// once someone else has changed the task (ADR 0033).
func TestUpdateRefusesAStaleExpectedRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	tasks := x.tools.ask.tasks
	task, err := tasks.Get(ctx, x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	read := task.Revision
	first := "Bản mới"
	if _, err := tasks.Update(ctx, Human(x.ua.ID), x.taskID, UpdateTaskInput{Title: &first, ExpectedRevision: &read}); err != nil {
		t.Fatalf("update at the read revision: %v", err)
	}
	second := "Ghi đè"
	_, err = tasks.Update(ctx, Human(x.ua.ID), x.taskID, UpdateTaskInput{Title: &second, ExpectedRevision: &read})
	if !codedIs(err, "revision_conflict") {
		t.Fatalf("stale update: %v, want revision_conflict", err)
	}
	after, _ := tasks.Get(ctx, x.ua.ID, x.taskID)
	if after.Title != first || after.Revision != read+1 {
		t.Fatalf("after the refused update: title %q revision %d", after.Title, after.Revision)
	}
}
