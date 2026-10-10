package projector

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestProjectTaskFollowsItsSource(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{
		Title: "Ra mắt Q4", LeadType: ptr("member"), LeadID: ptr(f.owner.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "Viết spec", ProjectID: &p.ID, AssigneeID: &f.member.ID, DueDate: ptr("2026-10-20"),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.member.ID,
	})
	eq(t, "project edges", f.openEdges(t, graph.NodeProject, p.ID), []string{
		"BELONGS_TO<TASK:" + task.ID, "OWNED_BY>ACTOR:" + f.owner.ID,
	})
	if facts := f.openFacts(t, graph.NodeTask, task.ID); facts["due"] != "2026-10-20" || facts["status"] != task.Status {
		t.Fatalf("facts = %v", facts)
	}

	owner := &f.owner.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after reassign", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.owner.ID,
	})
	if n := f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1 AND edge_type = 'OWNED_BY'
		AND valid_to IS NOT NULL`, f.orgID); n != 1 {
		t.Fatalf("closed OWNED_BY = %d, want 1 (history kept)", n)
	}

	// The same source twice: nothing to write.
	before := f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1`, f.orgID)
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	d, err := Project(f.ctx, f.q.WithTx(tx), f.orgID, NodeRef{Type: graph.NodeTask, SourceID: task.ID},
		EventInfo{EvidenceKind: EvidenceOutboxEvent, EvidenceID: "ev-again", At: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	if d.Total() != 0 || f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1`, f.orgID) != before {
		t.Fatalf("second projection wrote %+v", d)
	}
}

// A slot dragged in Calendar sets due_date and a due_at time block; the task
// page labels due_date "Hạn" and its sidebar edits only that. The Timeline's
// due must follow the same field, and moving the block within the day (or
// onto the all-day row, which clears due_at) is not a change of Hạn.
func TestDueFollowsTheDueDateTheTaskPageShows(t *testing.T) {
	f := newFixture(t)
	ict := time.FixedZone("ICT", 7*3600)
	at := func(hour int) *time.Time {
		v := time.Date(2026, 10, 15, hour, 0, 0, 0, ict)
		return &v
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "Gọi khách", DueDate: ptr("2026-10-15"), StartAt: at(10), DueAt: at(11),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "due after create", f.dueFacts(t, task.ID), []string{"open 2026-10-15 date"})

	due := ptr("2026-10-20")
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{DueDate: &due}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	moved := []string{"closed 2026-10-15 date", "open 2026-10-20 date"}
	eq(t, "due after Hạn moved", f.dueFacts(t, task.ID), moved)

	start, end := at(13), at(14)
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{StartAt: &start, DueAt: &end}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "due after the block moved within the day", f.dueFacts(t, task.ID), moved)

	var none *time.Time
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{StartAt: &none, DueAt: &none}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "due after the block moved to the all-day row", f.dueFacts(t, task.ID), moved)
}

func TestProjectTaskDependenciesAndOrigin(t *testing.T) {
	f := newFixture(t)
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	created, err := f.meetings.CreateTasksFromSummary(f.ctx, f.owner.ID, m.ID, []service.SummaryTaskItem{{Title: "Gửi báo giá"}, {Title: "Chốt hợp đồng"}})
	if err != nil {
		t.Fatal(err)
	}
	a, b := created[0], created[1]
	// blocks(a, b): b depends on a → edge b→a, owned by b; the event names a.
	if _, err := f.tasks.SetDependency(f.ctx, service.Human(f.owner.ID), a.ID, service.SetDependencyInput{DependsOnTaskID: b.ID, Type: "blocks"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges", f.openEdges(t, graph.NodeTask, b.ID), []string{
		"DEPENDS_ON>TASK:" + a.ID, "ORIGINATED_FROM>MEETING:" + m.ID,
	})
	if err := f.tasks.RemoveDependency(f.ctx, service.Human(f.owner.ID), a.ID, b.ID, "blocks"); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after removal", f.openEdges(t, graph.NodeTask, b.ID), []string{"ORIGINATED_FROM>MEETING:" + m.ID})
}

func TestProjectTaskDeleteClosesEveryEdge(t *testing.T) {
	f := newFixture(t)
	a, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "B", ParentTaskID: &a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.tasks.SetDependency(f.ctx, service.Human(f.owner.ID), b.ID, service.SetDependencyInput{DependsOnTaskID: a.ID, Type: "blocked_by"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges", f.openEdges(t, graph.NodeTask, b.ID), []string{"BELONGS_TO>TASK:" + a.ID, "DEPENDS_ON>TASK:" + a.ID})
	if err := f.tasks.Delete(f.ctx, f.owner.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after a is gone", f.openEdges(t, graph.NodeTask, b.ID), []string{})
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND source_id = $2 AND deleted_at IS NOT NULL`, f.orgID, a.ID); n != 1 {
		t.Fatal("a's node is kept, marked deleted")
	}
	// Re-projecting b (as any later event would) must not reopen an edge to a.
	b2 := "B2"
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), b.ID, service.UpdateTaskInput{Title: &b2}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after update", f.openEdges(t, graph.NodeTask, b.ID), []string{})
}

