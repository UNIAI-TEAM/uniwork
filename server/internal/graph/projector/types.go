// Package projector is the only writer of the Work Graph (C-11, ADR 0019).
// It reads a node's source row, computes what the graph should hold for it
// (Desired), compares with the open edges and facts, closes what is no longer
// true and opens what is missing. The marker consumer and the worker feed it
// from the outbox; cmd/graph-rebuild runs the same reconcile over a whole
// organization.
package projector

import (
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
)

// Evidence kinds a projected edge or fact can cite.
const (
	EvidenceOutboxEvent = "outbox_event"
	EvidenceSourceRow   = "source_row"
)

// NodeRef names a node by its source row inside one organization.
type NodeRef struct {
	Type     graph.NodeType
	SourceID string
}

func (r NodeRef) key() string { return string(r.Type) + ":" + r.SourceID }

// NodeState is what a node should look like, read from its source.
type NodeState struct {
	Ref             NodeRef
	WorkspaceID     string // "" for organization-level nodes
	Subtype         string
	Title           string
	Status          string
	Visibility      string
	ReaderIDs       []string
	OccurredAt      time.Time
	SourceUpdatedAt time.Time
}

// EdgeWant is one SYSTEM edge the node's projection owns. Out is the
// direction seen from the node: true when the node is the from end.
type EdgeWant struct {
	Type graph.EdgeType
	Out  bool
	Peer NodeRef
}

func (e EdgeWant) key() string {
	dir := "<"
	if e.Out {
		dir = ">"
	}
	return string(e.Type) + dir + e.Peer.key()
}

// FactWant is one open fact the node should carry.
type FactWant struct {
	Type      string
	Value     string
	Precision string // "date" | "datetime" for due; "" otherwise
}

// Desired is a node's projection computed from its source. Node nil means the
// source is gone or is not projected (a DM room): the node is deleted. Peers
// are the owners of incoming edges this source implies (the from end of a
// dependency on this task); reconcile marks a peer dirty only when its edge
// and the source disagree, so two tasks never re-mark each other forever.
type Desired struct {
	Node  *NodeState
	Edges []EdgeWant
	Facts []FactWant
	Peers []NodeRef
	seen  map[string]bool
}

func (d *Desired) edge(t graph.EdgeType, out bool, peerType graph.NodeType, peerID string) {
	if peerID == "" || (d.Node != nil && peerType == d.Node.Ref.Type && peerID == d.Node.Ref.SourceID) {
		return
	}
	w := EdgeWant{Type: t, Out: out, Peer: NodeRef{Type: peerType, SourceID: peerID}}
	if d.seen == nil {
		d.seen = map[string]bool{}
	}
	if d.seen[w.key()] {
		return
	}
	d.seen[w.key()] = true
	d.Edges = append(d.Edges, w)
}

// EventInfo is why a projection runs: the newest outbox event folded into a
// dirty row, or a rebuild (EvidenceSourceRow, At zero).
type EventInfo struct {
	EvidenceKind string
	EvidenceID   string
	At           time.Time
	ActorKind    string
	ActorID      string
	// fresh is set by reconcile when this projection brings the node to life;
	// a rebuild then dates new edges by the source, not by today.
	fresh bool
}

func (e EventInfo) evidence(ref NodeRef) string {
	if e.EvidenceKind == EvidenceSourceRow || e.EvidenceID == "" {
		return ref.SourceID
	}
	return e.EvidenceID
}

// openAt is the business time a new edge or fact starts, and whether it is a
// backfill (the source predates the graph; the true start is unknown).
func (e EventInfo) openAt(n NodeState) (time.Time, bool) {
	if !e.At.IsZero() {
		return e.At, false
	}
	now := time.Now().UTC()
	// A source dated in the future (an upcoming meeting's start) is clamped to
	// now: a relation that exists today must not read as not yet valid.
	if e.fresh && !n.OccurredAt.IsZero() && n.OccurredAt.Before(now) {
		return n.OccurredAt, true
	}
	return now, false
}

func (e EventInfo) closeAt() time.Time {
	if !e.At.IsZero() {
		return e.At
	}
	return time.Now().UTC()
}

// Drift counts what a projection changed (Project) or would change (Verify).
type Drift struct {
	MissingNodes int `json:"missing_nodes"`
	ExtraNodes   int `json:"extra_nodes"`
	ChangedNodes int `json:"changed_nodes"`
	MissingEdges int `json:"missing_edges"`
	ExtraEdges   int `json:"extra_edges"`
	MissingFacts int `json:"missing_facts"`
	ExtraFacts   int `json:"extra_facts"`
	ChangedFacts int `json:"changed_facts"`
}

// Total is the number of rows that differ.
func (d Drift) Total() int {
	return d.MissingNodes + d.ExtraNodes + d.ChangedNodes + d.MissingEdges + d.ExtraEdges +
		d.MissingFacts + d.ExtraFacts + d.ChangedFacts
}

// Add folds o into d.
func (d *Drift) Add(o Drift) {
	d.MissingNodes += o.MissingNodes
	d.ExtraNodes += o.ExtraNodes
	d.ChangedNodes += o.ChangedNodes
	d.MissingEdges += o.MissingEdges
	d.ExtraEdges += o.ExtraEdges
	d.MissingFacts += o.MissingFacts
	d.ExtraFacts += o.ExtraFacts
	d.ChangedFacts += o.ChangedFacts
}
