package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type capturePublisher struct{ events []Event }

func (c *capturePublisher) Publish(_ context.Context, _ string, ev Event) {
	c.events = append(c.events, ev)
}

func (c *capturePublisher) PublishToScope(_ context.Context, _, _ string, ev Event) {
	c.events = append(c.events, ev)
}

func (c *capturePublisher) SendToUser(_ context.Context, _ string, ev Event) {
	c.events = append(c.events, ev)
}

// outboxCapture drains the outbox through the real realtime consumer, so a
// test that asks "was the client told" exercises the delivery path the server
// actually uses instead of a publisher call the service no longer makes.
type outboxCapture struct {
	d   *outbox.Dispatcher
	pub *capturePublisher
}

func newOutboxCapture(pool *pgxpool.Pool, q *db.Queries) *outboxCapture {
	pub := &capturePublisher{}
	d := outbox.New(pool, q, outbox.Options{})
	d.Register(outbox.NewRealtimeConsumer(RealtimePublisher{Pub: pub}))
	return &outboxCapture{d: d, pub: pub}
}

// drain delivers everything pending and returns what reached the client.
func (c *outboxCapture) drain(t *testing.T) []Event {
	t.Helper()
	if err := c.d.Process(context.Background(), 100); err != nil {
		t.Fatal(err)
	}
	return c.pub.events
}

// fixture: user A (member), user B (ngoài), workspace của A
func taskFixture(t *testing.T) (*TaskService, *outboxCapture, db.User, db.User, db.Workspace) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "a@example.com", "A")
	ub := registerVerified(t, q, as, "b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-alpha")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	w := v.Workspace
	return NewTaskService(pool, q, ws), newOutboxCapture(pool, q), ua, ub, w
}

func TestTaskCRUD(t *testing.T) {
	s, events, ua, ub, w := taskFixture(t)
	ctx := context.Background()

	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Việc 1", Priority: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "todo" || task.Priority != "high" {
		t.Fatalf("defaults: %+v", task)
	}
	// non-member bị chặn
	if _, err := s.Create(ctx, Human(ub.ID), w.ID, CreateTaskInput{Title: "X"}); err != ErrForbidden {
		t.Fatalf("non-member create: %v", err)
	}
	if _, err := s.Get(ctx, ub.ID, task.ID); err != ErrForbidden {
		t.Fatalf("non-member get: %v", err)
	}

	// update status + position
	st, pos := "in_progress", 10.5
	up, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Status: &st, Position: &pos})
	if err != nil || up.Status != "in_progress" || up.Position != 10.5 {
		t.Fatalf("update: %v %+v", err, up)
	}
	bad := "not-a-status"
	if _, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Status: &bad}); err == nil {
		t.Fatal("invalid status accepted")
	}

	// assignee set và clear qua con trỏ kép
	aid := &ua.ID
	set, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{AssigneeID: &aid})
	if err != nil || !set.AssigneeID.Valid || set.AssigneeID.String != ua.ID {
		t.Fatalf("set assignee: %v %+v", err, set.AssigneeID)
	}
	var nilStr *string
	cleared, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{AssigneeID: &nilStr})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.AssigneeID.Valid {
		t.Fatal("assignee not cleared")
	}

	// due date set và clear
	dd := "2026-09-01"
	ddp := &dd
	withDue, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{DueDate: &ddp})
	if err != nil || !withDue.DueDate.Valid {
		t.Fatalf("set due: %v", err)
	}

	// comments
	if _, err := s.AddComment(ctx, Human(ua.ID), task.ID, "chú thích"); err != nil {
		t.Fatal(err)
	}
	cs, err := s.Comments(ctx, ua.ID, task.ID)
	if err != nil || len(cs) != 1 {
		t.Fatalf("comments: %v n=%d", err, len(cs))
	}

	if err := s.Delete(ctx, ua.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, ua.ID, task.ID); err != ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}

	// Every command left an event on the outbox, and draining it delivers the
	// catalogue topic to the workspace scope.
	delivered := events.drain(t)
	types := map[string]bool{}
	for _, e := range delivered {
		types[e.Type] = true
	}
	for _, want := range []string{"task.created", "task.updated", "task.comment_added", "task.deleted"} {
		if !types[want] {
			t.Fatalf("missing event %s (got %v)", want, delivered)
		}
	}
}

func TestTaskNumbersAreAtomicPerWorkspace(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	const count = 12
	numbers := make(chan int64, count)
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		go func(i int) {
			task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: fmt.Sprintf("T-%d", i)})
			if err != nil {
				errs <- err
				return
			}
			numbers <- task.Number
		}(i)
	}
	seen := map[int64]bool{}
	for i := 0; i < count; i++ {
		select {
		case err := <-errs:
			t.Fatal(err)
		case number := <-numbers:
			if seen[number] {
				t.Fatalf("duplicate number %d", number)
			}
			seen[number] = true
		}
	}

	_, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Outsider", AssigneeID: &ub.ID})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "assignee_not_member" {
		t.Fatalf("outsider assignee: %v", err)
	}
}

