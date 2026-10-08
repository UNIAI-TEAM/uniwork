package projector

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestRebuildVerifyFindsNoDriftAfterTheWorker(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{Title: "P"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "T", ProjectID: &p.ID, AssigneeID: &f.member.ID, DueDate: ptr("2026-11-01"),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	rep, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.Total() != 0 || rep.Nodes == 0 {
		t.Fatalf("verify after the worker = %+v", rep)
	}
	// Tamper: close the OWNED_BY edge by hand. Verify sees it; apply fixes it.
	if _, err := f.pool.Exec(f.ctx, `UPDATE graph_edges SET valid_to = now() WHERE organization_id = $1 AND edge_type = 'OWNED_BY'`, f.orgID); err != nil {
		t.Fatal(err)
	}
	rep, err = RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.MissingEdges != 1 {
		t.Fatalf("verify after tampering = %+v", rep.Drift)
	}
	if _, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	// A verify that fails partway returns a partial report with zero drift,
	// so its error must fail the test before the drift is read.
	rep, err = RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.Total() != 0 {
		t.Fatalf("verify after apply = %+v", rep.Drift)
	}
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.member.ID})
}

// A message bumps chat_rooms.updated_at and emits no event the marker takes.
// The THREAD node is still right, so verify finds no drift and an apply
// rewrites nothing; a real change still refreshes source_updated_at.
func TestRoomActivityIsNotDrift(t *testing.T) {
	f := newFixture(t)
	ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "hoat-dong", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	ref := NodeRef{Type: graph.NodeThread, SourceID: ch.ID}
	nodeTimes := func() (updated, sourceUpdated time.Time) {
		t.Helper()
		if err := f.pool.QueryRow(f.ctx, `SELECT updated_at, source_updated_at FROM graph_nodes
			WHERE organization_id = $1 AND node_type = 'THREAD' AND source_id = $2`, f.orgID, ch.ID).Scan(&updated, &sourceUpdated); err != nil {
			t.Fatal(err)
		}
		return updated, sourceUpdated
	}
	before, _ := nodeTimes()

	if _, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, ch.ID, service.SendChatMessageInput{Body: "chào cả nhà"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	// The message must have moved the room past what the node holds, or
	// this test proves nothing.
	if n := f.count(t, `SELECT count(*) FROM chat_rooms r JOIN graph_nodes n ON n.source_id = r.id
		WHERE n.organization_id = $1 AND n.node_type = 'THREAD' AND r.id = $2 AND r.updated_at > n.source_updated_at`, f.orgID, ch.ID); n != 1 {
		t.Fatal("sending a message did not bump chat_rooms.updated_at past the node's source_updated_at")
	}
	if d := f.verify(t, ref); d.Total() != 0 {
		t.Fatalf("verify after a message = %+v, want no drift", d)
	}
	rep, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.Total() != 0 {
		t.Fatalf("apply after a message = %+v, want no drift", rep.Drift)
	}
	if after, _ := nodeTimes(); !after.Equal(before) {
		t.Fatalf("apply rewrote the node: updated_at %v -> %v", before, after)
	}

	// A rename is a real change: the node is rewritten, source_updated_at with it.
	name := "doi-ten"
	if _, err := f.chat.UpdateChannel(f.ctx, f.owner.ID, f.wsID, ch.ID, service.UpdateChannelInput{Name: &name}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if n := f.count(t, `SELECT count(*) FROM chat_rooms r JOIN graph_nodes n ON n.source_id = r.id
		WHERE n.organization_id = $1 AND n.node_type = 'THREAD' AND r.id = $2
		  AND n.title = r.name AND n.source_updated_at = r.updated_at`, f.orgID, ch.ID); n != 1 {
		t.Fatal("rename did not rewrite the node's title and source_updated_at")
	}
}

// An organization whose events were never marked (flag off) is backfilled by
// rebuild; new edges carry the source's time and backfill = true.
func TestRebuildBackfillsWithSourceTime(t *testing.T) {
	f := newFixture(t)
	f.marker.enabled = func(context.Context, string) bool { return false }
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Cũ", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	// The task predates the graph by a day. Created a moment ago, created_at
	// (the database's clock) could still be ahead of this process's clock,
	// and openAt clamps a source dated in the future to now.
	f.exec(t, `UPDATE tasks SET created_at = created_at - interval '1 day' WHERE organization_id = $1 AND id = $2`, f.orgID, task.ID)
	f.sync(t)
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'TASK'`, f.orgID); n != 0 {
		t.Fatalf("task nodes before rebuild = %d", n)
	}
	if _, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	var backfill bool
	var sameTime bool
	if err := f.pool.QueryRow(f.ctx, `
		SELECT (e.attrs->>'backfill')::boolean, e.valid_from = t.created_at
		FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node JOIN tasks t ON t.id = n.source_id
		WHERE e.organization_id = $1 AND e.edge_type = 'OWNED_BY' AND n.source_id = $2`, f.orgID, task.ID).Scan(&backfill, &sameTime); err != nil {
		t.Fatal(err)
	}
	if !backfill || !sameTime {
		t.Fatalf("backfill = %v, valid_from = created_at: %v", backfill, sameTime)
	}
}
