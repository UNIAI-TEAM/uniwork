package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestCreateTaskActiveDuplicateBlocksSameTitle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	first, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "  Login Bug  ", Priority: "none"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "login   bug", Priority: "high"}, "dup-1")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "active_duplicate_task" {
		t.Fatalf("want active_duplicate_task, got %v", err)
	}
	if ce.Status != http.StatusConflict {
		t.Fatalf("status: got %d want 409", ce.Status)
	}
	if ce.Fields["task_id"] != first.ID {
		t.Fatalf("fields.task_id: got %v want %s", ce.Fields["task_id"], first.ID)
	}
	if ce.Fields["title"] != first.Title {
		t.Fatalf("fields.title: got %v want %s", ce.Fields["title"], first.Title)
	}
	ident, _ := ce.Fields["identifier"].(string)
	if ident == "" {
		t.Fatal("fields.identifier missing")
	}
}

func TestCreateTaskAllowDuplicateBypassesGuard(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	if _, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Same title", Priority: "none"}); err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{
		Title: "Same title", Priority: "none", AllowDuplicate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Title != "Same title" {
		t.Fatalf("title: %+v", second)
	}
}

func TestCreateTaskDoneStatusFreesDuplicateTitle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	first, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Ship it", Priority: "none"})
	if err != nil {
		t.Fatal(err)
	}
	done := "done"
	if _, err := s.Update(ctx, Human(ua.ID), first.ID, UpdateTaskInput{Status: &done}); err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Ship it", Priority: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("expected a new task after the first was done")
	}
}

func TestCreateTaskQuotaExceeded(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = $2::jsonb WHERE organization_id = $1`,
		w.OrganizationID, `{"tasks.max": 1}`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "First", Priority: "none"}); err != nil {
		t.Fatal(err)
	}
	_, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Second", Priority: "none"})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "quota_exceeded" || !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("want quota_exceeded, got %v", err)
	}
	if ce.Fields["meter"] != FeatureTasksMax {
		t.Fatalf("meter: got %v want %s", ce.Fields["meter"], FeatureTasksMax)
	}
}
