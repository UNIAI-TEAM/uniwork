package projector

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type countingMetrics struct{ marked, projected map[string]int }

func (c *countingMetrics) IncGraphMarked(topic, result string) { c.marked[topic+"/"+result]++ }
func (c *countingMetrics) IncGraphProjected(nodeType, result string) {
	c.projected[nodeType+"/"+result]++
}
func (c *countingMetrics) ObserveGraphLag(time.Duration) {}

func row(id, topic, payload, org string) db.OutboxEvent {
	return db.OutboxEvent{ID: id, Topic: topic, Payload: payload,
		OrganizationID: pgtype.Text{String: org, Valid: org != ""},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true}}
}

func TestMarkerIgnoresDisabledOrganizations(t *testing.T) {
	f := newFixture(t)
	m := &countingMetrics{marked: map[string]int{}, projected: map[string]int{}}
	marker := NewMarker(f.q, func(_ context.Context, org string) bool { return org == "org-on" })
	marker.SetMetrics(m)
	for _, ev := range []db.OutboxEvent{
		row("e1", "task.updated", `{"task_id":"t1"}`, "org-on"),
		row("e2", "task.updated", `{"task_id":"t2"}`, "org-off"),
		row("e3", "task.updated", `{"task_id":"t3"}`, ""),
		row("e4", "task.updated", `{}`, "org-on"),
		row("e5", "chat.channel.updated", `{"room_id":"r1","workspace_id":"w"}`, "org-on"),
	} {
		if err := marker.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.count(t, `SELECT count(*) FROM graph_dirty WHERE organization_id IN ('org-on', 'org-off')`); n != 2 {
		t.Fatalf("dirty rows = %d, want 2 (t1, r1)", n)
	}
	if m.marked["task.updated/disabled"] != 1 || m.marked["task.updated/no_org"] != 1 || m.marked["task.updated/no_id"] != 1 {
		t.Fatalf("marked = %v", m.marked)
	}
	// A retried row folds into the same dirty row.
	if err := marker.Handle(f.ctx, row("e1", "task.updated", `{"task_id":"t1"}`, "org-on")); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT mark_seq FROM graph_dirty WHERE source_id = 't1'`); n != 2 {
		t.Fatalf("mark_seq = %d, want 2", n)
	}
	if err := marker.Handle(f.ctx, row("e9", "task.updated", `not json`, "org-on")); err == nil {
		t.Fatal("malformed payload must fail (retried, then dead-lettered like other consumers)")
	}
}
