package projector

import (
	"context"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// markDirty queues refs for the worker, folding the event into any row
// already waiting. Duplicates are dropped here: one statement cannot upsert
// the same row twice.
func markDirty(ctx context.Context, q *db.Queries, org string, refs []NodeRef, ev EventInfo) error {
	seen := map[string]bool{}
	var types, ids []string
	for _, r := range refs {
		if r.SourceID == "" || seen[r.key()] {
			continue
		}
		seen[r.key()] = true
		types = append(types, string(r.Type))
		ids = append(ids, r.SourceID)
	}
	if len(ids) == 0 {
		return nil
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return q.GraphMarkDirty(ctx, db.GraphMarkDirtyParams{
		OrganizationID: org, NodeTypes: types, SourceIds: ids, EventID: ev.EvidenceID,
		EventAt: ts(at), ActorKind: ev.ActorKind, ActorID: ev.ActorID,
	})
}
