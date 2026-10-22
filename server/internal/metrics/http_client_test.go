package metrics

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// serveClient answers status from a route behind auth (the handler marks the
// request authenticated, as middleware.WithUserID does) — or, with public, from
// a route anyone may call.
func serveClient(t *testing.T, registry *Registry, status int, headers map[string]string, public ...bool) {
	t.Helper()
	r := chi.NewRouter()
	r.Use(registry.HTTP.Middleware)
	signedIn := len(public) == 0 || !public[0]
	r.Get("/api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		if signedIn && status != http.StatusUnauthorized {
			MarkAuthenticated(r.Context())
		}
		w.WriteHeader(status)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
}

func scrape(t *testing.T, registry *Registry) string {
	t.Helper()
	rec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	return rec.Body.String()
}

const otaID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

// A server error caused by one store version or one OTA shows up as its own series
// (deploy/alerts.yml › UniChatMobileServerErrors), and the web, which ships with the
// server, adds none.
func TestClientRequestsCountAppBuildsByVersionUpdateAndStatusClass(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	mobile := map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.3.0", "X-Client-Update-Id": otaID}
	serveClient(t, registry, http.StatusOK, mobile)
	serveClient(t, registry, http.StatusBadGateway, mobile)
	serveClient(t, registry, http.StatusBadGateway, mobile)
	serveClient(t, registry, http.StatusNotFound, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.3.0", "X-Client-Update-Id": "embedded"})
	serveClient(t, registry, http.StatusOK, map[string]string{"X-Client-Platform": "web", "X-Client-Version": "1.0.0"})
	serveClient(t, registry, http.StatusOK, nil)

	body := scrape(t, registry)
	for _, want := range []string{
		`uniwork_http_client_requests_total{client_update="` + otaID + `",client_version="0.3.0",platform="mobile",status_class="2xx"} 1`,
		`uniwork_http_client_requests_total{client_update="` + otaID + `",client_version="0.3.0",platform="mobile",status_class="5xx"} 2`,
		`uniwork_http_client_requests_total{client_update="embedded",client_version="0.3.0",platform="mobile",status_class="4xx"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
	if strings.Contains(body, `platform="web"`) || strings.Count(body, "uniwork_http_client_requests_total{") != 3 {
		t.Fatalf("only the app builds are counted:\n%s", body)
	}
}

// The headers are the caller's: malformed values, an unauthenticated caller and more
// distinct values than the budget all land on "other", so the series stay bounded.
func TestClientRequestLabelsStayBounded(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	serveClient(t, registry, http.StatusOK, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.3.0-beta<script>", "X-Client-Update-Id": "not-a-uuid"})
	serveClient(t, registry, http.StatusUnauthorized, map[string]string{"X-Client-Platform": "desktop", "X-Client-Version": "9.9.9", "X-Client-Update-Id": otaID})
	for i := 0; i < maxClientUpdates+5; i++ {
		serveClient(t, registry, http.StatusOK, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": fmt.Sprintf("1.0.%d", i), "X-Client-Update-Id": fmt.Sprintf("%08x-0000-0000-0000-000000000000", i)})
	}
	body := scrape(t, registry)
	if !strings.Contains(body, `uniwork_http_client_requests_total{client_update="other",client_version="other",platform="mobile",status_class="2xx"} 6`) {
		t.Fatalf("malformed and over-budget values should share the other series:\n%s", body)
	}
	if !strings.Contains(body, `client_update="other",client_version="other",platform="desktop",status_class="4xx"} 1`) {
		t.Fatalf("a 401 must not spend the label budget:\n%s", body)
	}
	var series []string
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "uniwork_http_client_requests_total{") {
			series = append(series, line)
		}
	}
	if joined := strings.Join(series, "\n"); strings.Contains(joined, "9.9.9") || strings.Contains(joined, "script") || strings.Contains(joined, "not-a-uuid") {
		t.Fatalf("an unauthenticated or malformed value reached a label:\n%s", body)
	}
	if got := strings.Count(body, `client_version="1.0.`); got != maxClientVersions {
		t.Fatalf("distinct versions = %d, want the budget %d", got, maxClientVersions)
	}
}

// A public route (config, plans, sign-in) answers 200 to anyone: forty anonymous
// requests with made-up builds must not use up the budget the next bad OTA needs.
func TestPublicRoutesDoNotSpendTheClientLabelBudget(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	for i := 0; i < maxClientUpdates+16; i++ {
		serveClient(t, registry, http.StatusOK, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": fmt.Sprintf("7.0.%d", i), "X-Client-Update-Id": fmt.Sprintf("%08x-1111-4000-8000-000000000000", i)}, true)
	}
	serveClient(t, registry, http.StatusBadGateway, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.4.0", "X-Client-Update-Id": otaID})
	body := scrape(t, registry)
	if !strings.Contains(body, `uniwork_http_client_requests_total{client_update="other",client_version="other",platform="mobile",status_class="2xx"} 40`) {
		t.Fatalf("anonymous answers count under other:\n%s", body)
	}
	if !strings.Contains(body, `uniwork_http_client_requests_total{client_update="`+otaID+`",client_version="0.4.0",platform="mobile",status_class="5xx"} 1`) {
		t.Fatalf("the real build still gets its own series:\n%s", body)
	}
}

// A long-lived pod keeps naming new builds: a value nobody sent for a day gives up
// its slot, and its series, to the next one; a value still in use keeps its slot.
func TestClientLabelBudgetRecyclesIdleValues(t *testing.T) {
	var evicted []string
	clock := time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC)
	b := newLabelBudget(2, func(v string) { evicted = append(evicted, v) })
	b.now = func() time.Time { return clock }
	b.admit("1.0.0")
	clock = clock.Add(time.Hour)
	b.admit("1.0.1")
	if got := b.admit("1.0.2"); got != "other" {
		t.Fatalf("a full budget of recent values: %q, want other", got)
	}
	clock = clock.Add(clientLabelIdle - time.Hour)
	b.admit("1.0.1")
	if got := b.admit("1.0.2"); got != "1.0.2" || len(evicted) != 1 || evicted[0] != "1.0.0" {
		t.Fatalf("admit = %q, evicted %v: the idle 1.0.0 gives its slot", got, evicted)
	}
	if got := b.admit("1.0.3"); got != "other" {
		t.Fatalf("1.0.1 and 1.0.2 are recent: %q, want other", got)
	}

	registry := NewRegistry(RegistryOptions{})
	registry.HTTP.versions.now = func() time.Time { return clock }
	registry.HTTP.updates.now = func() time.Time { return clock }
	for i := 0; i < maxClientUpdates; i++ {
		serveClient(t, registry, http.StatusOK, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.3.0", "X-Client-Update-Id": fmt.Sprintf("%08x-2222-4000-8000-000000000000", i)})
	}
	clock = clock.Add(clientLabelIdle)
	serveClient(t, registry, http.StatusInternalServerError, map[string]string{"X-Client-Platform": "mobile", "X-Client-Version": "0.3.0", "X-Client-Update-Id": otaID})
	body := scrape(t, registry)
	if !strings.Contains(body, `client_update="`+otaID+`",client_version="0.3.0",platform="mobile",status_class="5xx"} 1`) {
		t.Fatalf("a new OTA after the old ones went idle gets its own series:\n%s", body)
	}
	if got := strings.Count(body, "uniwork_http_client_requests_total{"); got != maxClientUpdates {
		t.Fatalf("series = %d, want %d: the evicted update's series is dropped", got, maxClientUpdates)
	}
}
