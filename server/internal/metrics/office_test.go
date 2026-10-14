package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The G5-07 intent counters are registered by NewRegistry and carry their
// outcome label: the service tests inject a fake OfficeIntentMetrics, so a
// name dropped from Collectors() would otherwise pass every test and leave
// G7-07's alert source missing (BE-I1-5, TI-6c).
func TestOfficeIntentMetricsAreExposed(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	o := registry.Office

	o.IncOfficeIntentLookup("committed")
	o.IncOfficeIntentLookup("not_committed")
	o.IncOfficeIdempotentReplay()
	o.AddOfficeCommitIntentsSwept(3)
	registry.Documents.IncDocumentConflict("file", "document_version_conflict")

	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()

	for _, want := range []string{
		`uniwork_office_intent_lookups_total{outcome="committed"} 1`,
		`uniwork_office_intent_lookups_total{outcome="not_committed"} 1`,
		"uniwork_office_idempotent_replays_total 1",
		"uniwork_office_commit_intents_swept_total 3",
		// The 409 at commit stays the shared conflict counter (G5-07 reuse
		// decision): no uniwork_office_commit_conflicts_total exists.
		`uniwork_document_conflicts_total{code="document_version_conflict",kind="file"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
	if strings.Contains(body, "uniwork_office_commit_conflicts_total") {
		t.Fatalf("a second 409 counter was registered: %s", body)
	}
}

// TestOfficeChangeFeedLagMetricIsExposed is T-3: the incremental feed's lag
// gauge (G5-01b) is proven only through a fake recorder in the service tests, so
// a name dropped from NewOfficeChangeFeed's Collectors or its registration in
// NewRegistry would pass every test and leave the "feed is falling behind" alert
// source missing. Gather the real registry, drive ObserveDocumentChangeFeedLag,
// and read the exposed value back - the way TestOfficeIntentMetricsAreExposed
// does for the intent counters.
func TestOfficeChangeFeedLagMetricIsExposed(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	o := registry.OfficeChanges

	o.ObserveDocumentChangeFeedLag(300)
	o.ObserveDocumentChangeFeedLag(0)

	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()

	if !strings.Contains(body, "uniwork_office_change_feed_lag_seconds 0") {
		t.Fatalf("metrics body missing the feed lag gauge at its last value 0\n%s", body)
	}
	// The gauge reports the LAST observation, not a counter: 300 then 0 leaves 0.
	if strings.Contains(body, "uniwork_office_change_feed_lag_seconds 300") {
		t.Fatalf("the feed lag gauge kept a stale value after the catch-up page\n%s", body)
	}
}
