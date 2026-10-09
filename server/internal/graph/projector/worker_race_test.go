package projector

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The tests below stage two worker loops by hand: deliver runs the marker,
// claimOne takes a claim, and inFlight runs Worker.project up to its commit,
// so another session's commit can land between a projection's read of the
// source and the removal of its dirty row.

// A claim can outlive its 60 s lease: a batch of 8 is projected one node at a
// time. Meanwhile the other loop claims the node, projects it and deletes its
// dirty row, and an edit marks the node again. The first loop read the source
// before that edit; removing its dirty row must not take the edit's mark too,
// or the edit never reaches the graph.
func TestAnExpiredClaimLeavesTheMarkOfALaterEdit(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Bản 1"})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	rename := func(title string) {
		t.Helper()
		if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{Title: &title}); err != nil {
			t.Fatal(err)
		}
		f.deliver(t)
	}

	rename("Bản 2")
	first := f.claimOne(t, task.ID)
	// The first claim's lease runs out (the row is due a second ago too, so a
	// DB clock that steps back cannot keep it from the other loop).
	f.exec(t, `UPDATE graph_dirty SET locked_until = now() - interval '1 second', available_at = now() - interval '1 second'
		WHERE organization_id = $1 AND source_id = $2`, f.orgID, task.ID)
	if _, err := f.worker.Drain(f.ctx, 100); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM graph_dirty WHERE source_id = $1`, task.ID); n != 0 {
		t.Fatalf("dirty rows after the other loop = %d, want 0", n)
	}
	finish := f.inFlight(t, first)
	rename("Bản 3")
	finish()
	f.sync(t)

	var title string
	if err := f.pool.QueryRow(f.ctx, `SELECT title FROM graph_nodes WHERE organization_id = $1 AND node_type = 'TASK' AND source_id = $2`,
		f.orgID, task.ID).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "Bản 3" {
		t.Fatalf("task node title = %q, want the latest edit %q", title, "Bản 3")
	}
}

// blocks(a, b) is the edge b→a, and only b's projection writes it. Remove the
// dependency while b's projection is in flight, after it read the dependency
// and opened the edge: a's projection runs under its own lock and cannot see
// b's uncommitted edge, so it has nothing to mark. The removal has to mark b
// itself, or the edge stays open with nothing dirty.
func TestDependencyRemovedWhileThePeerProjectsClosesTheEdge(t *testing.T) {
	f := newFixture(t)
	a, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "A chặn B"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "B chờ A"})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)

	if _, err := f.tasks.SetDependency(f.ctx, service.Human(f.owner.ID), a.ID, service.SetDependencyInput{DependsOnTaskID: b.ID, Type: "blocks"}); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	// a projects first and marks b: b has no edge into a yet. Hold back any
	// mark b already has, so a's projection is what makes b due.
	f.exec(t, `UPDATE graph_dirty SET available_at = now() + interval '1 hour' WHERE organization_id = $1 AND source_id = $2`,
		f.orgID, b.ID)
	f.inFlight(t, f.claimOne(t, a.ID))()
	finishB := f.inFlight(t, f.claimOne(t, b.ID))

	if err := f.tasks.RemoveDependency(f.ctx, service.Human(f.owner.ID), a.ID, b.ID, "blocks"); err != nil {
		t.Fatal(err)
	}
	f.deliver(t)
	f.inFlight(t, f.claimOne(t, a.ID))()
	finishB()
	f.sync(t)

	eq(t, "b edges", f.openEdges(t, graph.NodeTask, b.ID), []string{})
	eq(t, "a edges", f.openEdges(t, graph.NodeTask, a.ID), []string{})
}

// deliver hands every outbox row of the organization to the marker. Like sync,
// it polls while a row is not claimable yet, for a DB clock that stepped back.
func (f *fixture) deliver(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(syncTimeout)
	for {
		if err := f.disp.Process(f.ctx, 500); err != nil {
			t.Fatal(err)
		}
		n := f.count(t, `SELECT count(*) FROM outbox_events WHERE organization_id = $1 AND status IN ('PENDING', 'PROCESSING')`, f.orgID)
		if n == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("outbox rows left undelivered after %s: %d", syncTimeout, n)
		}
		time.Sleep(syncPoll)
	}
}

// claimOne claims every dirty row that is due and returns source's, failing on
// any other: the tests above decide which loop holds which node. Like sync, it
// polls while nothing is due yet, for a DB clock that stepped back.
func (f *fixture) claimOne(t *testing.T, source string) db.GraphDirty {
	t.Helper()
	deadline := time.Now().Add(syncTimeout)
	var rows []db.GraphDirty
	for {
		var err error
		rows, err = f.q.GraphClaimDirty(f.ctx, db.GraphClaimDirtyParams{LeaseSeconds: 60, Batch: 100})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(syncPoll)
	}
	if len(rows) != 1 || rows[0].SourceID != source {
		got := make([]string, 0, len(rows))
		for _, r := range rows {
			got = append(got, r.NodeType+":"+r.SourceID)
		}
		t.Fatalf("claimed %v, want only %s", got, source)
	}
	return rows[0]
}

// inFlight is Worker.project for claim r, stopped before its last step: the
// node is projected on a transaction of its own, and the returned finish
// settles r's dirty row and commits.
func (f *fixture) inFlight(t *testing.T, r db.GraphDirty) (finish func()) {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(f.ctx) })
	q := f.q.WithTx(tx)
	ref := NodeRef{Type: graph.NodeType(r.NodeType), SourceID: r.SourceID}
	if _, err := Project(f.ctx, q, r.OrganizationID, ref, eventOf(r)); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		if err := settle(f.ctx, q, r); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	}
}
