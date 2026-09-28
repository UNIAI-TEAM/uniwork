package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// The document counters and their label vocabulary (G1-09): every family the
// service emits must be registered by NewRegistry, and no label carries a
// document, user, organization or workspace id.
func TestDocumentMetricsExposeSaveAndWorkerSignals(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	d := registry.Documents

	d.IncDocumentAccessLogFailed()
	d.IncDocumentVersionsProtectedOverflow()
	d.ObserveDocumentSave("page", "ok", 0.012)
	d.ObserveDocumentSave("file", "conflict", 0.4)
	d.IncDocumentConflict("file", "document_version_conflict")
	d.IncDocumentQuotaRejected("page")
	d.ObserveDocumentWorkerSweep("purge", "error", 3.5)

	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()

	for _, want := range []string{
		"uniwork_document_access_log_failed_total 1",
		"uniwork_document_versions_protected_overflow_total 1",
		`uniwork_document_saves_total{kind="page",outcome="ok"} 1`,
		`uniwork_document_saves_total{kind="file",outcome="conflict"} 1`,
		`uniwork_document_save_duration_seconds_count{kind="page"} 1`,
		`uniwork_document_save_duration_seconds_count{kind="file"} 1`,
		`uniwork_document_conflicts_total{code="document_version_conflict",kind="file"} 1`,
		`uniwork_document_quota_rejects_total{kind="page"} 1`,
		`uniwork_document_worker_sweeps_total{result="error",worker="purge"} 1`,
		`uniwork_document_worker_sweep_duration_seconds_count{worker="purge"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
}

// The lag collector reads the queues its workers drain: a quiet page with no
// snapshot, an archived document past purge_after and an orphaned asset past
// its grace all show up as pending seconds; a drained queue reads 0.
func TestDocumentLagCollectorReadsWorkerQueues(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
			created_by, created_by_kind, updated_by, updated_by_kind,
			content_saved_at, archived_at, purge_after)
		VALUES
			('01LAGDOC00000000000000000A', '01LAGORG000000000000000000', '01LAGWS0000000000000000000', 'page', 'quiet', 'workspace',
				'01LAGUSR000000000000000000', 'human', '01LAGUSR000000000000000000', 'human',
				now() - interval '1 hour', NULL, NULL),
			('01LAGDOC00000000000000000B', '01LAGORG000000000000000000', '01LAGWS0000000000000000000', 'page', 'archived', 'workspace',
				'01LAGUSR000000000000000000', 'human', '01LAGUSR000000000000000000', 'human',
				NULL, now() - interval '30 days', now() - interval '2 hours')
	`); err != nil {
		t.Fatalf("seed documents: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO document_assets (id, organization_id, workspace_id, document_id, file_id,
			mime_type, size_bytes, created_by, created_by_kind, orphaned_at)
		VALUES ('01LAGASSET0000000000000000', '01LAGORG000000000000000000', '01LAGWS0000000000000000000',
			'01LAGDOC00000000000000000A', '01LAGFILE00000000000000000', 'image/png', 10,
			'01LAGUSR000000000000000000', 'human', now() - interval '7 days' - interval '2 hours')
	`); err != nil {
		t.Fatalf("seed asset: %v", err)
	}

	// Older orphans the purge worker never picks up: one on the archived
	// document (it purges whole with its rows) and one whose document row is
	// gone. Counting either would report a backlog nobody drains.
	if _, err := pool.Exec(ctx, `
		INSERT INTO document_assets (id, organization_id, workspace_id, document_id, file_id,
			mime_type, size_bytes, created_by, created_by_kind, orphaned_at)
		VALUES
			('01LAGASSET000000000000000B', '01LAGORG000000000000000000', '01LAGWS0000000000000000000',
				'01LAGDOC00000000000000000B', '01LAGFILE0000000000000000B', 'image/png', 10,
				'01LAGUSR000000000000000000', 'human', now() - interval '7 days' - interval '5 hours'),
			('01LAGASSET000000000000000C', '01LAGORG000000000000000000', '01LAGWS0000000000000000000',
				'01LAGDOC00000000000000000Z', '01LAGFILE0000000000000000C', 'image/png', 10,
				'01LAGUSR000000000000000000', 'human', now() - interval '7 days' - interval '6 hours')
	`); err != nil {
		t.Fatalf("seed undrainable assets: %v", err)
	}

	clock := time.Now()
	c := NewDocumentLagCollector(pool)
	c.now = func() time.Time { return clock }
	values := gatherGauges(t, c)
	if v := values["uniwork_document_worker_oldest_pending_seconds|autoversion"]; v < 3000 || v > 4200 {
		t.Fatalf("autoversion lag = %v, want about one hour", v)
	}
	if v := values["uniwork_document_worker_oldest_pending_seconds|purge"]; v < 6000 || v > 9000 {
		t.Fatalf("purge lag = %v, want about two hours (the oldest drainable item)", v)
	}
	for _, w := range []string{"autoversion", "purge"} {
		if v := values["uniwork_document_worker_lag_up|"+w]; v != 1 {
			t.Fatalf("lag_up{%s} = %v, want 1", w, v)
		}
	}

	// Inside the cache window a scrape reuses the last read: an older quiet
	// page shows only once the window has passed.
	if _, err := pool.Exec(ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
			created_by, created_by_kind, updated_by, updated_by_kind, content_saved_at)
		VALUES ('01LAGDOC00000000000000000C', '01LAGORG000000000000000000', '01LAGWS0000000000000000000', 'page', 'older', 'workspace',
			'01LAGUSR000000000000000000', 'human', '01LAGUSR000000000000000000', 'human', now() - interval '3 hours')
	`); err != nil {
		t.Fatalf("seed older page: %v", err)
	}
	if v := gatherGauges(t, c)["uniwork_document_worker_oldest_pending_seconds|autoversion"]; v > 4200 {
		t.Fatalf("autoversion lag inside the cache window = %v, want the cached hour", v)
	}
	clock = clock.Add(documentLagCacheTTL)
	if v := gatherGauges(t, c)["uniwork_document_worker_oldest_pending_seconds|autoversion"]; v < 10000 {
		t.Fatalf("autoversion lag after the cache window = %v, want about three hours", v)
	}
}

// A lag read that fails leaves the gauge absent and says so on lag_up, so a
// broken query never reads as an empty queue.
func TestDocumentLagCollectorFailedReadIsAbsentNotZero(t *testing.T) {
	cfg, err := pgxpool.ParseConfig("postgres://nobody:none@127.0.0.1:1/none?sslmode=disable&connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	values := gatherGauges(t, NewDocumentLagCollector(pool))
	for _, w := range []string{"autoversion", "purge"} {
		if _, ok := values["uniwork_document_worker_oldest_pending_seconds|"+w]; ok {
			t.Fatalf("lag gauge for %s present after a failed read: %v", w, values)
		}
		if v, ok := values["uniwork_document_worker_lag_up|"+w]; !ok || v != 0 {
			t.Fatalf("lag_up{%s} = %v (present %v), want 0", w, v, ok)
		}
	}
}

// gatherGauges collects one collector and flattens it into name|labels -> value.
func gatherGauges(t *testing.T, c prometheus.Collector) map[string]float64 {
	t.Helper()
	reg := prometheus.NewRegistry()
	reg.MustRegister(c)
	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	out := map[string]float64{}
	for _, mf := range mfs {
		for _, m := range mf.GetMetric() {
			key := mf.GetName()
			for _, l := range m.GetLabel() {
				key += "|" + l.GetValue()
			}
			out[key] = m.GetGauge().GetValue()
		}
	}
	return out
}
