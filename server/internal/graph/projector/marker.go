package projector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Marker is the outbox consumer that feeds the projector. It runs on the
// realtime lane: one upsert into graph_dirty, no source read, so no topic
// changes lane and a projector failure never retries a realtime frame
// (spec §5.2, §13 #1).
type Marker struct {
	q       *db.Queries
	enabled func(ctx context.Context, orgID string) bool
	metrics Metrics
}

// NewMarker wires the marker. enabled answers the graph flag for an
// organization; nil marks everything.
func NewMarker(q *db.Queries, enabled func(ctx context.Context, orgID string) bool) *Marker {
	return &Marker{q: q, enabled: enabled}
}

// SetMetrics attaches counters; called once from main.
func (m *Marker) SetMetrics(x Metrics) { m.metrics = x }

// Name identifies the consumer in dispatcher errors.
func (*Marker) Name() string { return "graph_marker" }

// Topics is every topic that changes a projected node.
func (*Marker) Topics() []string { return Topics() }

// Handle marks the row's node dirty. Idempotent: a retried row bumps
// mark_seq on the same dirty row and the projection converges on the source.
func (m *Marker) Handle(ctx context.Context, ev outbox.Row) error {
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("graph marker: payload of %s: %w", ev.ID, err)
	}
	refs := Refs(ev.Topic, p)
	if len(refs) == 0 {
		m.count(ev.Topic, "no_id")
		return nil
	}
	org := ev.OrganizationID.String
	if !ev.OrganizationID.Valid || org == "" {
		// No retry adds an organization; graph-rebuild covers the node.
		m.count(ev.Topic, "no_org")
		return nil
	}
	if m.enabled != nil && !m.enabled(ctx, org) {
		m.count(ev.Topic, "disabled")
		return nil
	}
	if err := markDirty(ctx, m.q, org, refs, EventInfo{
		EvidenceKind: EvidenceOutboxEvent, EvidenceID: ev.ID, At: ev.CreatedAt.Time,
		ActorKind: ev.ActorKind.String, ActorID: ev.ActorID.String,
	}); err != nil {
		return err
	}
	m.count(ev.Topic, "marked")
	return nil
}

func (m *Marker) count(topic, result string) {
	if m.metrics != nil {
		m.metrics.IncGraphMarked(topic, result)
	}
}
