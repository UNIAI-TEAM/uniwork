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
