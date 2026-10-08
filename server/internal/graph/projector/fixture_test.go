package projector

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fixture builds an organization through the real services, so every event
// under test comes out of the outbox as in production, then runs the marker
// and the worker until nothing is dirty.
type fixture struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	q        *db.Queries
	auth     *service.AuthService
	ws       *service.WorkspaceService
	tasks    *service.TaskService
	meetings *service.MeetingService
	chat     *service.ChatService
	depts    *service.DepartmentService
	people   *service.PeopleService
	disp     *outbox.Dispatcher
	marker   *Marker
	worker   *Worker
	owner    db.User
	member   db.User
	orgID    string
	wsID     string
}

type fakeOutbox struct{}

func (fakeOutbox) Enqueue(context.Context, *db.Queries, mail.Message) (string, error) {
	return "m", nil
}
func (fakeOutbox) Kick() {}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	auth := service.NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := service.NewOrganizationService(pool, q)
	ws := service.NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, fakeOutbox{})
	f := &fixture{ctx: ctx, pool: pool, q: q, auth: auth, ws: ws,
		tasks:    service.NewTaskService(pool, q, ws, nil),
		meetings: service.NewMeetingService(pool, q, ws, service.NopPublisher{}, nil, service.MeetingRuntime{}),
		chat:     service.NewChatService(pool, q, ws, service.NopPublisher{}),
		depts:    service.NewDepartmentService(pool, q, orgs),
		people:   service.NewPeopleService(pool, q, orgs),
	}
	f.chat.SetTasks(f.tasks)
	// CreateTasksFromSummary answers 503 without a task service.
	f.meetings.Tasks = f.tasks
	f.marker = NewMarker(q, func(context.Context, string) bool { return true })
	f.worker = NewWorker(pool, q)
	f.disp = outbox.New(pool, q, outbox.Options{})
	f.disp.Register(f.marker)
	f.owner = f.register(t, auth, "graph-owner@example.com", "Chủ Nhóm")
	f.member = f.register(t, auth, "graph-member@example.com", "Thành Viên")
	org, err := orgs.Create(ctx, f.owner.ID, "Graph Org", "graph-org")
	if err != nil {
		t.Fatal(err)
	}
	f.orgID = org.ID
	v, err := ws.CreateInOrg(ctx, f.owner.ID, org.ID, "Graph WS", "graph-ws")
	if err != nil {
		t.Fatal(err)
	}
	f.wsID = v.Workspace.ID
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org.ID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: org.ID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	// The member was added with direct queries; hand the marker the
	// member.joined row the invite flow would have written.
	if err := f.marker.Handle(ctx, db.OutboxEvent{ID: "seed-member-joined", Topic: "member.joined",
		Payload:        `{"organization_id":"` + org.ID + `","user_id":"` + f.member.ID + `"}`,
		OrganizationID: pgtype.Text{String: org.ID, Valid: true},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true}}); err != nil {
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

// sync drains the outbox through the marker, then the worker, until neither
// has anything left (projecting one node may mark its peers).
func (f *fixture) sync(t *testing.T) {
	t.Helper()
	for round := 0; round < 10; round++ {
		if err := f.disp.Process(f.ctx, 500); err != nil {
			t.Fatal(err)
		}
		n, err := f.worker.Drain(f.ctx, 100)
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			// Drain logs a failed projection and reschedules it; fail here so
			// the test reports the error, not the edge it left missing.
			var failed string
			if err := f.pool.QueryRow(f.ctx, `SELECT COALESCE(string_agg(node_type || ' ' || source_id || ': ' || last_error, '; '), '')
				FROM graph_dirty WHERE last_error <> ''`).Scan(&failed); err != nil {
				t.Fatal(err)
			}
			if failed != "" {
				t.Fatalf("projection failed: %s", failed)
			}
			return
		}
	}
	t.Fatal("graph did not settle in 10 rounds")
}

// openEdges lists a node's open edges as "TYPE>PEER_TYPE:peer" (outgoing) or
// "TYPE<PEER_TYPE:peer" (incoming), sorted.
func (f *fixture) openEdges(t *testing.T, typ graph.NodeType, sourceID string) []string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT e.edge_type, e.from_node = n.id, p.node_type, p.source_id
		FROM graph_nodes n
		JOIN graph_edges e ON (e.from_node = n.id OR e.to_node = n.id) AND e.valid_to IS NULL
		JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = n.id THEN e.to_node ELSE e.from_node END
		WHERE n.organization_id = $1 AND n.node_type = $2 AND n.source_id = $3`, f.orgID, string(typ), sourceID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var et, pt, ps string
		var outgoing bool
		if err := rows.Scan(&et, &outgoing, &pt, &ps); err != nil {
			t.Fatal(err)
		}
		arrow := "<"
		if outgoing {
			arrow = ">"
		}
		out = append(out, fmt.Sprintf("%s%s%s:%s", et, arrow, pt, ps))
	}
	sort.Strings(out)
	return out
}

// openFacts returns fact type → value for the node's open facts.
func (f *fixture) openFacts(t *testing.T, typ graph.NodeType, sourceID string) map[string]string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT x.fact_type, x.value FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id
		WHERE n.organization_id = $1 AND n.node_type = $2 AND n.source_id = $3 AND x.valid_to IS NULL`,
		f.orgID, string(typ), sourceID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatal(err)
		}
		out[k] = v
	}
	return out
}

// dueFacts lists a task's due facts, closed first then by valid_from, as
// "open|closed VALUE PRECISION".
func (f *fixture) dueFacts(t *testing.T, taskID string) []string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT x.valid_to IS NULL, x.value, COALESCE(x.attrs->>'precision', '')
		FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id
		WHERE n.organization_id = $1 AND n.node_type = $2 AND n.source_id = $3 AND x.fact_type = 'due'
		ORDER BY x.valid_to IS NULL, x.valid_from, x.recorded_at`,
		f.orgID, string(graph.NodeTask), taskID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var open bool
		var value, precision string
		if err := rows.Scan(&open, &value, &precision); err != nil {
			t.Fatal(err)
		}
		state := "closed"
		if open {
			state = "open"
		}
		out = append(out, state+" "+value+" "+precision)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// project runs Project for one node in its own transaction, as the worker does.
func (f *fixture) project(t *testing.T, ref NodeRef, ev EventInfo) Drift {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	d, err := Project(f.ctx, f.q.WithTx(tx), f.orgID, ref, ev)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	return d
}

func (f *fixture) verify(t *testing.T, ref NodeRef) Drift {
	t.Helper()
	d, err := Verify(f.ctx, f.q, f.orgID, ref)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// exec changes rows directly, to stage a state no service call produces.
func (f *fixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func outboxEvent(id string) EventInfo {
	return EventInfo{EvidenceKind: EvidenceOutboxEvent, EvidenceID: id, At: time.Now()}
}

func (f *fixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func eq(t *testing.T, what string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s = %v, want %v", what, got, want)
		}
	}
}

func ptr[T any](v T) *T { return &v }
