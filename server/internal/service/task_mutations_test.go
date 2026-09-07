package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestUpdateTaskSuiteStaleRevisionConflicts(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Rev race", Priority: "medium"})
	if err != nil {
		t.Fatal(err)
	}
	st := "in_progress"
	if _, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Status: &st}); err != nil {
		t.Fatal(err)
	}
	// Server is at revision 2; client still holds 1.
	title := "stale overwrite"
	_, err = s.UpdateTaskSuite(ctx, Human(ua.ID), task.ID, UpdateTaskSuiteInput{
		Revision: 1,
		Title:    &title,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "revision_conflict" {
		t.Fatalf("want revision_conflict, got %v", err)
	}
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d want 422", ce.Status)
	}
}

func TestUpdateTaskSuiteBumpsRevisionOnce(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()

	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Once", Priority: "medium"})
	if err != nil {
		t.Fatal(err)
	}
	title := "Once updated"
	st := "in_progress"
	up, err := s.UpdateTaskSuite(ctx, Human(ua.ID), task.ID, UpdateTaskSuiteInput{
		Revision: task.Revision,
		Title:    &title,
		Status:   &st,
	})
	if err != nil {
		t.Fatal(err)
	}
	if up.Revision != task.Revision+1 {
		t.Fatalf("revision: got %d want %d", up.Revision, task.Revision+1)
	}
	if up.Title != title || up.Status != st {
		t.Fatalf("fields: %+v", up)
	}
	evs := events.drain(t)
	found := false
	for _, e := range evs {
		if e.Type == "task.updated" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected task.updated outbox event, got %#v", evs)
	}
}

func TestBatchUpdateTasksUpdatesThree(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	ids := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Batch", Priority: "low"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	st := "done"
	n, err := s.BatchUpdateTasks(ctx, Human(ua.ID), w.ID, BatchUpdateTasksInput{
		TaskIDs: ids,
		Patch:   UpdateTaskInput{Status: &st},
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("updated: got %d want 3", n)
	}
	for _, id := range ids {
		got, err := s.Get(ctx, ua.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != "done" {
			t.Fatalf("task %s status=%q want done", id, got.Status)
		}
		if got.Revision != 2 {
			t.Fatalf("task %s revision=%d want 2", id, got.Revision)
		}
	}
}

func TestBatchDeleteTasksRemovesThree(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	ids := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Del", Priority: "low"})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	n, err := s.BatchDeleteTasks(ctx, Human(ua.ID), w.ID, ids)
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("deleted: got %d want 3", n)
	}
	for _, id := range ids {
		if _, err := s.Get(ctx, ua.ID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("task %s still visible: %v", id, err)
		}
	}
}

func TestCreateTaskSuiteIdempotentReplay(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	key := "create-suite-key-1"

	first, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Idem", Priority: "medium"}, key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Idem ignored", Priority: "high"}, key)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected replay of same task, got %s vs %s", first.ID, second.ID)
	}
	list, err := s.List(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("rows: got %d want 1", len(list))
	}
}
