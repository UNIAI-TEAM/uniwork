package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestListTaskStatusesReturnsSevenBuiltIns(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	list, err := s.ListTaskStatuses(ctx, Human(ua.ID), w.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	// Group order (UniAI): not started, started (blocked included), completed, closed.
	want := []string{"backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"}
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

// Only a workspace owner or admin edits the task catalog: a plain member still
// reads it (pickers need it) and an agent never writes it, whatever its
// membership (requireActorWorkspaceAdmin, ADR 0010).
func TestTaskCatalogWritesNeedWorkspaceAdmin(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	agent, err := s.q.CreateAgent(ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: w.OrganizationID, Name: "bot", Handle: "bot",
		OwnerUserID: ua.ID, AutonomyPolicy: "{}", CreatedBy: ua.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.q.AddWorkspaceAgentMember(ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: w.ID, AgentID: agent.ID, OrganizationID: w.OrganizationID,
		CreatedBy: ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	owner := Human(ua.ID)

	st, err := s.CreateTaskStatus(ctx, owner, w.ID, CreateTaskStatusInput{Name: "QA", Category: "in_review", Color: "#22c55e"})
	if err != nil {
		t.Fatal(err)
	}
	label, err := s.CreateTaskLabel(ctx, owner, w.ID, CreateTaskLabelInput{Name: "Bug", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}

	name := "Renamed"
	for who, actor := range map[string]Actor{"member": Human(ub.ID), "agent": agentActor(agent.ID)} {
		writes := []struct {
			op  string
			run func() error
		}{
			{"create status", func() error {
				_, err := s.CreateTaskStatus(ctx, actor, w.ID, CreateTaskStatusInput{Name: "Other", Category: "todo", Color: "#22c55e"})
				return err
			}},
			{"update status", func() error {
				_, err := s.UpdateTaskStatus(ctx, actor, w.ID, st.ID, UpdateTaskStatusInput{Name: &name})
				return err
			}},
			{"reorder statuses", func() error {
				_, err := s.ReorderTaskStatuses(ctx, actor, w.ID, ReorderTaskStatusesInput{Group: "started", IDs: []string{st.ID}})
				return err
			}},
			{"archive status", func() error { return s.DeleteTaskStatus(ctx, actor, w.ID, st.ID) }},
			{"create label", func() error {
				_, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "Other", Color: "#ef4444"})
				return err
			}},
			{"update label", func() error {
				_, err := s.UpdateTaskLabel(ctx, actor, w.ID, label.ID, UpdateTaskLabelInput{Name: &name})
				return err
			}},
			{"delete label", func() error { return s.DeleteTaskLabel(ctx, actor, w.ID, label.ID) }},
		}
		for _, write := range writes {
			if err := write.run(); !errors.Is(err, ErrForbidden) {
				t.Errorf("%s %s: err = %v, want ErrForbidden", who, write.op, err)
			}
		}
	}

	member := Human(ub.ID)
	if _, err := s.ListTaskStatuses(ctx, member, w.ID, false); err != nil {
		t.Fatalf("member lists statuses: %v", err)
	}
	if _, err := s.ListTaskLabels(ctx, member, w.ID, false); err != nil {
		t.Fatalf("member lists labels: %v", err)
	}
	if _, err := s.UpdateTaskStatus(ctx, owner, w.ID, st.ID, UpdateTaskStatusInput{Name: &name}); err != nil {
		t.Fatalf("owner updates status: %v", err)
	}
	if err := s.DeleteTaskLabel(ctx, owner, w.ID, label.ID); err != nil {
		t.Fatalf("owner deletes label: %v", err)
	}
}

// A custom status picks its own glyph (empty = its category's) and can move
// to another category, landing after that category's statuses.
func TestCustomTaskStatusIconAndCategory(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	owner := Human(ua.ID)

	st, err := s.CreateTaskStatus(ctx, owner, w.ID, CreateTaskStatusInput{
		Name: "QA", Category: "in_review", Color: "#22c55e", Icon: "blocked",
	})
	if err != nil {
		t.Fatal(err)
	}
	if st.Icon != "blocked" {
		t.Fatalf("icon = %q, want blocked", st.Icon)
	}
	if _, err := s.CreateTaskStatus(ctx, owner, w.ID, CreateTaskStatusInput{
		Name: "Bad", Category: "todo", Color: "#22c55e", Icon: "star",
	}); err == nil {
		t.Fatal("unknown icon accepted")
	}

	done, empty, bogus := "done", "", "later"
	moved, err := s.UpdateTaskStatus(ctx, owner, w.ID, st.ID, UpdateTaskStatusInput{Category: &done, Icon: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Category != "done" || moved.Icon != "" {
		t.Fatalf("moved = category %q icon %q", moved.Category, moved.Icon)
	}
	builtIn, err := s.q.GetTaskStatusByKey(ctx, db.GetTaskStatusByKeyParams{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID, Key: "done",
	})
	if err != nil {
		t.Fatal(err)
	}
	if moved.Position <= builtIn.Position {
		t.Fatalf("position = %v, want after the built-in done (%v)", moved.Position, builtIn.Position)
	}
	if _, err := s.UpdateTaskStatus(ctx, owner, w.ID, st.ID, UpdateTaskStatusInput{Category: &bogus}); err == nil {
		t.Fatal("unknown category accepted")
	}
}

// A group's statuses, built-ins included, take any order inside the group's
// position band; the band keeps groups apart on the board and in pickers.
func TestReorderTaskStatusesWithinGroupMovesBuiltIns(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	owner := Human(ua.ID)
	qa, err := s.CreateTaskStatus(ctx, owner, w.ID, CreateTaskStatusInput{Name: "QA", Category: "in_review", Color: "#22c55e"})
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]string{}
	list, err := s.ListTaskStatuses(ctx, owner, w.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, st := range list {
		byKey[st.Key] = st.ID
	}
	if list[len(list)-3].ID != qa.ID {
		t.Fatalf("new status should close its group (before done), got order %v", keysOf(list))
	}

	order := []string{byKey["blocked"], byKey["in_progress"], qa.ID, byKey["in_review"]}
	got, err := s.ReorderTaskStatuses(ctx, owner, w.ID, ReorderTaskStatusesInput{Group: "started", IDs: order})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(order) {
		t.Fatalf("got %d statuses, want %d", len(got), len(order))
	}
	for i, st := range got {
		if st.ID != order[i] {
			t.Fatalf("order = %v", keysOf(got))
		}
		if st.Position <= 2048 || st.Position >= 4096 {
			t.Fatalf("%s position %v left the started band", st.Key, st.Position)
		}
	}

	if _, err := s.ReorderTaskStatuses(ctx, owner, w.ID, ReorderTaskStatusesInput{Group: "started", IDs: order[:3]}); err == nil {
		t.Fatal("a partial group was accepted")
	}
	if _, err := s.ReorderTaskStatuses(ctx, owner, w.ID, ReorderTaskStatusesInput{Group: "started", IDs: append(order[1:], byKey["done"])}); err == nil {
		t.Fatal("a status from another group was accepted")
	}
	if _, err := s.ReorderTaskStatuses(ctx, owner, w.ID, ReorderTaskStatusesInput{Group: "later", IDs: order}); err == nil {
		t.Fatal("an unknown group was accepted")
	}
}

func keysOf(list []db.TaskStatus) []string {
	out := make([]string, len(list))
	for i, st := range list {
		out[i] = st.Key
	}
	return out
}
