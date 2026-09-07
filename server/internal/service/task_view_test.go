package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

func TestUpdateTaskViewRaceOnUpdateMiss(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	cases := []struct {
		name     string
		mutate   string
		wantErr  error
		wantCode string
	}{
		{
			name:    "deleted_under_lock",
			mutate:  `DELETE FROM task_views WHERE id = $1`,
			wantErr: ErrNotFound,
		},
		{
			name:     "revision_bumped_under_lock",
			mutate:   `UPDATE task_views SET revision = revision + 1, updated_at = now() WHERE id = $1`,
			wantCode: "revision_conflict",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			view, err := s.CreateTaskView(ctx, actor, w.ID, CreateTaskViewInput{
				Name:      "Race view",
				ScopeType: "workspace",
				Query:     json.RawMessage(`{}`),
			})
			if err != nil {
				t.Fatal(err)
			}

			lockTx, err := s.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer lockTx.Rollback(ctx)
			if _, err := lockTx.Exec(ctx, `SELECT id FROM task_views WHERE id = $1 FOR UPDATE`, view.ID); err != nil {
				t.Fatal(err)
			}

			type result struct {
				view db.TaskView
				err  error
			}
			ch := make(chan result, 1)
			go func() {
				name := "raced"
				v, err := s.UpdateTaskView(ctx, actor, w.ID, view.ID, UpdateTaskViewInput{
					Name:             &name,
					ExpectedRevision: 1,
				})
				ch <- result{view: v, err: err}
			}()

			// Get succeeds unlocked; UPDATE blocks on our row lock.
			time.Sleep(100 * time.Millisecond)
			if _, err := lockTx.Exec(ctx, tc.mutate, view.ID); err != nil {
				t.Fatal(err)
			}
			if err := lockTx.Commit(ctx); err != nil {
				t.Fatal(err)
			}

			r := <-ch
			if r.err == nil {
				t.Fatalf("must not return (TaskView{}, nil); got %+v", r.view)
			}
			if r.view.ID != "" {
				t.Fatalf("error path must not return a view body: %+v", r.view)
			}
			if tc.wantErr != nil && !errors.Is(r.err, tc.wantErr) {
				t.Fatalf("want %v, got %v", tc.wantErr, r.err)
			}
			if tc.wantCode != "" {
				var ce CodedError
				if !errors.As(r.err, &ce) || ce.Code != tc.wantCode {
					t.Fatalf("want code %s, got %v", tc.wantCode, r.err)
				}
			}
		})
	}
}

func TestReorderPinsRejectsMissingPin(t *testing.T) {
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
	_ = events.drain(t)
	events.pub.events = nil

	err = s.ReorderPins(ctx, actor, w.ID, []ReorderPinItem{
		{ID: pin.ID, Position: 1},
		{ID: "01MISSINGPIN00000000000000", Position: 2},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for missing pin, got %v", err)
	}
	if drained := events.drain(t); len(drained) != 0 {
		t.Fatalf("missing-pin reorder must not audit/outbox; got %#v", drained)
	}
}
