package projector

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDueFactPrefersTheTimestamp(t *testing.T) {
	at := time.Date(2026, 10, 20, 9, 30, 0, 0, time.FixedZone("ICT", 7*3600))
	task := db.Task{
		DueAt:   pgtype.Timestamptz{Time: at, Valid: true},
		DueDate: pgtype.Date{Time: time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC), Valid: true},
	}
	f, ok := dueFact(task)
	if !ok || f.Value != "2026-10-20T02:30:00Z" || f.Precision != "datetime" {
		t.Fatalf("due = %+v", f)
	}
	task.DueAt = pgtype.Timestamptz{}
	if f, ok = dueFact(task); !ok || f.Value != "2026-10-19" || f.Precision != "date" {
		t.Fatalf("date due = %+v", f)
	}
	if _, ok = dueFact(db.Task{}); ok {
		t.Fatal("no due, no fact")
	}
}

func TestAssigneeRef(t *testing.T) {
	text := func(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
	cases := []struct {
		typ, id string
		ok      bool
	}{{"member", "u1", true}, {"agent", "a1", true}, {"", "u1", true}, {"squad", "s1", false}, {"member", "", false}}
	for _, c := range cases {
		ref, ok := assigneeRef(db.Task{AssigneeType: text(c.typ), AssigneeID: text(c.id)})
		if ok != c.ok || (ok && (ref.Type != graph.NodeActor || ref.SourceID != c.id)) {
			t.Errorf("assigneeRef(%q, %q) = %+v, %v", c.typ, c.id, ref, ok)
		}
	}
}

func TestDesiredDeduplicatesAndSkipsSelf(t *testing.T) {
	d := Desired{Node: &NodeState{Ref: NodeRef{Type: graph.NodeTask, SourceID: "t1"}}}
	d.edge(graph.EdgeDependsOn, true, graph.NodeTask, "t2")
	d.edge(graph.EdgeDependsOn, true, graph.NodeTask, "t2")
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTask, "t1")
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, "")
	if len(d.Edges) != 1 {
		t.Fatalf("edges = %+v", d.Edges)
	}
}

func TestInScope(t *testing.T) {
	if !inScope(graph.NodeMeeting, graph.EdgeParticipatedIn, false) || inScope(graph.NodeTask, graph.EdgeDependsOn, false) {
		t.Fatal("scopes")
	}
}