func TestProjectMeetingAndThreads(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{Title: "Dự án"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := f.meetings.Create(f.ctx, f.owner.ID, f.wsID, service.CreateMeetingInput{
		Title: "Họp tuần", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour), Timezone: "UTC", ProjectID: p.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.Invite(f.ctx, f.owner.ID, m.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	edges := f.openEdges(t, graph.NodeMeeting, m.ID)
	want := []string{"BELONGS_TO>PROJECT:" + p.ID, "PARTICIPATED_IN<ACTOR:" + f.member.ID}
	for _, w := range want {
		found := false
		for _, e := range edges {
			found = found || e == w
		}
		if !found {
			t.Fatalf("meeting edges = %v, missing %s", edges, w)
		}
	}
	if err := f.meetings.Cancel(f.ctx, f.owner.ID, m.ID, "dời lịch"); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if facts := f.openFacts(t, graph.NodeMeeting, m.ID); facts["status"] != "CANCELED" {
		t.Fatalf("canceled meeting facts = %v (the node stays)", facts)
	}

	// A private room refuses a new sync (H12), so the thread is linked while
	// the channel is public and the channel turns private afterwards.
	private, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "kin", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, private.ID, service.SendChatMessageInput{Body: "bàn ở đây"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "Từ tin nhắn", OriginType: "chat_message", OriginID: &root.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.chat.SyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID, service.SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	privateVis := "private"
	if _, err := f.chat.UpdateChannel(f.ctx, f.owner.ID, f.wsID, private.ID, service.UpdateChannelInput{Visibility: &privateVis}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"DISCUSSED_IN>THREAD:" + private.ID, "ORIGINATED_FROM>THREAD:" + private.ID,
	})
	var vis string
	var readers []string
	if err := f.pool.QueryRow(f.ctx, `SELECT visibility, reader_ids FROM graph_nodes WHERE organization_id = $1 AND source_id = $2`,
		f.orgID, private.ID).Scan(&vis, &readers); err != nil {
		t.Fatal(err)
	}
	if vis != "members" || len(readers) != 1 || readers[0] != f.owner.ID {
		t.Fatalf("private room = %s %v", vis, readers)
	}
	if err := f.chat.UnsyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after unsync", f.openEdges(t, graph.NodeTask, task.ID), []string{"ORIGINATED_FROM>THREAD:" + private.ID})
	if err := f.chat.ArchiveChannel(f.ctx, f.owner.ID, f.wsID, private.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after archive", f.openEdges(t, graph.NodeTask, task.ID), []string{})
}

func TestProjectActorsAndTeams(t *testing.T) {
	f := newFixture(t)
	parent, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Kinh doanh"), Code: ptr("KD")})
	if err != nil {
		t.Fatal(err)
	}
	child, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Bán lẻ"), Code: ptr("BL"), ParentID: &parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.orgID, f.member.ID, service.ProfileInput{DepartmentID: &child.ID}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "member edges", f.openEdges(t, graph.NodeActor, f.member.ID), []string{"BELONGS_TO>TEAM:" + child.ID})
	eq(t, "child team", f.openEdges(t, graph.NodeTeam, child.ID), []string{
		"BELONGS_TO<ACTOR:" + f.member.ID, "BELONGS_TO>TEAM:" + parent.ID,
	})
	if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.orgID, child.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "member after archive", f.openEdges(t, graph.NodeActor, f.member.ID), []string{})
	// The default agent (organization create) is an ACTOR with subtype agent.
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'ACTOR'
		AND subtype = 'agent' AND deleted_at IS NULL`, f.orgID); n != 1 {
		t.Fatalf("agent actors = %d", n)
	}
}

// UnsyncThreadTask deletes the link row in the transaction that writes
// chat.thread.unlinked, so the payload's task_id is the only way back to the
// task whose DISCUSSED_IN must close.
func TestUnlinkReachesTheTaskThroughItsPayload(t *testing.T) {
	f := newFixture(t)
	ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "lien-ket", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, ch.ID, service.SendChatMessageInput{Body: "bàn việc này"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Việc được bàn"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.chat.SyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID, service.SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "linked", f.openEdges(t, graph.NodeTask, task.ID), []string{"DISCUSSED_IN>THREAD:" + ch.ID})

	if err := f.chat.UnsyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID); err != nil {
		t.Fatal(err)
	}
	rows, err := f.pool.Query(f.ctx, `SELECT topic, payload FROM outbox_events
		WHERE organization_id = $1 AND status = 'PENDING' ORDER BY created_at`, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	topics := []string{}
	var refs []NodeRef
	for rows.Next() {
		var topic, payload string
		if err := rows.Scan(&topic, &payload); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			t.Fatal(err)
		}
		topics = append(topics, topic)
		refs = append(refs, Refs(topic, p)...)
	}
	rows.Close()
	eq(t, "pending topics", topics, []string{"chat.thread.unlinked"})
	if len(refs) != 1 || refs[0] != (NodeRef{Type: graph.NodeTask, SourceID: task.ID}) {
		t.Fatalf("refs of the unlink = %+v, want the task", refs)
	}
	f.sync(t)
	eq(t, "after unlink", f.openEdges(t, graph.NodeTask, task.ID), []string{})
	if n := f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1 AND edge_type = 'DISCUSSED_IN'
		AND valid_to IS NOT NULL`, f.orgID); n != 1 {
		t.Fatalf("closed DISCUSSED_IN = %d, want 1 (history kept)", n)
	}
}

// Two worker loops can project a task and its assignee at once: the task
// opens OWNED_BY while the actor's deletion, which cannot see that
// uncommitted insert, closes the actor's edges and marks it deleted. An open
// edge to a deleted peer is not satisfied by being open: the next projection
// of the task closes it when the peer's source is gone.
func TestProjectClosesAnOpenEdgeToADeletedPeer(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Giao cho người sắp rời", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})

	// The race's end state: the member is gone, their node deleted, and the
	// task's OWNED_BY edge still open.
	f.exec(t, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, f.member.ID)
	f.exec(t, `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, f.orgID, f.member.ID)
	f.exec(t, `UPDATE graph_nodes SET deleted_at = now() WHERE organization_id = $1 AND node_type = 'ACTOR' AND source_id = $2`,
		f.orgID, f.member.ID)

	ref := NodeRef{Type: graph.NodeTask, SourceID: task.ID}
	if d := f.verify(t, ref); d.ExtraEdges != 1 || d.Total() != 1 {
		t.Fatalf("verify = %+v, want the edge to the deleted actor as one extra edge", d)
	}
	if d := f.project(t, ref, outboxEvent("ev-after-race")); d.ExtraEdges != 1 || d.Total() != 1 {
		t.Fatalf("project = %+v, want one edge closed", d)
	}
	eq(t, "task edges after projection", f.openEdges(t, graph.NodeTask, task.ID), []string{})
	if d := f.verify(t, ref); d.Total() != 0 {
		t.Fatalf("verify after projection = %+v", d)
	}
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'ACTOR'
		AND source_id = $2 AND deleted_at IS NOT NULL`, f.orgID, f.member.ID); n != 1 {
		t.Fatal("the actor whose source is gone stays deleted")
	}
}

// The same race when the peer's source still exists (deleted, then back):
// the edge stays open and the peer's node comes back to life.
func TestProjectKeepsAnOpenEdgeToARevivedPeer(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Giao cho người quay lại", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	f.exec(t, `UPDATE graph_nodes SET deleted_at = now() WHERE organization_id = $1 AND node_type = 'ACTOR' AND source_id = $2`,
		f.orgID, f.member.ID)

	ref := NodeRef{Type: graph.NodeTask, SourceID: task.ID}
	if d := f.verify(t, ref); d.Total() != 0 {
		t.Fatalf("verify = %+v, want no drift on the task (the actor's source exists)", d)
	}
	f.project(t, ref, outboxEvent("ev-after-race"))
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'ACTOR'
		AND source_id = $2 AND deleted_at IS NULL`, f.orgID, f.member.ID); n != 1 {
		t.Fatal("the actor's node is live again")
	}
}

// linkedThread makes a public channel with one thread linked to a new task
// and projects them.
func (f *fixture) linkedThread(t *testing.T, name string) (room, task string) {
	t.Helper()
	ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: name, Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	task = f.linkTask(t, ch.ID, "Bàn trong "+name)
	f.sync(t)
	eq(t, "linked", f.openEdges(t, graph.NodeTask, task), []string{"DISCUSSED_IN>THREAD:" + ch.ID})
	return ch.ID, task
}

// linkTask posts a thread in room and links it to a new task.
func (f *fixture) linkTask(t *testing.T, room, title string) string {
	t.Helper()
	root, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, room, service.SendChatMessageInput{Body: title})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.chat.SyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID, service.SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	return task.ID
}

func (f *fixture) dirty(t *testing.T, ref NodeRef) bool {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM graph_dirty WHERE organization_id = $1 AND node_type = $2 AND source_id = $3`,
		f.orgID, string(ref.Type), ref.SourceID) == 1
}

