package service

import (
	"context"
	"testing"
	"time"

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

	task, err := s.Create(ctx, ua.ID, w.ID, CreateTaskInput{Title: "Việc 1", Priority: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "todo" || task.Priority != "high" {
		t.Fatalf("defaults: %+v", task)
	}
	// non-member bị chặn
	if _, err := s.Create(ctx, ub.ID, w.ID, CreateTaskInput{Title: "X"}); err != ErrForbidden {
		t.Fatalf("non-member create: %v", err)
	}
	if _, err := s.Get(ctx, ub.ID, task.ID); err != ErrForbidden {
		t.Fatalf("non-member get: %v", err)
	}

	// update status + position
	st, pos := "in_progress", 10.5
	up, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{Status: &st, Position: &pos})
	if err != nil || up.Status != "in_progress" || up.Position != 10.5 {
		t.Fatalf("update: %v %+v", err, up)
	}
	bad := "not-a-status"
	if _, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{Status: &bad}); err == nil {
		t.Fatal("invalid status accepted")
	}

	// assignee set và clear qua con trỏ kép
	aid := &ua.ID
	set, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{AssigneeID: &aid})
	if err != nil || !set.AssigneeID.Valid || set.AssigneeID.String != ua.ID {
		t.Fatalf("set assignee: %v %+v", err, set.AssigneeID)
	}
	var nilStr *string
	cleared, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{AssigneeID: &nilStr})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.AssigneeID.Valid {
		t.Fatal("assignee not cleared")
	}

	// due date set và clear
	dd := "2026-09-01"
	ddp := &dd
	withDue, err := s.Update(ctx, ua.ID, task.ID, UpdateTaskInput{DueDate: &ddp})
	if err != nil || !withDue.DueDate.Valid {
		t.Fatalf("set due: %v", err)
	}

	// comments
	if _, err := s.AddComment(ctx, ua.ID, task.ID, "chú thích"); err != nil {
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
