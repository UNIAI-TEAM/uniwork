package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type graphFlagsOn bool

func (f graphFlagsOn) IsEnabled(context.Context, string, bool) bool { return bool(f) }

type graphDrops struct{ n map[string]int }

func (d *graphDrops) IncGraphLayer2Dropped(nodeType string) { d.n[nodeType]++ }

type graphWorld struct {
	ctx           context.Context
	q             *db.Queries
	svc           *GraphService
	tasks         *TaskService
	chat          *ChatService
	drops         *graphDrops
	owner, member db.User
	orgID, wsID   string
	rebuild       func(t *testing.T)
}

func newGraphWorld(t *testing.T) *graphWorld {
	t.Helper()
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	w := &graphWorld{ctx: ctx, q: q, tasks: NewTaskService(pool, q, ws, nil), chat: NewChatService(pool, q, ws, NopPublisher{}),
		drops: &graphDrops{n: map[string]int{}}}
	w.chat.SetTasks(w.tasks)
	w.svc = NewGraphService(q, orgs, ws, w.chat)
	w.svc.SetFlags(graphFlagsOn(true))
	w.svc.SetMetrics(w.drops)
	w.owner = registerVerified(t, q, as, "graph-read-owner@example.com", "Chủ")
	w.member = registerVerified(t, q, as, "graph-read-member@example.com", "Bình")
	org, err := orgs.Create(ctx, w.owner.ID, "Graph Read", "graph-read")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, w.owner.ID, org.ID, "Graph Read WS", "graph-read-ws")
	if err != nil {
		t.Fatal(err)
	}
	w.orgID, w.wsID = org.ID, v.Workspace.ID
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org.ID, UserID: w.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.wsID, OrganizationID: org.ID, UserID: w.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	w.rebuild = func(t *testing.T) {
		t.Helper()
		if _, err := projector.RebuildOrg(ctx, pool, q, org.ID, projector.RebuildOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// threadIDs is the THREAD neighbors a user sees around a task.
func (w *graphWorld) threadIDs(t *testing.T, userID, taskID string) []string {
	t.Helper()
	page, err := w.svc.Neighbors(w.ctx, userID, w.wsID, "TASK", taskID, GraphNeighborsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, it := range page.Items {
		if it.Node.Type == "THREAD" {
			out = append(out, it.Node.ID)
		}
	}
	return out
}

func (w *graphWorld) privateThreadTask(t *testing.T, members []string) (roomID, taskID string) {
	t.Helper()
	ch, err := w.chat.CreateChannel(w.ctx, w.owner.ID, w.wsID, CreateChannelInput{Name: "kin", Visibility: "private", MemberUserIDs: members})
	if err != nil {
		t.Fatal(err)
	}
	root, err := w.chat.SendRoomMessage(w.ctx, w.owner.ID, w.wsID, ch.ID, SendChatMessageInput{Body: "bàn riêng"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: "Việc chung"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.chat.SyncThreadTask(w.ctx, w.owner.ID, w.wsID, root.ID, SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	return ch.ID, task.ID
}

func TestGraphNeighborsHidePrivateRoomsFromNonMembers(t *testing.T) {
	w := newGraphWorld(t)
	room, task := w.privateThreadTask(t, nil)
	w.rebuild(t)
	if got := w.threadIDs(t, w.owner.ID, task); len(got) != 1 || got[0] != room {
		t.Fatalf("owner threads = %v", got)
	}
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 0 {
		t.Fatalf("member sees a private room: %v", got)
	}
}

func TestGraphNeighborsLayerTwoDropsStaleReaders(t *testing.T) {
	w := newGraphWorld(t)
	room, task := w.privateThreadTask(t, []string{w.member.ID})
	w.rebuild(t)
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 1 {
		t.Fatalf("member threads before the kick = %v", got)
	}
	// A kick writes no event (spec §5.2): reader_ids still name the member.
	if err := w.q.LeaveChatRoomMember(w.ctx, db.LeaveChatRoomMemberParams{RoomID: room, UserID: w.member.ID}); err != nil {
		t.Fatal(err)
	}
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 0 {
		t.Fatalf("member still sees the room after the kick: %v", got)
	}
	if w.drops.n["THREAD"] != 1 {
		t.Fatalf("layer 2 drops = %v", w.drops.n)
	}
}

func TestGraphNeighborsRefusals(t *testing.T) {
	w := newGraphWorld(t)
	_, task := w.privateThreadTask(t, nil)
	w.rebuild(t)
	if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", "missing", GraphNeighborsQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown node err = %v", err)
	}
	if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "task", task, GraphNeighborsQuery{}); err == nil {
		t.Fatal("lower-case type must be invalid")
	}
	w.svc.SetFlags(graphFlagsOn(false))
	_, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", task, GraphNeighborsQuery{})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != 404 || ce.Code != "feature_disabled" {
		t.Fatalf("flag off err = %v", err)
	}
}

func TestGraphHistoryShowsReassignment(t *testing.T) {
	w := newGraphWorld(t)
	task, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: "Đổi người", AssigneeID: &w.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	w.rebuild(t)
	owner := &w.owner.ID
	if _, err := w.tasks.Update(w.ctx, Human(w.owner.ID), task.ID, UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	w.rebuild(t)
	h, err := w.svc.History(w.ctx, w.owner.ID, w.wsID, "TASK", task.ID, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	// Asserted by state, not order: the DB and Go clocks may differ by a few ms.
	var closed, open []string
	for _, it := range h.Items {
		if it.EdgeType != "OWNED_BY" {
			continue
		}
		if it.ValidTo != nil {
			closed = append(closed, it.Node.ID)
		} else {
			open = append(open, it.Node.ID)
		}
	}
	if len(closed) != 1 || closed[0] != w.member.ID || len(open) != 1 || open[0] != w.owner.ID {
		t.Fatalf("OWNED_BY history closed=%v open=%v", closed, open)
	}
}

type graphFlagStore struct{ rows []db.FeatureFlagOverride }

func (s graphFlagStore) ListActiveFlagOverrides(context.Context) ([]db.FeatureFlagOverride, error) {
	return s.rows, nil
}

// graph_ui is read for the caller and the caller's organization, through the
// real flag service: the organization override turns it on while the global
// one says off, and a user override beats the organization.
func TestGraphUIFlagIsReadForTheCallerAndOrganization(t *testing.T) {
	w := newGraphWorld(t)
	_, task := w.privateThreadTask(t, nil)
	w.rebuild(t)
	flags, _, err := featureflags.NewService(graphFlagStore{rows: []db.FeatureFlagOverride{
		{FlagKey: "graph_ui", ScopeType: featureflags.ScopeGlobal, Enabled: false},
		{FlagKey: "graph_ui", ScopeType: featureflags.ScopeOrganization, ScopeID: w.orgID, Enabled: true},
		{FlagKey: "graph_ui", ScopeType: featureflags.ScopeUser, ScopeID: w.member.ID, Enabled: false},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	w.svc.SetFlags(flags)
	if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", task, GraphNeighborsQuery{}); err != nil {
		t.Fatalf("owner with the organization on: %v", err)
	}
	_, err = w.svc.Neighbors(w.ctx, w.member.ID, w.wsID, "TASK", task, GraphNeighborsQuery{})
	if !codedIs(err, "feature_disabled") {
		t.Fatalf("member turned off by a user override: %v", err)
	}
}

// Neighbors pages by (valid_from, edge id) without repeats or gaps, and the
// direction, edge type and at filters narrow the same set.
func TestGraphNeighborsPagesAndFilters(t *testing.T) {
	w := newGraphWorld(t)
	parent, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: "Việc cha", AssigneeID: &w.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	children := map[string]bool{}
	for _, title := range []string{"Con một", "Con hai", "Con ba"} {
		c, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: title, ParentTaskID: &parent.ID})
		if err != nil {
			t.Fatal(err)
		}
		children[c.ID] = true
	}
	w.rebuild(t)
	list := func(in GraphNeighborsQuery) GraphNeighborsPage {
		t.Helper()
		page, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", parent.ID, in)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}

	seen := map[string]bool{}
	cursor, pages := "", 0
	for {
		page := list(GraphNeighborsQuery{Limit: 2, Cursor: cursor})
		pages++
		for _, it := range page.Items {
			if seen[it.Node.ID] {
				t.Fatalf("%s repeated on page %d", it.Node.ID, pages)
			}
			seen[it.Node.ID] = true
		}
		if page.NextCursor == "" || pages > 5 {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != 4 || !seen[w.member.ID] || pages != 3 {
		t.Fatalf("paged %d nodes over %d pages: %v", len(seen), pages, seen)
	}

	out := list(GraphNeighborsQuery{Direction: "out"})
	if len(out.Items) != 1 || out.Items[0].EdgeType != "OWNED_BY" || out.Items[0].Node.ID != w.member.ID || out.Items[0].Direction != "out" {
		t.Fatalf("out = %+v", out.Items)
	}
	in := list(GraphNeighborsQuery{Direction: "in", EdgeTypes: []string{"BELONGS_TO"}})
	if len(in.Items) != 3 {
		t.Fatalf("in BELONGS_TO = %+v", in.Items)
	}
	for _, it := range in.Items {
		if !children[it.Node.ID] || it.Direction != "in" {
			t.Fatalf("in item = %+v", it)
		}
	}
	if got := list(GraphNeighborsQuery{EdgeTypes: []string{"DEPENDS_ON"}}); len(got.Items) != 0 {
		t.Fatalf("DEPENDS_ON = %+v", got.Items)
	}
	if got := list(GraphNeighborsQuery{At: parent.CreatedAt.Time.Add(-time.Hour)}); len(got.Items) != 0 {
		t.Fatalf("an hour before the task = %+v", got.Items)
	}

	for _, bad := range []GraphNeighborsQuery{{Direction: "sideways"}, {EdgeTypes: []string{"RELATED_TO"}}, {Cursor: "x"}, {Cursor: "1."}} {
		_, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", parent.ID, bad)
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("%+v err = %v", bad, err)
		}
	}
}
