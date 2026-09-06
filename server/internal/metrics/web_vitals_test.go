package metrics

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestWebVitalsNormalizeRoute(t *testing.T) {
	cases := map[string]string{
		"/[orgSlug]/[workspaceSlug]/tasks":            "/[orgSlug]/[workspaceSlug]/tasks",
		"/acme/team/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAV": "/acme/team/tasks/:id",
		"/acme/01ARZ3NDEKTSV4RRFFQ69G5FAV/x":          "/acme/:id/x",
		"":                                            "unknown",
		"/x?y=1&z=<script>":                           "/xy=1z=script",
		strings.Repeat("/abcdefghij", 20):             strings.Repeat("/abcdefghij", 20)[:100],
	}
	for in, want := range cases {
		if got := NormalizeRoute(in); got != want {
			t.Errorf("NormalizeRoute(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWebVitalsObserveDropsUnknownAndNegative(t *testing.T) {
	w := NewWebVitals()
	reg := prometheus.NewRegistry()
	reg.MustRegister(w.Collectors()...)
	if w.Observe("fcp", "/x", 1) || w.Observe("lcp", "/x", -1) {
		t.Fatal("unknown metric or negative value recorded")
	}
	if !w.Observe("lcp", "/x", 1.2) || !w.Observe("cls", "/x", 0.05) {
		t.Fatal("valid samples dropped")
	}
	if n := testutil.CollectAndCount(w.Seconds, "uniwork_web_vitals_seconds"); n != 2 {
		t.Fatalf("series = %d, want 2", n)
	}
	var nilW *WebVitals
	if nilW.Observe("lcp", "/x", 1) {
		t.Fatal("nil receiver recorded")
	}
}

func TestAIUsageCapsOrganizationLabel(t *testing.T) {
	a := NewAI()
	for i := 0; i < maxOrgLabels+5; i++ {
		a.ObserveAIUsage("fake", "m", "org"+string(rune('A'+i%26))+strings.Repeat("x", i/26), 10, 5, 0.001)
	}
	if got := testutil.ToFloat64(a.CostUSD.WithLabelValues("fake", "m", "other")); got < 0.004 {
		t.Fatalf("overflow organizations should collapse to other, got %v", got)
	}
	if got := testutil.ToFloat64(a.Tokens.WithLabelValues("fake", "m", "orgA", "input")); got != 10 {
		t.Fatalf("first org input tokens = %v", got)
	}
}
