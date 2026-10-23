package projector

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// load reads ref's source and returns what the graph should hold for it.
func load(ctx context.Context, q *db.Queries, org string, ref NodeRef) (Desired, error) {
	switch ref.Type {
	case graph.NodeTask:
		return loadTask(ctx, q, org, ref.SourceID)
	case graph.NodeMeeting:
		return loadMeeting(ctx, q, org, ref.SourceID)
	case graph.NodeProject:
		return loadProject(ctx, q, org, ref.SourceID)
	case graph.NodeActor:
		return loadActor(ctx, q, org, ref.SourceID)
	case graph.NodeTeam:
		return loadTeam(ctx, q, org, ref.SourceID)
	case graph.NodeThread:
		return loadThread(ctx, q, org, ref.SourceID)
	}
	return Desired{}, fmt.Errorf("graph: %s is not projected in slice 1", ref.Type)
}

func timeOf(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time.UTC()
}

func textOf(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

// sortedUnique never returns nil: pgx encodes a nil []string as SQL NULL.
func sortedUnique(ids []string) []string {
	out := append([]string{}, ids...)
	slices.Sort(out)
	return slices.Compact(out)
}
