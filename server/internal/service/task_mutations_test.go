package service

import (
	"context"
	"encoding/json"
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
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Batch", Priority: "low", AllowDuplicate: true})
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
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Del", Priority: "low", AllowDuplicate: true})
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

func TestCreateTaskSuiteRetriesAfterFailedCreate(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	key := "create-suite-retry-after-fail"

	_, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Bad", Priority: "not-a-priority"}, key)
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want ValidationError, got %v", err)
	}

	task, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Good", Priority: "medium"}, key)
	if err != nil {
		t.Fatalf("retry after failed create: %v", err)
	}
	if task.Title != "Good" {
		t.Fatalf("title: got %q want Good", task.Title)
	}
	list, err := s.List(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("rows: got %d want 1", len(list))
	}
}

func TestCreateTaskSuitePersistsWorkManagementContextAtTheHeadOfStatus(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	existing, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Existing review task", Status: "in_review",
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if existing.Priority != "none" {
		t.Fatalf("default priority = %q, want none", existing.Priority)
	}
	project, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Release"})
	if err != nil {
		t.Fatal(err)
	}
	label, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "Urgent", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{Title: "Parent"}, "")
	if err != nil {
		t.Fatal(err)
	}
	start, due := "2026-09-17", "2026-09-20"
	stage := int32(2)

	created, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title:        "Child",
		Description:  "Created with its complete context",
		Status:       "in_review",
		Priority:     "none",
		StartDate:    &start,
		DueDate:      &due,
		ProjectID:    &project.ID,
		ParentTaskID: &parent.ID,
		Stage:        &stage,
		LabelIDs:     []string{label.ID},
	}, "create-with-context")
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != "in_review" || created.Priority != "none" {
		t.Fatalf("status/priority = %q/%q", created.Status, created.Priority)
	}
	if created.Position >= existing.Position {
		t.Fatalf("position = %v, want before existing %v", created.Position, existing.Position)
	}
	if !created.ProjectID.Valid || created.ProjectID.String != project.ID {
		t.Fatalf("project_id = %+v, want %s", created.ProjectID, project.ID)
	}
	if !created.ParentTaskID.Valid || created.ParentTaskID.String != parent.ID {
		t.Fatalf("parent_task_id = %+v, want %s", created.ParentTaskID, parent.ID)
	}
	if !created.StartDate.Valid || created.StartDate.Time.Format("2006-01-02") != start {
		t.Fatalf("start_date = %+v, want %s", created.StartDate, start)
	}
	if !created.DueDate.Valid || created.DueDate.Time.Format("2006-01-02") != due {
		t.Fatalf("due_date = %+v, want %s", created.DueDate, due)
	}
	if !created.Stage.Valid || created.Stage.Int32 != stage {
		t.Fatalf("stage = %+v, want %d", created.Stage, stage)
	}
	labels, err := s.ListTaskLabelsOnTask(ctx, actor, created.ID)
	if err != nil || len(labels) != 1 || labels[0].ID != label.ID {
		t.Fatalf("labels = %+v err=%v", labels, err)
	}
}

func TestCreateTaskSuitePersistsCustomPropertiesAtomically(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	property, err := s.CreateTaskProperty(ctx, actor, w.ID, CreateTaskPropertyInput{
		Name: "Story points", Type: "number",
	})
	if err != nil {
		t.Fatal(err)
	}

	created, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Estimated", Properties: map[string]json.RawMessage{property.ID: json.RawMessage(`5`)},
	}, "create-with-properties")
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]any
	if err := json.Unmarshal(created.Properties, &values); err != nil {
		t.Fatal(err)
	}
	if values[property.ID] != float64(5) {
		t.Fatalf("properties = %#v", values)
	}
}

func TestCreateTaskSuiteRejectsForeignCustomPropertyWithoutCreatingTask(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	other, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Other properties", "other-properties")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := s.CreateTaskProperty(ctx, actor, other.Workspace.ID, CreateTaskPropertyInput{
		Name: "Foreign score", Type: "number",
	})
	if err != nil {
		t.Fatal(err)
	}

	before, err := s.List(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Must roll back", Properties: map[string]json.RawMessage{foreign.ID: json.RawMessage(`5`)},
	}, "create-with-foreign-property")
	if err == nil {
		t.Fatal("expected foreign property to fail")
	}
	after, err := s.List(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("create was not atomic: before=%d after=%d", len(before), len(after))
	}
}