// Deleting a node closes the edges at both ends, whoever owns them; only
// their owners' projections reopen them. Unarchiving a channel brings its
// THREAD back, and the tasks discussed in it must be marked to follow.
func TestRevivedNodeMarksTheOwnersOfEdgesItsDeletionClosed(t *testing.T) {
	f := newFixture(t)
	room, task := f.linkedThread(t, "luu-tru")
	if err := f.chat.ArchiveChannel(f.ctx, f.owner.ID, f.wsID, room); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after archive", f.openEdges(t, graph.NodeTask, task), []string{})

	if err := f.chat.UnarchiveChannel(f.ctx, f.owner.ID, f.wsID, room); err != nil {
		t.Fatal(err)
	}
	f.project(t, NodeRef{Type: graph.NodeThread, SourceID: room}, outboxEvent("ev-unarchive"))
	if !f.dirty(t, NodeRef{Type: graph.NodeTask, SourceID: task}) {
		t.Fatal("the revived thread did not mark the task that owns its closed DISCUSSED_IN")
	}
	f.sync(t)
	eq(t, "after unarchive", f.openEdges(t, graph.NodeTask, task), []string{"DISCUSSED_IN>THREAD:" + room})
}

// A node can also come back through another node's projection (resolvePeer)
// before its own runs, which then finds it live: that revival marks the
// owners too.
func TestPeerRevivedByAnotherProjectionMarksTheOwnersOfItsClosedEdges(t *testing.T) {
	f := newFixture(t)
	room, first := f.linkedThread(t, "mo-lai")
	if err := f.chat.ArchiveChannel(f.ctx, f.owner.ID, f.wsID, room); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if err := f.chat.UnarchiveChannel(f.ctx, f.owner.ID, f.wsID, room); err != nil {
		t.Fatal(err)
	}
	second := f.linkTask(t, room, "Việc mới trong kênh")
	f.project(t, NodeRef{Type: graph.NodeTask, SourceID: second}, outboxEvent("ev-link-second"))
	eq(t, "second task", f.openEdges(t, graph.NodeTask, second), []string{"DISCUSSED_IN>THREAD:" + room})
	if !f.dirty(t, NodeRef{Type: graph.NodeTask, SourceID: first}) {
		t.Fatal("reviving the thread through a peer did not mark the first task")
	}
	f.sync(t)
	eq(t, "first task", f.openEdges(t, graph.NodeTask, first), []string{"DISCUSSED_IN>THREAD:" + room})
}
