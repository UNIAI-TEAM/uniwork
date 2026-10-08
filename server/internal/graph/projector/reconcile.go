package projector

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Project brings one node's slice of the graph in line with its source, on
// q's transaction. Running it twice for the same source writes nothing the
// second time.
func Project(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo) (Drift, error) {
	return reconcile(ctx, q, org, ref, ev, true)
}

// Verify counts what Project would change, writing nothing.
func Verify(ctx context.Context, q *db.Queries, org string, ref NodeRef) (Drift, error) {
	return reconcile(ctx, q, org, ref, EventInfo{EvidenceKind: EvidenceSourceRow}, false)
}

func lockKey(org string, ref NodeRef) string { return "graph:" + org + ":" + ref.key() }

// bareNode reports whether a live node has no open in-scope SYSTEM edge and
// no open fact.
func bareNode(ctx context.Context, q *db.Queries, org, nodeID string, t graph.NodeType) (bool, error) {
	edges, err := q.GraphListOpenSystemEdges(ctx, db.GraphListOpenSystemEdgesParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return false, err
	}
	for _, e := range edges {
		if inScope(t, graph.EdgeType(e.EdgeType), e.Outgoing) {
			return false, nil
		}
	}
	facts, err := q.GraphListOpenFacts(ctx, db.GraphListOpenFactsParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return false, err
	}
	return len(facts) == 0, nil
}

func reconcile(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	if write {
		if err := q.GraphLockNode(ctx, lockKey(org, ref)); err != nil {
			return drift, err
		}
	}
	want, err := load(ctx, q, org, ref)
	if err != nil {
		return drift, err
	}
	cur, err := q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
		OrganizationID: org, NodeType: string(ref.Type), SourceID: ref.SourceID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return drift, err
	}
	live := err == nil && !cur.DeletedAt.Valid

	if want.Node == nil {
		if live {
			drift.ExtraNodes++
			if write {
				if err := deleteNode(ctx, q, org, cur.ID, ref, ev); err != nil {
					return drift, err
				}
			}
		}
		return drift, nil
	}
	switch {
	case !live:
		drift.MissingNodes++
	case nodeDiffers(cur, *want.Node):
		drift.ChangedNodes++
	}
	ev.fresh = !live
	if live {
		// A node resolvePeer created moments ago (in this rebuild, or for an
		// event about another node) has a row but no open edges or facts:
		// its history is dated by the source too.
		bare, err := bareNode(ctx, q, org, cur.ID, ref.Type)
		if err != nil {
			return drift, err
		}
		ev.fresh = bare
	}
	nodeID := cur.ID
	if write {
		row, err := upsertNode(ctx, q, org, *want.Node)
		if err != nil {
			return drift, err
		}
		nodeID = row.ID
		if err := markPeersOfClosedEdges(ctx, q, org, cur, ev); err != nil {
			return drift, err
		}
	} else if !live {
		drift.MissingEdges += len(want.Edges)
		drift.MissingFacts += len(want.Facts)
		return drift, nil
	}
	e, err := reconcileEdges(ctx, q, org, nodeID, ref, want, ev, write)
	drift.Add(e)
	if err != nil {
		return drift, err
	}
	f, err := reconcileFacts(ctx, q, org, nodeID, ref, want, ev, write)
	drift.Add(f)
	return drift, err
}

