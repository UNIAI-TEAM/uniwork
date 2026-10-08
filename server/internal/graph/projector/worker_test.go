package projector

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Two assignments before the worker runs fold into one dirty row; the graph
// ends on the latest assignee with no second open OWNED_BY.
func TestWorkerFollowsTheLatestSource(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Đổi người", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	owner := &f.owner.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	member := &f.member.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &member}); err != nil {
		t.Fatal(err)
	}
	if err := f.disp.Process(f.ctx, 500); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM graph_dirty WHERE source_id = $1`, task.ID); n != 1 {
		t.Fatalf("dirty rows for the task = %d, want 1", n)
	}
	f.sync(t)
	eq(t, "edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	if n := f.count(t, `SELECT count(*) FROM graph_dirty`); n != 0 {
		t.Fatalf("dirty rows left = %d", n)
	}
}

// A visibility change rides chat.channel.updated, catalogued "ephemeral" but
// stored by Record; if it stops reaching the outbox this test fails.
func TestChannelVisibilityChangeReachesTheGraph(t *testing.T) {
	f := newFixture(t)
	ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "mo", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	private := "private"
	if _, err := f.chat.UpdateChannel(f.ctx, f.owner.ID, f.wsID, ch.ID, service.UpdateChannelInput{Visibility: &private}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	var vis string
	if err := f.pool.QueryRow(f.ctx, `SELECT visibility FROM graph_nodes WHERE organization_id = $1 AND source_id = $2`, f.orgID, ch.ID).Scan(&vis); err != nil {
		t.Fatal(err)
	}
	if vis != "members" {
		t.Fatalf("visibility = %s, want members", vis)
	}
}
