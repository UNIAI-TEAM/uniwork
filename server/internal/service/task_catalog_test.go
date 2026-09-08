package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestListTaskStatusesReturnsSevenBuiltIns(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	list, err := s.ListTaskStatuses(ctx, Human(ua.ID), w.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"}
	if len(list) != len(want) {
		t.Fatalf("len = %d, want %d", len(list), len(want))
	}
	for i, key := range want {
		if list[i].Key != key || !list[i].IsSystem {
			t.Fatalf("status[%d] = %+v, want key=%s is_system", i, list[i], key)
		}
	}
}

func TestPatchBuiltInTaskStatusFails(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	list, err := s.ListTaskStatuses(ctx, Human(ua.ID), w.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	var builtInID string
	for _, st := range list {
		if st.IsSystem {
			builtInID = st.ID
			break
		}
	}
	if builtInID == "" {
		t.Fatal("expected a built-in status")
	}
	name := "Renamed"
	_, err = s.UpdateTaskStatus(ctx, Human(ua.ID), w.ID, builtInID, UpdateTaskStatusInput{Name: &name})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "system_status_immutable" || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want system_status_immutable 422, got %v", err)
	}
}

func TestDeleteBuiltInTaskStatusFails(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	list, err := s.ListTaskStatuses(ctx, Human(ua.ID), w.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	var builtInID string
	for _, st := range list {
		if st.Key == "todo" {
			builtInID = st.ID
			break
		}
	}
	err = s.DeleteTaskStatus(ctx, Human(ua.ID), w.ID, builtInID)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "system_status_immutable" {
		t.Fatalf("want system_status_immutable, got %v", err)
	}
}

func TestCreateCustomTaskStatusAndLabelPropertyRoundTrip(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	st, err := s.CreateTaskStatus(ctx, actor, w.ID, CreateTaskStatusInput{
		Name: "Waiting QA", Category: "in_review", Color: "#22c55e",
	})
	if err != nil {
		t.Fatal(err)
	}
	if st.IsSystem || st.Key == "" || st.Category != "in_review" {
		t.Fatalf("custom status = %+v", st)
	}

	label, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{
		Name: "Bug", Color: "#ef4444",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetTaskLabel(ctx, actor, w.ID, label.ID)
	if err != nil || got.Name != "Bug" {
		t.Fatalf("get label: %+v %v", got, err)
	}

	prop, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{
		Name: "Story Points", Type: "number",
	})
	if err != nil {
		t.Fatal(err)
	}
	props, err := s.ListTaskProperties(ctx, actor, w.ID, false)
	if err != nil || len(props) != 1 || props[0].ID != prop.ID {
		t.Fatalf("list properties = %+v err=%v", props, err)
	}

	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Catalog attach"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachTaskLabel(ctx, actor, task.ID, label.ID); err != nil {
		t.Fatal(err)
	}
	linked, err := s.ListTaskLabelsOnTask(ctx, actor, task.ID)
	if err != nil || len(linked) != 1 || linked[0].ID != label.ID {
		t.Fatalf("task labels = %+v err=%v", linked, err)
	}
	val := json.RawMessage(`5`)
	updated, err := s.SetTaskPropertyValue(ctx, actor, task.ID, prop.ID, val)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision <= task.Revision {
		t.Fatalf("revision = %d, want > %d", updated.Revision, task.Revision)
	}

	_ = events.drain(t)
}
