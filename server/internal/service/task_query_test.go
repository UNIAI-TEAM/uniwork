package service

import (
	"context"
	"strconv"
	"strings"
	"testing"
)

func TestQueryTasksFiltersByStatusAndPaginates(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	todo1, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Todo A"})
	if err != nil {
		t.Fatal(err)
	}
	todo2, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Todo B"})
	if err != nil {
		t.Fatal(err)
	}
	st := "in_progress"
	progress, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Doing"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, actor, progress.ID, UpdateTaskInput{Status: &st}); err != nil {
		t.Fatal(err)
	}

	page, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{Status: "todo", Limit: 1, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 {
		t.Fatalf("total = %d, want 2 todo tasks", page.Total)
	}
	if len(page.Tasks) != 1 {
		t.Fatalf("page size = %d, want 1", len(page.Tasks))
	}
	if page.Tasks[0].ID != todo1.ID && page.Tasks[0].ID != todo2.ID {
		t.Fatalf("unexpected task %s", page.Tasks[0].ID)
	}

	page2, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{Status: "todo", Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Tasks) != 1 {
		t.Fatalf("second page size = %d, want 1", len(page2.Tasks))
	}
	if page2.Tasks[0].ID == page.Tasks[0].ID {
		t.Fatal("offset did not advance")
	}
	ids := map[string]bool{todo1.ID: true, todo2.ID: true}
	if !ids[page.Tasks[0].ID] || !ids[page2.Tasks[0].ID] {
		t.Fatalf("pages should cover both todos: %s %s", page.Tasks[0].ID, page2.Tasks[0].ID)
	}
}

func TestGetTaskByIdentifier(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "By ref"})
	if err != nil {
		t.Fatal(err)
	}
	if w.TaskPrefix == "" {
		t.Fatal("fixture workspace missing task_prefix")
	}
	ref := w.TaskPrefix + "-" + strconv.FormatInt(task.Number, 10)

	got, err := s.GetByRef(ctx, actor, ref)
	if err != nil {
		t.Fatalf("GetByRef(%q): %v", ref, err)
	}
	if got.ID != task.ID {
		t.Fatalf("id = %s, want %s", got.ID, task.ID)
	}

	// Prefix match is case-insensitive (documented: PREFIX-N).
	lower := strings.ToLower(w.TaskPrefix) + "-" + strconv.FormatInt(task.Number, 10)
	got2, err := s.GetByRef(ctx, actor, lower)
	if err != nil || got2.ID != task.ID {
		t.Fatalf("case-insensitive GetByRef(%q): err=%v id=%s", lower, err, got2.ID)
	}

	byID, err := s.GetByRef(ctx, actor, task.ID)
	if err != nil || byID.ID != task.ID {
		t.Fatalf("GetByRef(ULID): err=%v id=%s", err, byID.ID)
	}
}