func TestCreateTaskSuiteRejectsCrossWorkspaceContextWithoutCreatingTask(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	other, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Other", "other")
	if err != nil {
		t.Fatal(err)
	}
	foreignParent, err := s.CreateTaskSuite(ctx, actor, other.Workspace.ID, CreateTaskInput{Title: "Foreign parent"}, "")
	if err != nil {
		t.Fatal(err)
	}
	foreignProject, err := s.CreateProject(ctx, actor, other.Workspace.ID, CreateProjectInput{Title: "Foreign project"})
	if err != nil {
		t.Fatal(err)
	}
	foreignLabel, err := s.CreateTaskLabel(ctx, actor, other.Workspace.ID, CreateTaskLabelInput{Name: "Foreign", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}

	for name, in := range map[string]CreateTaskInput{
		"parent":  {Title: "Invalid child", ParentTaskID: &foreignParent.ID},
		"project": {Title: "Invalid project task", ProjectID: &foreignProject.ID},
		"label":   {Title: "Invalid label task", LabelIDs: []string{foreignLabel.ID}},
	} {
		t.Run(name, func(t *testing.T) {
			before, err := s.List(ctx, ua.ID, w.ID)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.CreateTaskSuite(ctx, actor, w.ID, in, "invalid-"+name); err == nil {
				t.Fatal("expected cross-workspace reference to fail")
			}
			after, err := s.List(ctx, ua.ID, w.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(after) != len(before) {
				t.Fatalf("create was not atomic: before=%d after=%d", len(before), len(after))
			}
		})
	}
}

func TestCreateTaskSuiteUsesActiveWorkspaceStatusCatalog(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	custom, err := s.CreateTaskStatus(ctx, actor, w.ID, CreateTaskStatusInput{
		Name: "Ready for QA", Category: "in_review", Color: "#334455",
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Catalog task", Status: custom.Key,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != custom.Key {
		t.Fatalf("status = %q, want %q", created.Status, custom.Key)
	}

	if err := s.DeleteTaskStatus(ctx, actor, w.ID, custom.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Archived status", Status: custom.Key,
	}, ""); err == nil {
		t.Fatal("expected archived status to be rejected")
	}
	if _, err := s.CreateTaskSuite(ctx, actor, w.ID, CreateTaskInput{
		Title: "Unknown status", Status: "not_a_status",
	}, ""); err == nil {
		t.Fatal("expected unknown status to be rejected")
	}
}

func TestBatchUpdateTasksRollsBackOnMidFailure(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	ids := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Batch atomic", Priority: "low", AllowDuplicate: true})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	st := "done"
	_, err := s.BatchUpdateTasks(ctx, Human(ua.ID), w.ID, BatchUpdateTasksInput{
		TaskIDs: append(ids, "01JNOTATASK000000000000000"),
		Patch:   UpdateTaskInput{Status: &st},
	})
	if err == nil {
		t.Fatal("expected error for unknown task id")
	}
	for _, id := range ids {
		got, err := s.Get(ctx, ua.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != "todo" {
			t.Fatalf("task %s status=%q want todo (batch must roll back)", id, got.Status)
		}
		if got.Revision != 1 {
			t.Fatalf("task %s revision=%d want 1", id, got.Revision)
		}
	}
}

func TestBatchDeleteTasksRollsBackOnMidFailure(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()

	ids := make([]string, 0, 2)
	for i := 0; i < 2; i++ {
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Del atomic", Priority: "low", AllowDuplicate: true})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, task.ID)
	}
	_, err := s.BatchDeleteTasks(ctx, Human(ua.ID), w.ID, append(ids, "01JNOTATASK000000000000000"))
	if err == nil {
		t.Fatal("expected error for unknown task id")
	}
	for _, id := range ids {
		if _, err := s.Get(ctx, ua.ID, id); err != nil {
			t.Fatalf("task %s should still exist after rolled-back batch delete: %v", id, err)
		}
	}
}
