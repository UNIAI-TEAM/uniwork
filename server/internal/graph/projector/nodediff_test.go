package projector

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// nodeDiffers must see every column GraphUpsertNode compares, so Verify
// counts what Project rewrites.
func TestNodeDiffersComparesTheTimes(t *testing.T) {
	occurred := time.Date(2026, 10, 20, 9, 30, 0, 123456000, time.UTC)
	updated := time.Date(2026, 10, 21, 8, 0, 0, 654321000, time.UTC)
	ict := time.FixedZone("ICT", 7*3600)
	want := NodeState{
		Ref: NodeRef{Type: graph.NodeMeeting, SourceID: "m1"}, WorkspaceID: "w1", Subtype: "meeting",
		Title: "Weekly", Status: "scheduled", Visibility: graph.VisWorkspace, ReaderIDs: []string{"u2", "u1"},
		OccurredAt: occurred, SourceUpdatedAt: updated,
	}
	// What the row holds after Project wrote want; pgx may hand back the
	// same instants in another zone.
	row := func() db.GraphNode {
		return db.GraphNode{
			WorkspaceID: pgtype.Text{String: "w1", Valid: true}, Subtype: "meeting", Title: "Weekly",
			Status: "scheduled", Visibility: graph.VisWorkspace, ReaderIds: []string{"u1", "u2"},
			OccurredAt:      pgtype.Timestamptz{Time: occurred.In(ict), Valid: true},
			SourceUpdatedAt: pgtype.Timestamptz{Time: updated.In(ict), Valid: true},
		}
	}

	if nodeDiffers(row(), want) {
		t.Error("identical node reported as changed")
	}

	moved := want
	moved.OccurredAt = occurred.Add(time.Hour) // a rescheduled meeting
	if !nodeDiffers(row(), moved) {
		t.Error("node differing only in occurred_at not reported")
	}

	touched := want
	touched.SourceUpdatedAt = updated.Add(time.Microsecond)
	if !nodeDiffers(row(), touched) {
		t.Error("node differing only in source_updated_at not reported")
	}

	// A workspace member has no source_updated_at: the zero time is stored
	// as NULL, and the two are the same state.
	member := want
	member.SourceUpdatedAt = time.Time{}
	stored := row()
	stored.SourceUpdatedAt = pgtype.Timestamptz{}
	if nodeDiffers(stored, member) {
		t.Error("zero source_updated_at vs NULL column reported as changed")
	}
	if !nodeDiffers(stored, want) {
		t.Error("NULL column vs a set source_updated_at not reported")
	}
	if !nodeDiffers(row(), member) {
		t.Error("set column vs a zero source_updated_at not reported")
	}
}
