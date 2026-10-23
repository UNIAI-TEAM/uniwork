package metrics

import (
	"context"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func TestGraphMetricsAreExposed(t *testing.T) {
	reg := NewRegistry(RegistryOptions{})
	reg.Graph.IncGraphMarked("task.updated", "marked")
	reg.Graph.IncGraphProjected("TASK", "ok")
	reg.Graph.ObserveGraphLag(2 * time.Second)
	reg.Graph.IncGraphLayer2Dropped("THREAD")
	rec := httptest.NewRecorder()
	NewHandler(reg.Gatherer).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`uniwork_graph_marked_total{result="marked",topic="task.updated"} 1`,
		`uniwork_graph_projected_total{node_type="TASK",result="ok"} 1`,
		`uniwork_graph_projector_lag_seconds_count 1`,
		`uniwork_graph_layer2_dropped_total{node_type="THREAD"} 1`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %s", want)
		}
	}
}

// The dirty gauges count every waiting node and age the oldest event among
// them; an empty table reads as 0, not absent, so the lag alert sees a value.
func TestGraphDirtyCollectorReadsPendingAndOldest(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	c := NewGraphDirtyCollector(pool)
	values := gatherGauges(t, c)
	for _, key := range []string{"uniwork_graph_dirty_pending", "uniwork_graph_dirty_oldest_seconds"} {
		if v, ok := values[key]; !ok || v != 0 {
			t.Fatalf("%s on an empty table = %v (present %v), want 0", key, v, ok)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO graph_dirty (organization_id, node_type, source_id, last_event_at) VALUES
		  ('org-a', 'TASK',    't1', now() - interval '2 hours'),
		  ('org-a', 'MEETING', 'm1', now() - interval '1 minute'),
		  ('org-b', 'TASK',    't2', now())
	`); err != nil {
		t.Fatalf("seed graph_dirty: %v", err)
	}
	values = gatherGauges(t, c)
	if v := values["uniwork_graph_dirty_pending"]; v != 3 {
		t.Fatalf("pending = %v, want 3", v)
	}
	if v := values["uniwork_graph_dirty_oldest_seconds"]; v < 7000 || v > 7400 {
		t.Fatalf("oldest = %v, want about two hours", v)
	}
	if v, ok := values["uniwork_graph_dirty_lag_up"]; !ok || v != 1 {
		t.Fatalf("lag_up = %v (present %v), want 1", v, ok)
	}
}

// A failed read reports lag_up 0 and no age, so an unreachable database never
// reads as a projector that has caught up.
func TestGraphDirtyCollectorFailedReadIsAbsentNotZero(t *testing.T) {
	values := gatherGauges(t, NewGraphDirtyCollector(unreachablePool(t)))
	if v, ok := values["uniwork_graph_dirty_lag_up"]; !ok || v != 0 {
		t.Fatalf("lag_up = %v (present %v), want 0", v, ok)
	}
	if len(values) != 1 {
		t.Fatalf("only lag_up may be reported after a failed read: %v", values)
	}
}