// TestTaskFoundationTenantIsolation proves org/workspace-scoped task,
// status, project and resource queries never return the other tenant's rows.
// GetTask is id-only authorize and is intentionally not the isolation evidence.
func TestTaskFoundationTenantIsolation(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	tasks := NewTaskService(pool, q, ws)
	ctx := context.Background()

	ua := registerVerified(t, q, as, "iso-a@example.com", "A")
	ub := registerVerified(t, q, as, "iso-b@example.com", "B")
	orgA, err := orgs.Create(ctx, ua.ID, "Org A", "iso-org-a")
	if err != nil {
		t.Fatal(err)
	}
	orgB, err := orgs.Create(ctx, ub.ID, "Org B", "iso-org-b")
	if err != nil {
		t.Fatal(err)
	}
	wsA, err := ws.CreateInOrg(ctx, ua.ID, orgA.ID, "Alpha", "iso-alpha")
	if err != nil {
		t.Fatal(err)
	}
	wsB, err := ws.CreateInOrg(ctx, ub.ID, orgB.ID, "Beta", "iso-beta")
	if err != nil {
		t.Fatal(err)
	}

	taskA, err := tasks.Create(ctx, Human(ua.ID), wsA.Workspace.ID, CreateTaskInput{Title: "A only"})
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := tasks.Create(ctx, Human(ub.ID), wsB.Workspace.ID, CreateTaskInput{Title: "B only"})
	if err != nil {
		t.Fatal(err)
	}

	same, err := q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
		ID: taskA.ID, OrganizationID: orgA.ID, WorkspaceID: wsA.Workspace.ID,
	})
	if err != nil || same.ID != taskA.ID {
		t.Fatalf("same-tenant GetTaskInWorkspace: err=%v id=%q", err, same.ID)
	}

	_, err = q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
		ID: taskB.ID, OrganizationID: orgA.ID, WorkspaceID: wsA.Workspace.ID,
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetTaskInWorkspace cross-tenant: %v", err)
	}

	listed, err := q.ListTasksByWorkspace(ctx, db.ListTasksByWorkspaceParams{
		OrganizationID: orgA.ID, WorkspaceID: wsA.Workspace.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range listed {
		if row.ID == taskB.ID {
			t.Fatal("ListTasksByWorkspace returned tenant B task")
		}
	}

	crossList, err := q.ListTasksByWorkspace(ctx, db.ListTasksByWorkspaceParams{
		OrganizationID: orgA.ID, WorkspaceID: wsB.Workspace.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(crossList) != 0 {
		t.Fatalf("org/ws mismatch list returned %d rows", len(crossList))
	}

	_, err = q.UpdateTask(ctx, db.UpdateTaskParams{
		Title:          pgtype.Text{String: "leak", Valid: true},
		ID:             taskB.ID,
		OrganizationID: orgA.ID,
		WorkspaceID:    wsA.Workspace.ID,
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("UpdateTask cross-tenant: %v", err)
	}
	stillB, err := q.GetTask(ctx, taskB.ID)
	if err != nil || stillB.Title != "B only" {
		t.Fatalf("cross-tenant update mutated B: err=%v title=%q", err, stillB.Title)
	}

	_, err = q.GetTaskStatusByKey(ctx, db.GetTaskStatusByKeyParams{
		OrganizationID: orgA.ID, WorkspaceID: wsB.Workspace.ID, Key: "todo",
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetTaskStatusByKey org/ws mismatch: %v", err)
	}
	_, err = q.GetTaskStatusByKey(ctx, db.GetTaskStatusByKeyParams{
		OrganizationID: orgB.ID, WorkspaceID: wsA.Workspace.ID, Key: "todo",
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetTaskStatusByKey swapped tenants: %v", err)
	}

	projectB, err := q.CreateProject(ctx, db.CreateProjectParams{
		ID:             "01PROJ0000000000000000000B",
		OrganizationID: orgB.ID,
		WorkspaceID:    wsB.Workspace.ID,
		Title:          "B project",
		Status:         "planned",
		Priority:       "none",
		Revision:       1,
		CreatedBy:      ub.ID,
		CreatedByKind:  "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.GetProject(ctx, db.GetProjectParams{
		ID: projectB.ID, OrganizationID: orgA.ID, WorkspaceID: wsA.Workspace.ID,
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("GetProject cross-tenant: %v", err)
	}

	_, err = q.CreateProjectResource(ctx, db.CreateProjectResourceParams{
		ID:             "01PRES0000000000000000000B",
		OrganizationID: orgB.ID,
		WorkspaceID:    wsB.Workspace.ID,
		ProjectID:      projectB.ID,
		ResourceType:   "github_repo",
		ResourceRef:    []byte(`{"url":"https://example.com/b.git"}`),
		CreatedBy:      ub.ID,
		CreatedByKind:  "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	resources, err := q.ListProjectResources(ctx, db.ListProjectResourcesParams{
		ProjectID: projectB.ID, OrganizationID: orgA.ID, WorkspaceID: wsA.Workspace.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resources) != 0 {
		t.Fatalf("ListProjectResources cross-tenant returned %d rows", len(resources))
	}
}
