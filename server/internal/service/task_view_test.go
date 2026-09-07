package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestCreateTaskViewAndPutPreferenceRoundTrip(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	view, err := s.CreateTaskView(ctx, actor, w.ID, CreateTaskViewInput{
		Name:      "Open backlog",
		ScopeType: "workspace",
		Query:     json.RawMessage(`{"status":["backlog","todo"]}`),
		Display:   json.RawMessage(`{"layout":"list"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Name != "Open backlog" || view.Visibility != "private" || view.Revision != 1 {
		t.Fatalf("create view = %+v", view)
	}
	if view.OrganizationID != w.OrganizationID || view.WorkspaceID != w.ID || view.OwnerID != ua.ID {
		t.Fatalf("tenant fields = %+v", view)
	}

	listed, err := s.ListTaskViews(ctx, actor, w.ID, "workspace", nil)
	if err != nil || len(listed) != 1 || listed[0].ID != view.ID {
		t.Fatalf("list = %+v err=%v", listed, err)
	}

	got, err := s.GetTaskView(ctx, actor, w.ID, view.ID)
	if err != nil || got.ID != view.ID {
		t.Fatalf("get = %+v err=%v", got, err)
	}

	name := "Backlog list"
	updated, err := s.UpdateTaskView(ctx, actor, w.ID, view.ID, UpdateTaskViewInput{
		Name:             &name,
		ExpectedRevision: 1,
		Query:            json.RawMessage(`{"status":["todo"]}`),
	})
	if err != nil || updated.Name != name || updated.Revision != 2 {
		t.Fatalf("update = %+v err=%v", updated, err)
	}

	_, err = s.UpdateTaskView(ctx, actor, w.ID, view.ID, UpdateTaskViewInput{
		ExpectedRevision: 1,
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "revision_conflict" || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want revision_conflict 422, got %v", err)
	}

	pref, err := s.GetTaskViewPreference(ctx, actor, w.ID, "workspace", nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(pref.Prefs) != "{}" {
		t.Fatalf("empty pref = %s", pref.Prefs)
	}

	saved, err := s.PutTaskViewPreference(ctx, actor, w.ID, PutTaskViewPreferenceInput{
		ScopeType: "workspace",
		Prefs:     json.RawMessage(`{"hidden":["builtin:all"],"order":["view:` + view.ID + `"]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ScopeType != "workspace" || saved.ScopeID != w.ID {
		t.Fatalf("pref scope = %+v", saved)
	}
	round, err := s.GetTaskViewPreference(ctx, actor, w.ID, "workspace", nil)
	if err != nil || string(round.Prefs) != string(saved.Prefs) {
		t.Fatalf("pref round-trip = %s err=%v", round.Prefs, err)
	}

	if err := s.DeleteTaskView(ctx, actor, w.ID, view.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetTaskView(ctx, actor, w.ID, view.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete get: %v", err)
	}

	drained := events.drain(t)
	wantTopics := map[string]bool{
		"task_view.created": true, "task_view.updated": true, "task_view.deleted": true,
		"task_view_preference.updated": true,
	}
	for _, e := range drained {
		delete(wantTopics, e.Type)
	}
	for topic := range wantTopics {
		t.Fatalf("missing outbox topic %s in %#v", topic, drained)
	}
}

func TestCreatePinRoundTrip(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Pinned"})
	if err != nil {
		t.Fatal(err)
	}
	pin, err := s.CreatePin(ctx, actor, w.ID, CreatePinInput{ItemType: "task", ItemID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	if pin.ItemType != "task" || pin.ItemID != task.ID || pin.UserID != ua.ID {
		t.Fatalf("pin = %+v", pin)
	}
	list, err := s.ListPins(ctx, actor, w.ID, true)
	if err != nil || len(list) != 1 || list[0].ID != pin.ID {
		t.Fatalf("list pins = %+v err=%v", list, err)
	}
	if err := s.DeletePin(ctx, actor, w.ID, "task", task.ID); err != nil {
		t.Fatal(err)
	}
	list, err = s.ListPins(ctx, actor, w.ID, true)
	if err != nil || len(list) != 0 {
		t.Fatalf("after delete = %+v err=%v", list, err)
	}
	drained := events.drain(t)
	foundCreate, foundDelete := false, false
	for _, e := range drained {
		if e.Type == "task_pin.created" {
			foundCreate = true
		}
		if e.Type == "task_pin.deleted" {
			foundDelete = true
		}
	}
	if !foundCreate || !foundDelete {
		t.Fatalf("pin events missing in %#v", drained)
	}
}
