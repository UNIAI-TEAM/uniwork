package notification

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fixture builds an organization with a workspace, an owner and a member,
// through the real services so every event under test comes out of the
// outbox exactly as it would in production.
type fixture struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	q        *db.Queries
	ws       *service.WorkspaceService
	tasks    *service.TaskService
	meetings *service.MeetingService
	consumer *Consumer
	owner    db.User
	member   db.User
	orgID    string
	wsID     string
}

type fakeOutbox struct{ sent []mail.Message }

func (f *fakeOutbox) Enqueue(_ context.Context, _ *db.Queries, m mail.Message) (string, error) {
	f.sent = append(f.sent, m)
	return "m", nil
}
func (*fakeOutbox) Kick() {}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	auth := service.NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := service.NewOrganizationService(pool, q)
	ws := service.NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	f := &fixture{ctx: ctx, pool: pool, q: q, ws: ws,
		tasks:    service.NewTaskService(pool, q, ws, nil),
		meetings: service.NewMeetingService(pool, q, ws, service.NopPublisher{}, nil, service.MeetingRuntime{}),
		consumer: NewConsumer(pool, q, ws),
	}
	f.owner = f.register(t, auth, "owner@example.com", "Chủ Nhóm")
	f.member = f.register(t, auth, "member@example.com", "Thành Viên")
	org, err := orgs.Create(ctx, f.owner.ID, "Notif Org", "notif-org")
	if err != nil {
		t.Fatal(err)
	}
	f.orgID = org.ID
	v, err := ws.CreateInOrg(ctx, f.owner.ID, org.ID, "Notif WS", "notif-ws")
	if err != nil {
		t.Fatal(err)
	}
	f.wsID = v.Workspace.ID
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org.ID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) register(t *testing.T, auth *service.AuthService, email, name string) db.User {
	t.Helper()
	s, err := auth.Register(f.ctx, email, "password123", name, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u, err := f.q.MarkEmailVerified(f.ctx, s.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// events returns every outbox row on topic, oldest first.
func (f *fixture) events(t *testing.T, topic string) []outbox.Row {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `SELECT * FROM outbox_events WHERE topic = $1 ORDER BY id`, topic)
	if err != nil {
		t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByName[db.OutboxEvent])
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// lastEvent is the newest outbox row on topic; the test fails if none exists.
func (f *fixture) lastEvent(t *testing.T, topic string) outbox.Row {
	t.Helper()
	evs := f.events(t, topic)
	if len(evs) == 0 {
		t.Fatalf("no %s event", topic)
	}
	return evs[len(evs)-1]
}

func (f *fixture) handleLast(t *testing.T, topic string) {
	t.Helper()
	if err := f.consumer.Handle(f.ctx, f.lastEvent(t, topic)); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) inbox(t *testing.T, userID string) []db.Notification {
	t.Helper()
	rows, err := f.q.ListNotifications(f.ctx, db.ListNotificationsParams{UserID: userID, LimitN: 50})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func (f *fixture) newTask(t *testing.T, title string) db.Task {
	t.Helper()
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func (f *fixture) assign(t *testing.T, taskID, userID string) {
	t.Helper()
	p := &userID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), taskID, service.UpdateTaskInput{AssigneeID: &p}); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) setStatus(t *testing.T, actorID, taskID, status string) {
	t.Helper()
	if _, err := f.tasks.Update(f.ctx, service.Human(actorID), taskID, service.UpdateTaskInput{Status: &status}); err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) ownerActor() service.Actor  { return service.Human(f.owner.ID) }
func (f *fixture) memberActor() service.Actor { return service.Human(f.member.ID) }

func repeat(s string, n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += s
	}
	return out
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
