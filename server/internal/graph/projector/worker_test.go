package projector

import (
	"context"
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

// Spec §10 enables `graph` and then rebuilds. A source edited inside that
// window reaches the worker before the rebuild does: the node it brings to
// life predates the graph, so its relations are dated by the source with
// backfill = true, not by the edit. The same holds for a peer resolvePeer
// creates on the way (the assignee) when its own projection runs.
func TestWorkerBackfillsANodeWhoseSourcePredatesTheGraph(t *testing.T) {
	f := newFixture(t)
	f.marker.enabled = func(context.Context, string) bool { return false }
	// The fixture marked the member while its marker was on; this
	// organization has had the flag off from the start.
	f.exec(t, `DELETE FROM graph_dirty WHERE organization_id = $1`, f.orgID)
	dept, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Vận hành"), Code: ptr("VH")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.orgID, f.member.ID, service.ProfileInput{DepartmentID: &dept.ID}); err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Có từ trước"})
	if err != nil {
		t.Fatal(err)
	}
	f.exec(t, `UPDATE tasks SET created_at = created_at - interval '1 day' WHERE organization_id = $1 AND id = $2`, f.orgID, task.ID)
	f.exec(t, `UPDATE organization_members SET created_at = created_at - interval '1 day' WHERE organization_id = $1 AND user_id = $2`,
		f.orgID, f.member.ID)
	member := &f.member.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &member}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1`, f.orgID); n != 0 {
		t.Fatalf("graph nodes while the flag is off = %d", n)
	}

	// Flag on; an edit lands before any rebuild.
	f.marker.enabled = func(context.Context, string) bool { return true }
	title := "Có từ trước, đổi tên"
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{Title: &title}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	eq(t, "actor edges", f.openEdges(t, graph.NodeActor, f.member.ID), []string{"BELONGS_TO>TEAM:" + dept.ID, "OWNED_BY<TASK:" + task.ID})

	type dated struct {
		backfill, atSource bool
		evidence           string
	}
	edge := func(what, sql string, args ...any) dated {
		t.Helper()
		var d dated
		if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&d.backfill, &d.atSource, &d.evidence); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		if !d.backfill || !d.atSource {
			t.Fatalf("%s: backfill = %v, valid_from = the source's time: %v", what, d.backfill, d.atSource)
		}
		return d
	}
	owned := edge("task OWNED_BY", `
		SELECT COALESCE((e.attrs->>'backfill')::boolean, false), e.valid_from = t.created_at, e.evidence_id
		FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node JOIN tasks t ON t.id = n.source_id
		WHERE e.organization_id = $1 AND e.edge_type = 'OWNED_BY' AND n.source_id = $2 AND e.valid_to IS NULL`, f.orgID, task.ID)
	edge("task status", `
		SELECT COALESCE((x.attrs->>'backfill')::boolean, false), x.valid_from = t.created_at, x.evidence_id
		FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id JOIN tasks t ON t.id = n.source_id
		WHERE x.organization_id = $1 AND x.fact_type = 'status' AND n.source_id = $2 AND x.valid_to IS NULL`, f.orgID, task.ID)
	team := edge("actor BELONGS_TO", `
		SELECT COALESCE((e.attrs->>'backfill')::boolean, false), e.valid_from = m.created_at, e.evidence_id
		FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node
		JOIN organization_members m ON m.organization_id = n.organization_id AND m.user_id = n.source_id
		WHERE e.organization_id = $1 AND e.edge_type = 'BELONGS_TO' AND n.node_type = 'ACTOR' AND n.source_id = $2
		  AND e.valid_to IS NULL`, f.orgID, f.member.ID)
	// The actor's projection came from the task's edit (resolvePeer marked it
	// with that event), not from an event of its own.
	if team.evidence != owned.evidence {
		t.Fatalf("actor edge evidence = %s, want the task's event %s", team.evidence, owned.evidence)
	}
}

// A source created while the flag is on is dated by its own event: no
// backfill, valid_from = the outbox row's time.
func TestWorkerDatesANewSourceByItsEvent(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Mới", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	for _, c := range []struct{ what, sql string }{
		{"task OWNED_BY", `
			SELECT COALESCE((e.attrs->>'backfill')::boolean, false), e.valid_from = o.created_at
			FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node JOIN outbox_events o ON o.id = e.evidence_id
			WHERE e.organization_id = $1 AND e.edge_type = 'OWNED_BY' AND n.source_id = $2 AND e.evidence_kind = 'outbox_event'`},
		{"task status", `
			SELECT COALESCE((x.attrs->>'backfill')::boolean, false), x.valid_from = o.created_at
			FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id JOIN outbox_events o ON o.id = x.evidence_id
			WHERE x.organization_id = $1 AND x.fact_type = 'status' AND n.source_id = $2 AND x.evidence_kind = 'outbox_event'`},
	} {
		var backfill, atEvent bool
		if err := f.pool.QueryRow(f.ctx, c.sql, f.orgID, task.ID).Scan(&backfill, &atEvent); err != nil {
			t.Fatalf("%s: %v", c.what, err)
		}
		if backfill || !atEvent {
			t.Fatalf("%s: backfill = %v, valid_from = the event's time: %v", c.what, backfill, atEvent)
		}
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
