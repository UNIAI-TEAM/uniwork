package graph

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A dirty row's event fields (id, time, actor) come from one event, the
// latest by time, whatever order the realtime lane marks them in: the worker
// dates and attributes the edges it opens from this row, so a mix would cite
// one event and its actor for another event's change. An older event still
// re-dirties the node, so the queue fields reset on every mark.
func TestGraphMarkDirtyKeepsTheLatestEventWhole(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	q := db.New(pool)

	t1 := time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Minute)
	mark := func(source, event string, at time.Time, kind, actor string) {
		t.Helper()
		if err := q.GraphMarkDirty(ctx, db.GraphMarkDirtyParams{
			OrganizationID: "org-a", NodeTypes: []string{"TASK"}, SourceIds: []string{source},
			EventID: event, EventAt: pgtype.Timestamptz{Time: at, Valid: true}, ActorKind: kind, ActorID: actor,
		}); err != nil {
			t.Fatal(err)
		}
	}
	older := func(source string) { mark(source, "evt-1", t1, "human", "user-1") }
	newer := func(source string) { mark(source, "evt-2", t2, "agent", "agent-2") }

	cases := []struct {
		name          string
		first, second func(string)
	}{
		{"in order", older, newer},
		{"newer marked first", newer, older},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			source := "task-" + c.name
			c.first(source)
			// Claim and fail the row so the second mark has queue state to reset.
			if _, err := q.GraphClaimDirty(ctx, db.GraphClaimDirtyParams{LeaseSeconds: 60, Batch: 10}); err != nil {
				t.Fatal(err)
			}
			if err := q.GraphFailDirty(ctx, db.GraphFailDirtyParams{
				AvailableAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, LastError: "boom",
				OrganizationID: "org-a", NodeType: "TASK", SourceID: source,
			}); err != nil {
				t.Fatal(err)
			}
			c.second(source)

			var (
				seq          int64
				event        string
				at           time.Time
				kind, actor  string
				attempts     int32
				lastError    string
				availableNow bool
			)
			if err := pool.QueryRow(ctx, `SELECT mark_seq, last_event_id, last_event_at, actor_kind, actor_id,
				attempts, last_error, available_at <= now()
				FROM graph_dirty WHERE organization_id = 'org-a' AND node_type = 'TASK' AND source_id = $1`, source,
			).Scan(&seq, &event, &at, &kind, &actor, &attempts, &lastError, &availableNow); err != nil {
				t.Fatal(err)
			}
			if event != "evt-2" || !at.Equal(t2) || kind != "agent" || actor != "agent-2" {
				t.Errorf("event fields = (%s, %s, %s, %s), want (evt-2, %s, agent, agent-2)",
					event, at.UTC().Format(time.RFC3339), kind, actor, t2.Format(time.RFC3339))
			}
			if seq != 2 {
				t.Errorf("mark_seq = %d, want 2", seq)
			}
			if attempts != 0 || lastError != "" || !availableNow {
				t.Errorf("queue fields = (attempts %d, last_error %q, available now %v), want (0, \"\", true)",
					attempts, lastError, availableNow)
			}
		})
	}
}
