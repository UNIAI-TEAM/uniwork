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
			var firstSeq int64
			if err := pool.QueryRow(ctx, `SELECT mark_seq FROM graph_dirty
				WHERE organization_id = 'org-a' AND node_type = 'TASK' AND source_id = $1`, source).Scan(&firstSeq); err != nil {
				t.Fatal(err)
			}
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
			// availableNow: back from the hour GraphFailDirty set, with slack for
			// a DB clock that steps back between the mark and this read.
			if err := pool.QueryRow(ctx, `SELECT mark_seq, last_event_id, last_event_at, actor_kind, actor_id,
				attempts, last_error, available_at < now() + interval '1 minute'
				FROM graph_dirty WHERE organization_id = 'org-a' AND node_type = 'TASK' AND source_id = $1`, source,
			).Scan(&seq, &event, &at, &kind, &actor, &attempts, &lastError, &availableNow); err != nil {
				t.Fatal(err)
			}
			if event != "evt-2" || !at.Equal(t2) || kind != "agent" || actor != "agent-2" {
				t.Errorf("event fields = (%s, %s, %s, %s), want (evt-2, %s, agent, agent-2)",
					event, at.UTC().Format(time.RFC3339), kind, actor, t2.Format(time.RFC3339))
			}
			if seq == firstSeq {
				t.Errorf("mark_seq = %d after a second mark, want a value other than the first mark's", seq)
			}
			if attempts != 0 || lastError != "" || !availableNow {
				t.Errorf("queue fields = (attempts %d, last_error %q, available now %v), want (0, \"\", true)",
					attempts, lastError, availableNow)
			}
		})
	}
}

// mark_seq fences GraphDoneDirty, so a mark committed after a claim must not
// carry the claimed value.
// A worker whose lease ran out mid-batch still holds its claim while a second
// worker claims the row, projects it and deletes it, and the next mark inserts
// the row again. Counted per row from 1, that mark took the value the first
// claim held, and the first worker's delete removed a mark it never projected.
func TestGraphDoneDirtyLeavesAMarkInsertedAfterAnExpiredClaim(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	q := db.New(pool)

	const org, typ, source = "org-a", "TASK", "task-aba"
	backdate := func(set string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `UPDATE graph_dirty SET `+set+`
			WHERE organization_id = $1 AND node_type = $2 AND source_id = $3`, org, typ, source); err != nil {
			t.Fatal(err)
		}
	}
	mark := func() {
		t.Helper()
		if err := q.GraphMarkDirty(ctx, db.GraphMarkDirtyParams{
			OrganizationID: org, NodeTypes: []string{typ}, SourceIds: []string{source},
			EventID: "evt", EventAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, ActorKind: "human", ActorID: "user-1",
		}); err != nil {
			t.Fatal(err)
		}
		// Due a second ago, so a DB clock that steps back cannot hide it from
		// the claim that follows.
		backdate(`available_at = now() - interval '1 second'`)
	}
	claim := func() db.GraphDirty {
		t.Helper()
		rows, err := q.GraphClaimDirty(ctx, db.GraphClaimDirtyParams{LeaseSeconds: 60, Batch: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 {
			t.Fatalf("claimed %d rows, want the one dirty row", len(rows))
		}
		return rows[0]
	}
	done := func(seq int64) int64 {
		t.Helper()
		n, err := q.GraphDoneDirty(ctx, db.GraphDoneDirtyParams{OrganizationID: org, NodeType: typ, SourceID: source, MarkSeq: seq})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	mark()
	first := claim()
	backdate(`locked_until = now() - interval '1 second'`) // the first claim's lease runs out
	second := claim()
	if n := done(second.MarkSeq); n != 1 {
		t.Fatalf("the live claim deleted %d rows, want 1", n)
	}
	mark()
	if n := done(first.MarkSeq); n != 0 {
		t.Fatalf("the expired claim (mark_seq %d) deleted the mark that came after it", first.MarkSeq)
	}
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM graph_dirty WHERE source_id = $1`, source).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 1 {
		t.Fatalf("dirty rows = %d, want the new mark", left)
	}
}
