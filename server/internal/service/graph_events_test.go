package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func topicsLike(t *testing.T, pool *pgxpool.Pool, orgID, pattern string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT topic FROM outbox_events WHERE organization_id = $1 AND topic LIKE $2 ORDER BY created_at, id`, orgID, pattern)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// Agents and thread unsync now reach the outbox; the Work Graph projects
// ACTOR nodes and DISCUSSED_IN edges from them (C-11 §5.2).
func TestGraphSourceEventsReachTheOutbox(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	owner := registerVerified(t, q, as, "graph-events@example.com", "Chủ")
	org, err := orgs.Create(ctx, owner.ID, "Graph Org", "graph-org")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, owner.ID, org.ID, "Graph WS", "graph-ws")
	if err != nil {
		t.Fatal(err)
	}
	agents := NewAgentService(pool, q, orgs, ws)
	a, err := agents.Create(ctx, owner.ID, org.ID, CreateAgentInput{Name: "Trợ lý", Handle: "tro-ly"})
	if err != nil {
		t.Fatal(err)
	}
	name := "Trợ lý 2"
	if _, err := agents.Update(ctx, owner.ID, a.ID, UpdateAgentInput{Name: &name}); err != nil {
		t.Fatal(err)
	}
	archived := "archived"
	if _, err := agents.Update(ctx, owner.ID, a.ID, UpdateAgentInput{Status: &archived}); err != nil {
		t.Fatal(err)
	}
	// The default agent comes first (organization create), then the three commands.
	got := topicsLike(t, pool, org.ID, "agent.%")
	want := []string{"agent.created", "agent.created", "agent.updated", "agent.archived"}
	if len(got) != len(want) {
		t.Fatalf("agent topics = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("agent topics = %v, want %v", got, want)
		}
	}

	tasks := NewTaskService(pool, q, ws, nil)
	chat := NewChatService(pool, q, ws, NopPublisher{})
	chat.SetTasks(tasks)
	ch, err := chat.CreateChannel(ctx, owner.ID, v.Workspace.ID, CreateChannelInput{Name: "graph-sync", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := chat.SendRoomMessage(ctx, owner.ID, v.Workspace.ID, ch.ID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(owner.ID), v.Workspace.ID, CreateTaskInput{Title: "synced"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.SyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID, SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	if err := chat.UnsyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	if got := topicsLike(t, pool, org.ID, "chat.thread.%linked"); len(got) != 2 || got[1] != "chat.thread.unlinked" {
		t.Fatalf("thread topics = %v", got)
	}
	if err := chat.UnsyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID); err == nil {
		t.Fatal("a second unsync must answer not found")
	}

	// The default workspace room is created lazily; it now says so.
	room, err := chat.EnsureWorkspaceRoom(ctx, owner.ID, v.Workspace.ID)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'chat.room.created' AND payload::jsonb->>'room_id' = $1`,
		room.RoomID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("chat.room.created rows for the workspace room = %d", n)
	}
	if _, err := chat.EnsureWorkspaceRoom(ctx, owner.ID, v.Workspace.ID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'chat.room.created' AND payload::jsonb->>'room_id' = $1`,
		room.RoomID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("a second ensure must not emit again: %d (%v)", n, err)
	}
}
