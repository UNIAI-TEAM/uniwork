package service

import (
	"context"
	"errors"
	"maps"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
	pool          *pgxpool.Pool
	q             *db.Queries
	svc           *GraphService
	ws            *WorkspaceService
	tasks         *TaskService
	chat          *ChatService
	meetings      *MeetingService
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
	w := &graphWorld{ctx: ctx, pool: pool, q: q, ws: ws, tasks: NewTaskService(pool, q, ws, nil), chat: NewChatService(pool, q, ws, NopPublisher{}),
		meetings: NewMeetingService(pool, q, ws, NopPublisher{}, nil, MeetingRuntime{}),
		drops:    &graphDrops{n: map[string]int{}}}
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

// otherWorkspace adds workspace B to the organization. The owner, an
// organization owner, reads every workspace; the member is only in A.
func (w *graphWorld) otherWorkspace(t *testing.T) string {
	t.Helper()
	v, err := w.ws.CreateInOrg(w.ctx, w.owner.ID, w.orgID, "Graph Read B", "graph-read-b")
	if err != nil {
		t.Fatal(err)
	}
	return v.Workspace.ID
}

// ownerWork is a task, a project and a meeting in one workspace, each linked
// to the owner's ACTOR (OWNED_BY, OWNED_BY as lead, PARTICIPATED_IN as host).
func (w *graphWorld) ownerWork(t *testing.T, workspaceID, label string) map[string]string {
	t.Helper()
	task, err := w.tasks.Create(w.ctx, Human(w.owner.ID), workspaceID, CreateTaskInput{Title: "Việc " + label, AssigneeID: &w.owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	lead := "member"
	project, err := w.tasks.CreateProject(w.ctx, Human(w.owner.ID), workspaceID, CreateProjectInput{Title: "Dự án " + label, LeadType: &lead, LeadID: &w.owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	meeting, err := w.meetings.CreateInstant(w.ctx, w.owner.ID, workspaceID, "Họp "+label)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{"TASK": task.ID, "PROJECT": project.ID, "MEETING": meeting.ID}
}

// neighbors is the nodes a user sees one step from a node, read through
// workspace A. It reads an hour ahead: a meeting's PARTICIPATED_IN starts at
// its starts_at, which Go wrote, and the DB clock may run behind Go's.
func (w *graphWorld) neighbors(t *testing.T, userID, nodeType, nodeID string) map[string]GraphNodeView {
	t.Helper()
	page, err := w.svc.Neighbors(w.ctx, userID, w.wsID, nodeType, nodeID, GraphNeighborsQuery{At: time.Now().Add(time.Hour), Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]GraphNodeView{}
	for _, it := range page.Items {
		out[it.Node.ID] = it.Node
	}
	return out
}

// historyNodes is the peers a user sees in a node's History, read through
// workspace A.
func (w *graphWorld) historyNodes(t *testing.T, userID, nodeType, nodeID string) map[string]GraphNodeView {
	t.Helper()
	h, err := w.svc.History(w.ctx, userID, w.wsID, nodeType, nodeID, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]GraphNodeView{}
	for _, it := range h.Items {
		if it.Node != nil {
			out[it.Node.ID] = *it.Node
		}
	}
	return out
}

// aroundOwner is the two ways a user reads what surrounds the owner's ACTOR,
// an organization-wide node every member may open.
func (w *graphWorld) aroundOwner(t *testing.T) map[string]func(userID string) map[string]GraphNodeView {
	return map[string]func(string) map[string]GraphNodeView{
		"Neighbors": func(u string) map[string]GraphNodeView { return w.neighbors(t, u, "ACTOR", w.owner.ID) },
		"History":   func(u string) map[string]GraphNodeView { return w.historyNodes(t, u, "ACTOR", w.owner.ID) },
	}
}

// requireHiddenRoots: every node is ErrNotFound as a root for the user, in
// Neighbors and in History, the same answer as a node that does not exist.
func (w *graphWorld) requireHiddenRoots(t *testing.T, userID string, nodes map[string]string) {
	t.Helper()
	for typ, id := range nodes {
		if _, err := w.svc.Neighbors(w.ctx, userID, w.wsID, typ, id, GraphNeighborsQuery{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Neighbors on the %s %s through A: err = %v, want ErrNotFound", typ, id, err)
		}
		if _, err := w.svc.History(w.ctx, userID, w.wsID, typ, id, time.Time{}, time.Time{}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("History on the %s %s through A: err = %v, want ErrNotFound", typ, id, err)
		}
	}
}

// A member of workspace A alone reads nothing of workspace B in the same
// organization: not around an organization-wide ACTOR (Neighbors or
// History), and not as a root. Layer 1 (each workspace clause in
// graph_read.sql) refuses on its own, so layer 2 counts no drop.
func TestGraphReadsStopAtTheWorkspaceBoundary(t *testing.T) {
	w := newGraphWorld(t)
	wsB := w.otherWorkspace(t)
	inA := w.ownerWork(t, w.wsID, "bên A")
	inB := w.ownerWork(t, wsB, "bên B")
	w.rebuild(t)

	// The owner reads every workspace: the B nodes are projected and linked
	// to the owner's ACTOR, so what the member misses below is hidden, not
	// absent.
	for view, read := range w.aroundOwner(t) {
		all := read(w.owner.ID)
		for _, nodes := range []map[string]string{inA, inB} {
			for typ, id := range nodes {
				if _, ok := all[id]; !ok {
					t.Fatalf("%s: the owner does not see the %s %s: %v", view, typ, id, all)
				}
			}
		}
	}
	for typ, id := range inB {
		if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, typ, id, GraphNeighborsQuery{}); err != nil {
			t.Fatalf("the owner reads the %s in B: %v", typ, err)
		}
	}

	w.drops.n = map[string]int{}
	for view, read := range w.aroundOwner(t) {
		seen := read(w.member.ID)
		for typ, id := range inA {
			if _, ok := seen[id]; !ok {
				t.Fatalf("%s: the member does not see the %s in A: %v", view, typ, seen)
			}
		}
		for id, n := range seen {
			if n.WorkspaceID == wsB {
				t.Fatalf("%s: the member sees the %s %s %q of workspace B", view, n.Type, id, n.Title)
			}
		}
	}
	w.requireHiddenRoots(t, w.member.ID, inB)
	if len(w.drops.n) != 0 {
		t.Fatalf("layer 1 let workspace B through to layer 2: drops = %v", w.drops.n)
	}
}

// A node moved to workspace B with no event and no re-projection still sits
// in A in graph_nodes, so layer 1 admits it. Layer 2 reads the module's own
// row and drops it, around the ACTOR (Neighbors and History) and as a root,
// and counts each drop.
func TestGraphLayerTwoDropsNodesMovedToAnotherWorkspace(t *testing.T) {
	w := newGraphWorld(t)
	wsB := w.otherWorkspace(t)
	moved := w.ownerWork(t, w.wsID, "sắp chuyển")
	w.rebuild(t)
	for view, read := range w.aroundOwner(t) {
		before := read(w.member.ID)
		for typ, id := range moved {
			if _, ok := before[id]; !ok {
				t.Fatalf("%s: the member does not see the %s before the move: %v", view, typ, before)
			}
		}
	}

	for table, id := range map[string]string{"tasks": moved["TASK"], "projects": moved["PROJECT"], "meetings": moved["MEETING"]} {
		if _, err := w.pool.Exec(w.ctx, `UPDATE `+table+` SET workspace_id = $1 WHERE id = $2`, wsB, id); err != nil {
			t.Fatalf("move %s: %v", table, err)
		}
	}

	for view, read := range w.aroundOwner(t) {
		w.drops.n = map[string]int{}
		after := read(w.member.ID)
		for typ, id := range moved {
			if n, ok := after[id]; ok {
				t.Fatalf("%s: the member still sees the %s %q moved to B", view, typ, n.Title)
			}
		}
		if want := map[string]int{"TASK": 1, "PROJECT": 1, "MEETING": 1}; !maps.Equal(w.drops.n, want) {
			t.Fatalf("%s: layer 2 drops around the ACTOR = %v, want %v", view, w.drops.n, want)
		}
	}

	w.drops.n = map[string]int{}
	w.requireHiddenRoots(t, w.member.ID, moved)
	if want := map[string]int{"TASK": 2, "PROJECT": 2, "MEETING": 2}; !maps.Equal(w.drops.n, want) {
		t.Fatalf("layer 2 drops on the roots = %v, want %v", w.drops.n, want)
	}
}

// privateOriginTask is a task made from a message in a new private room
// whose members, besides the owner, are the given users.
func (w *graphWorld) privateOriginTask(t *testing.T, name string, members []string) (roomID, taskID string) {
	t.Helper()
	ch, err := w.chat.CreateChannel(w.ctx, w.owner.ID, w.wsID, CreateChannelInput{Name: name, Visibility: "private", MemberUserIDs: members})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := w.chat.SendRoomMessage(w.ctx, w.owner.ID, w.wsID, ch.ID, SendChatMessageInput{Body: "chốt giá trong phòng " + name})
	if err != nil {
		t.Fatal(err)
	}
	task, err := w.chat.CreateTaskFromMessage(w.ctx, w.owner.ID, w.wsID, msg.ID, CreateTaskFromMessageInput{Title: "Việc từ " + name})
	if err != nil {
		t.Fatal(err)
	}
	return ch.ID, task.ID
}

// originRooms is the ORIGINATED_FROM peers a user sees in a task's History.
func (w *graphWorld) originRooms(t *testing.T, userID, taskID string) []string {
	t.Helper()
	h, err := w.svc.History(w.ctx, userID, w.wsID, "TASK", taskID, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, it := range h.Items {
		if it.EdgeType == "ORIGINATED_FROM" {
			out = append(out, it.Node.ID)
		}
	}
	return out
}

// A task's Timeline names the private room it came from only to the room's
// members. Layer 1 (reader_ids) hides it from a workspace member who was
// never in the room, with no layer-2 drop; layer 2 hides it from a member
// removed after the projection ran (a kick writes no event).
func TestGraphHistoryHidesAPrivateOriginRoomFromNonMembers(t *testing.T) {
	w := newGraphWorld(t)
	room, task := w.privateOriginTask(t, "kín", nil)
	kickedRoom, kickedTask := w.privateOriginTask(t, "kín hai", []string{w.member.ID})
	w.rebuild(t)
	if got := w.originRooms(t, w.owner.ID, task); len(got) != 1 || got[0] != room {
		t.Fatalf("the owner's origin rooms = %v, want [%s]", got, room)
	}

	w.drops.n = map[string]int{}
	if got := w.originRooms(t, w.member.ID, task); len(got) != 0 {
		t.Fatalf("a member never in the room sees it in the Timeline: %v", got)
	}
	if len(w.drops.n) != 0 {
		t.Fatalf("layer 1 let the private room through to layer 2: drops = %v", w.drops.n)
	}

	if got := w.originRooms(t, w.member.ID, kickedTask); len(got) != 1 || got[0] != kickedRoom {
		t.Fatalf("the member's origin rooms before the kick = %v, want [%s]", got, kickedRoom)
	}
	if err := w.q.LeaveChatRoomMember(w.ctx, db.LeaveChatRoomMemberParams{RoomID: kickedRoom, UserID: w.member.ID}); err != nil {
		t.Fatal(err)
	}
	w.drops.n = map[string]int{}
	if got := w.originRooms(t, w.member.ID, kickedTask); len(got) != 0 {
		t.Fatalf("the member still sees the room in the Timeline after the kick: %v", got)
	}
	if want := map[string]int{"THREAD": 1}; !maps.Equal(w.drops.n, want) {
		t.Fatalf("layer 2 drops = %v, want %v", w.drops.n, want)
	}
}