func reconcileEdges(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, want Desired, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	rows, err := q.GraphListOpenSystemEdges(ctx, db.GraphListOpenSystemEdgesParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return drift, err
	}
	current := map[string]db.GraphListOpenSystemEdgesRow{}
	incoming := map[string]NodeRef{} // owners of open DEPENDS_ON edges into this node
	for _, r := range rows {
		w := EdgeWant{Type: graph.EdgeType(r.EdgeType), Out: r.Outgoing,
			Peer: NodeRef{Type: graph.NodeType(r.PeerType), SourceID: r.PeerSourceID}}
		if w.Type == graph.EdgeDependsOn && !w.Out {
			incoming[w.Peer.key()] = w.Peer
		}
		if inScope(ref.Type, w.Type, w.Out) {
			current[w.key()] = r
		}
	}
	// Resolve wanted peers first: an edge to a source that no longer exists is
	// not wanted, so it is closed rather than kept. An open edge is enough only
	// while its peer is live: one left open to a deleted peer (the peer's
	// deletion raced this node's projection and missed it) is resolved too,
	// which brings the peer back when its source exists.
	wanted := map[string]EdgeWant{}
	peerIDs := map[string]string{}
	for _, w := range want.Edges {
		if r, ok := current[w.key()]; ok && !r.PeerDeleted {
			wanted[w.key()] = w
			continue
		}
		id, ok, err := resolvePeer(ctx, q, org, w.Peer, ev, write)
		if err != nil {
			return drift, err
		}
		if ok {
			wanted[w.key()] = w
			peerIDs[w.key()] = id
		}
	}
	for k, r := range current {
		if _, ok := wanted[k]; ok {
			continue
		}
		drift.ExtraEdges++
		if write {
			if err := q.GraphCloseEdge(ctx, db.GraphCloseEdgeParams{
				OrganizationID: org, ID: r.ID, ValidTo: ts(ev.closeAt()), ClosedBy: ev.evidence(ref),
			}); err != nil {
				return drift, err
			}
		}
	}
	for k, w := range wanted {
		if _, ok := current[k]; ok {
			continue
		}
		drift.MissingEdges++
		if !write {
			continue
		}
		from, to := nodeID, peerIDs[k]
		if !w.Out {
			from, to = to, from
		}
		at, backfill := ev.openAt(*want.Node)
		if err := q.GraphOpenEdge(ctx, db.GraphOpenEdgeParams{
			ID: util.NewID(), OrganizationID: org, FromNode: from, ToNode: to, EdgeType: string(w.Type),
			Origin: graph.OriginSystem, ValidFrom: ts(at), EvidenceKind: ev.EvidenceKind, EvidenceID: ev.evidence(ref),
			ActorKind: ev.ActorKind, ActorID: ev.ActorID, Attrs: attrs(backfill, ev, nil),
		}); err != nil {
			return drift, err
		}
	}
	if write && ev.EvidenceKind == EvidenceOutboxEvent {
		// Mark only the owners whose edge disagrees with the rows: a row with
		// no open edge yet, or an open edge whose row is gone. Marking every
		// peer on every write would make two dependent tasks re-mark each
		// other forever.
		wantIn := map[string]NodeRef{}
		for _, p := range want.Peers {
			wantIn[p.key()] = p
		}
		var stale []NodeRef
		for k, p := range wantIn {
			if _, ok := incoming[k]; !ok {
				stale = append(stale, p)
			}
		}
		for k, p := range incoming {
			if _, ok := wantIn[k]; !ok {
				stale = append(stale, p)
			}
		}
		if err := markDirty(ctx, q, org, stale, ev); err != nil {
			return drift, err
		}
	}
	return drift, nil
}

func reconcileFacts(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, want Desired, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	types := factScopes[ref.Type]
	if len(types) == 0 {
		return drift, nil
	}
	rows, err := q.GraphListOpenFacts(ctx, db.GraphListOpenFactsParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return drift, err
	}
	cur := map[string]db.GraphNodeFact{}
	for _, r := range rows {
		cur[r.FactType] = r
	}
	wants := map[string]FactWant{}
	for _, f := range want.Facts {
		wants[f.Type] = f
	}
	closeFact := func(c db.GraphNodeFact) error {
		return q.GraphCloseFact(ctx, db.GraphCloseFactParams{OrganizationID: org, ID: c.ID, ValidTo: ts(ev.closeAt())})
	}
	openFact := func(w FactWant, prev *db.GraphNodeFact) error {
		at, backfill := ev.openAt(*want.Node)
		extra := map[string]any{}
		if w.Precision != "" {
			extra["precision"] = w.Precision
		}
		if prev != nil {
			extra["previous"] = prev.Value
			if p := factPrecision(*prev); p != "" {
				extra["previous_precision"] = p
			}
		}
		return q.GraphOpenFact(ctx, db.GraphOpenFactParams{
			ID: util.NewID(), OrganizationID: org, NodeID: nodeID, FactType: w.Type, Value: w.Value,
			ValidFrom: ts(at), EvidenceKind: ev.EvidenceKind, EvidenceID: ev.evidence(ref), Attrs: attrs(backfill, ev, extra),
		})
	}
	for _, t := range types {
		c, has := cur[t]
		w, wanted := wants[t]
		switch {
		case has && !wanted:
			drift.ExtraFacts++
			if write {
				if err := closeFact(c); err != nil {
					return drift, err
				}
			}
		case wanted && !has:
			drift.MissingFacts++
			if write {
				if err := openFact(w, nil); err != nil {
					return drift, err
				}
			}
		case has && wanted && (c.Value != w.Value || factPrecision(c) != w.Precision):
			drift.ChangedFacts++
			if write {
				if err := closeFact(c); err != nil {
					return drift, err
				}
				if err := openFact(w, &c); err != nil {
					return drift, err
				}
			}
		}
	}
	return drift, nil
}

// resolvePeer finds the live node for ref, projecting its node row from the
// source when the graph does not have it yet (an event the marker never saw,
// such as the default workspace room). ok is false when the source is gone.
func resolvePeer(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo, write bool) (string, bool, error) {
	n, err := q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
		OrganizationID: org, NodeType: string(ref.Type), SourceID: ref.SourceID,
	})
	if err == nil && !n.DeletedAt.Valid {
		return n.ID, true, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	d, err := load(ctx, q, org, ref)
	if err != nil {
		return "", false, err
	}
	if d.Node == nil {
		return "", false, nil
	}
	if !write {
		return "", true, nil
	}
	row, err := upsertNode(ctx, q, org, *d.Node)
	if err != nil {
		return "", false, err
	}
	if ev.EvidenceKind == EvidenceOutboxEvent {
		// The peer's own edges follow when the worker projects it.
		if err := markDirty(ctx, q, org, []NodeRef{ref}, ev); err != nil {
			return "", false, err
		}
	}
	// A peer this brings back (n was a deleted row; zero when there was none)
	// is live by the time its own projection runs, so its revival marks here.
	if err := markPeersOfClosedEdges(ctx, q, org, n, ev); err != nil {
		return "", false, err
	}
	return row.ID, true, nil
}

