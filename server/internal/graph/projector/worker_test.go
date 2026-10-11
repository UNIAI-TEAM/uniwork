package projector

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
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

// A node the graph has held for a while can still be bare: a member with no
// department, a top-level team. Its first edge is a change that happens now,
// so it is dated by its event with no backfill, not by the source's time
// (the membership's start), which would show the member in the team before
// they joined it. Only a stub newer than its event (resolvePeer, above)
// counts as brought to life by the worker.
func TestWorkerDatesTheFirstEdgeOfAnOldBareNodeByItsEvent(t *testing.T) {
	f := newFixture(t)
	f.sync(t)
	eq(t, "actor edges before", f.openEdges(t, graph.NodeActor, f.member.ID), []string{})
	// The actor node and the membership have existed for a day.
	f.exec(t, `UPDATE graph_nodes SET created_at = created_at - interval '1 day'
		WHERE organization_id = $1 AND node_type = 'ACTOR' AND source_id = $2`, f.orgID, f.member.ID)
	f.exec(t, `UPDATE organization_members SET created_at = created_at - interval '1 day' WHERE organization_id = $1 AND user_id = $2`,
		f.orgID, f.member.ID)
	dept, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Kinh doanh"), Code: ptr("KD")})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.orgID, f.member.ID, service.ProfileInput{DepartmentID: &dept.ID}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "actor edges", f.openEdges(t, graph.NodeActor, f.member.ID), []string{"BELONGS_TO>TEAM:" + dept.ID})
	var backfill, atEvent, atMembership bool
	var kind string
	if err := f.pool.QueryRow(f.ctx, `
		SELECT COALESCE((e.attrs->>'backfill')::boolean, false), e.evidence_kind,
		       e.valid_from = o.created_at, e.valid_from = m.created_at
		FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node
		JOIN organization_members m ON m.organization_id = n.organization_id AND m.user_id = n.source_id
		LEFT JOIN outbox_events o ON o.id = e.evidence_id
		WHERE e.organization_id = $1 AND e.edge_type = 'BELONGS_TO' AND n.node_type = 'ACTOR' AND n.source_id = $2
		  AND e.valid_to IS NULL`, f.orgID, f.member.ID).Scan(&backfill, &kind, &atEvent, &atMembership); err != nil {
		t.Fatal(err)
	}
	if backfill || kind != EvidenceOutboxEvent || !atEvent {
		t.Fatalf("actor BELONGS_TO: backfill = %v, evidence_kind = %s, valid_from = the event's time: %v (= the membership's: %v)",
			backfill, kind, atEvent, atMembership)
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

// Spec §4.3 and §13 #10: on the worker path a relation is dated, cited and
// attributed by the outbox row that made its node dirty. The chain is the
// marker (row → graph_dirty), Worker.one (graph_dirty → EventInfo) and
// reconcile (EventInfo → columns); a link that falls back to time.Now(), the
// source id or an empty actor still projects the right edges, so only these
// columns show it. Expected values come from outbox_events (DB clock).
func TestWorkerCarriesTheEventsTimeIDAndActor(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Ai đổi gì", AssigneeID: &f.owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	// The member, not the creator, takes the task over and starts it.
	member, status := &f.member.ID, "in_progress"
	if _, err := f.tasks.Update(f.ctx, service.Human(f.member.ID), task.ID,
		service.UpdateTaskInput{AssigneeID: &member, Status: &status}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)

	type event struct {
		id, actorKind, actorID string
		at                     time.Time
	}
	var evs []event
	rows, err := f.pool.Query(f.ctx, `SELECT id, created_at, COALESCE(actor_kind, ''), COALESCE(actor_id, '')
		FROM outbox_events WHERE organization_id = $1 AND topic = 'task.updated' AND payload::jsonb->>'task_id' = $2`,
		f.orgID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var e event
		if err := rows.Scan(&e.id, &e.at, &e.actorKind, &e.actorID); err != nil {
			t.Fatal(err)
		}
		evs = append(evs, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 {
		t.Fatalf("task.updated rows for the task = %d, want 1", len(evs))
	}
	ev := evs[0]
	if ev.actorKind != string(audit.KindHuman) || ev.actorID != f.member.ID {
		t.Fatalf("outbox actor = (%q, %q), want (%q, %q)", ev.actorKind, ev.actorID, audit.KindHuman, f.member.ID)
	}

	edge := func(peer string) provenanceEdge {
		t.Helper()
		var e provenanceEdge
		if err := f.pool.QueryRow(f.ctx, `
			SELECT e.valid_to IS NULL, e.valid_from, e.valid_to, e.evidence_kind, e.evidence_id, e.actor_kind, e.actor_id,
			       COALESCE(e.attrs->>'closed_by', ''), COALESCE((e.attrs->>'backfill')::boolean, false)
			FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node JOIN graph_nodes p ON p.id = e.to_node
			WHERE e.organization_id = $1 AND e.edge_type = 'OWNED_BY' AND n.source_id = $2 AND p.source_id = $3`,
			f.orgID, task.ID, peer).Scan(&e.open, &e.validFrom, &e.validTo, &e.evidenceKind, &e.evidenceID,
			&e.actorKind, &e.actorID, &e.closedBy, &e.backfill); err != nil {
			t.Fatalf("OWNED_BY → %s: %v", peer, err)
		}
		return e
	}
	opened := edge(f.member.ID)
	if !opened.open || opened.backfill || !opened.validFrom.Equal(ev.at) || opened.evidenceKind != EvidenceOutboxEvent ||
		opened.evidenceID != ev.id || opened.actorKind != ev.actorKind || opened.actorID != ev.actorID {
		t.Fatalf("opened OWNED_BY = %v, want open from %s citing outbox_event %s by (%s, %s)",
			opened, stamp(&ev.at), ev.id, ev.actorKind, ev.actorID)
	}
	closed := edge(f.owner.ID)
	if closed.open || closed.validTo == nil || !closed.validTo.Equal(ev.at) || closed.closedBy != ev.id {
		t.Fatalf("closed OWNED_BY = %v, want closed at %s by %s", closed, stamp(&ev.at), ev.id)
	}
	// Closing does not re-attribute: the edge keeps the person who opened it.
	if closed.actorKind != string(audit.KindHuman) || closed.actorID != f.owner.ID {
		t.Fatalf("closed OWNED_BY actor = (%q, %q), want the creator (%q, %q)",
			closed.actorKind, closed.actorID, audit.KindHuman, f.owner.ID)
	}

	var facts []provenanceFact
	rows, err = f.pool.Query(f.ctx, `
		SELECT x.value, x.valid_from, x.valid_to, x.evidence_kind, x.evidence_id, COALESCE(x.attrs->>'previous', '')
		FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id
		WHERE x.organization_id = $1 AND n.source_id = $2 AND x.fact_type = 'status'
		ORDER BY x.valid_to IS NULL, x.valid_from`, f.orgID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var x provenanceFact
		if err := rows.Scan(&x.value, &x.validFrom, &x.validTo, &x.evidenceKind, &x.evidenceID, &x.previous); err != nil {
			t.Fatal(err)
		}
		facts = append(facts, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(facts) != 2 {
		t.Fatalf("status facts = %v, want the closed %q and the open %q", facts, task.Status, status)
	}
	if was := facts[0]; was.value != task.Status || was.validTo == nil || !was.validTo.Equal(ev.at) {
		t.Fatalf("closed status fact = %v, want %q closed at %s", was, task.Status, stamp(&ev.at))
	}
	if now := facts[1]; now.value != status || now.validTo != nil || !now.validFrom.Equal(ev.at) ||
		now.evidenceKind != EvidenceOutboxEvent || now.evidenceID != ev.id || now.previous != task.Status {
		t.Fatalf("open status fact = %v, want %q from %s citing outbox_event %s", now, status, stamp(&ev.at), ev.id)
	}
}

// provenanceEdge and provenanceFact are the provenance columns of one edge or
// fact, printed readably when an assertion fails.
type provenanceEdge struct {
	open                         bool
	validFrom                    time.Time
	validTo                      *time.Time
	evidenceKind, evidenceID     string
	actorKind, actorID, closedBy string
	backfill                     bool
}

func (e provenanceEdge) String() string {
	return fmt.Sprintf("{open=%v from=%s to=%s evidence=%s/%s actor=(%q, %q) closed_by=%q backfill=%v}",
		e.open, stamp(&e.validFrom), stamp(e.validTo), e.evidenceKind, e.evidenceID, e.actorKind, e.actorID, e.closedBy, e.backfill)
}

type provenanceFact struct {
	value                    string
	validFrom                time.Time
	validTo                  *time.Time
	evidenceKind, evidenceID string
	previous                 string
}

func (x provenanceFact) String() string {
	return fmt.Sprintf("{value=%q from=%s to=%s evidence=%s/%s previous=%q}",
		x.value, stamp(&x.validFrom), stamp(x.validTo), x.evidenceKind, x.evidenceID, x.previous)
}

func stamp(t *time.Time) string {
	if t == nil {
		return "open"
	}
	return t.UTC().Format("15:04:05.000000")
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

// Account deletion (Nghị định 13) anonymises the user and deactivates every
// membership. The ACTOR node in each organization must follow: a task
// assigned to the deleted person keeps its OWNED_BY edge, but the Related
// panel and the Timeline read graph_nodes.title, so a stale node would keep
// the real name readable to the whole workspace.
func TestAccountDeletionReachesTheActorNode(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Giao cho thành viên", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	if err := f.auth.DeleteAccount(f.ctx, f.member.ID, service.DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	f.wantActor(t, f.member.ID, deletedName, "deactivated")
}

// service.deletedDisplayName, the placeholder AnonymizeUser writes.
const deletedName = "Người dùng đã xóa"

// An admin deactivates the member first (ordinary offboarding), and the
// person deletes their account later. The deletion switches no membership
// off in that organization, yet it anonymises the name the ACTOR node shows
// there, so the node must still be re-read.
func TestAccountDeletionReachesAnAlreadyDeactivatedActor(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Giao rồi nghỉ", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	members := service.NewOrganizationMemberService(f.pool, f.q, service.NewOrganizationService(f.pool, f.q))
	if _, err := members.Deactivate(f.ctx, f.owner.ID, f.orgID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	f.wantActor(t, f.member.ID, f.member.DisplayName, "deactivated")
	if err := f.auth.DeleteAccount(f.ctx, f.member.ID, service.DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	f.wantActor(t, f.member.ID, deletedName, "deactivated")
	eq(t, "edges after deletion", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
}

// wantActor checks the live ACTOR node's title and status.
func (f *fixture) wantActor(t *testing.T, userID, title, status string) {
	t.Helper()
	var gotTitle, gotStatus string
	if err := f.pool.QueryRow(f.ctx, `SELECT title, status FROM graph_nodes
		WHERE organization_id = $1 AND node_type = $2 AND source_id = $3 AND deleted_at IS NULL`,
		f.orgID, string(graph.NodeActor), userID).Scan(&gotTitle, &gotStatus); err != nil {
		t.Fatal(err)
	}
	if gotTitle != title || gotStatus != status {
		t.Fatalf("actor node = (%q, %q), want (%q, %q)", gotTitle, gotStatus, title, status)
	}
}
