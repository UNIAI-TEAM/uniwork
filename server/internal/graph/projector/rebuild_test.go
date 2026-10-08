package projector

import (
	"context"
	"testing"

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
	if rep, _ = RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true}); rep.Drift.Total() != 0 {
		t.Fatalf("verify after apply = %+v", rep.Drift)
	}
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.member.ID})
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