// markPeersOfClosedEdges runs when a deleted node (prev, as read before the
// upsert) comes back to life: deleteNode closed the edges at both ends, and
// only an edge's owner reopens it, so the other ends of the edges closed
// since the deletion are marked dirty (a peer that owns none of them projects
// to no change). Only on the outbox path: a rebuild projects every node
// anyway.
func markPeersOfClosedEdges(ctx context.Context, q *db.Queries, org string, prev db.GraphNode, ev EventInfo) error {
	if !prev.DeletedAt.Valid || ev.EvidenceKind != EvidenceOutboxEvent {
		return nil
	}
	rows, err := q.GraphListPeersOfEdgesClosedSince(ctx, db.GraphListPeersOfEdgesClosedSinceParams{
		OrganizationID: org, NodeID: prev.ID, Since: prev.DeletedAt,
	})
	if err != nil {
		return err
	}
	peers := make([]NodeRef, 0, len(rows))
	for _, r := range rows {
		peers = append(peers, NodeRef{Type: graph.NodeType(r.PeerType), SourceID: r.PeerSourceID})
	}
	return markDirty(ctx, q, org, peers, ev)
}

func upsertNode(ctx context.Context, q *db.Queries, org string, n NodeState) (db.GraphNode, error) {
	row, err := q.GraphUpsertNode(ctx, db.GraphUpsertNodeParams{
		ID: util.NewID(), OrganizationID: org, WorkspaceID: optText(n.WorkspaceID), NodeType: string(n.Ref.Type),
		Subtype: n.Subtype, SourceID: n.Ref.SourceID, Title: n.Title, Status: n.Status, Visibility: n.Visibility,
		ReaderIds: sortedUnique(n.ReaderIDs), OccurredAt: optTime(n.OccurredAt), SourceUpdatedAt: optTime(n.SourceUpdatedAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing changed: the conditional update skipped the row.
		return q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
			OrganizationID: org, NodeType: string(n.Ref.Type), SourceID: n.Ref.SourceID,
		})
	}
	return row, err
}

func deleteNode(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, ev EventInfo) error {
	at := ts(ev.closeAt())
	if err := q.GraphCloseNodeEdges(ctx, db.GraphCloseNodeEdgesParams{OrganizationID: org, NodeID: nodeID, ValidTo: at, ClosedBy: ev.evidence(ref)}); err != nil {
		return err
	}
	if err := q.GraphCloseNodeFacts(ctx, db.GraphCloseNodeFactsParams{OrganizationID: org, NodeID: nodeID, ValidTo: at}); err != nil {
		return err
	}
	return q.GraphMarkNodeDeleted(ctx, db.GraphMarkNodeDeletedParams{OrganizationID: org, ID: nodeID, At: at})
}

// nodeDiffers compares every column GraphUpsertNode's IS DISTINCT FROM
// compares (bar deleted_at, which reconcile handles as live), so Verify
// counts what Project rewrites. source_updated_at is in neither: rooms,
// departments and meetings bump updated_at on activity no marked event
// follows (a message, a reorder, a host transfer), so comparing it would
// report a correct node as drift. It is still written with any other change.
func nodeDiffers(cur db.GraphNode, n NodeState) bool {
	return textOf(cur.WorkspaceID) != n.WorkspaceID || cur.Subtype != n.Subtype || cur.Title != n.Title ||
		cur.Status != n.Status || cur.Visibility != n.Visibility || !slices.Equal(cur.ReaderIds, sortedUnique(n.ReaderIDs)) ||
		!sameTime(cur.OccurredAt, n.OccurredAt)
}

// sameTime matches optTime: a zero time is stored as NULL, anything else is
// compared as an instant.
func sameTime(cur pgtype.Timestamptz, t time.Time) bool {
	return cur.Valid == !t.IsZero() && (!cur.Valid || cur.Time.Equal(t))
}

func factPrecision(f db.GraphNodeFact) string {
	var a struct {
		Precision string `json:"precision"`
	}
	_ = json.Unmarshal(f.Attrs, &a)
	return a.Precision
}

func attrs(backfill bool, ev EventInfo, extra map[string]any) []byte {
	m := map[string]any{}
	for k, v := range extra {
		m[k] = v
	}
	if backfill {
		m["backfill"] = true
	}
	if ev.EvidenceKind == EvidenceSourceRow {
		m["source"] = "rebuild"
	}
	b, _ := json.Marshal(m)
	return b
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func optTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()} }

func optText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
