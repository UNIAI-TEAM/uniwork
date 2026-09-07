package handler

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/metrics"
)

// /rum is anonymous, capped at 1 KiB, always 204, and lands in the histogram
// in seconds with the route pattern as label.
func TestRUMEndpoint(t *testing.T) {
	wv := metrics.NewWebVitals()
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default(), WebVitals: wv})
	post := func(body string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/rum", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := post(`{"metric":"lcp","value":1830,"route":"/[orgSlug]/[workspaceSlug]/tasks"}`); c != 204 {
		t.Fatalf("lcp: %d", c)
	}
	if c := post(`{"metric":"nope","value":1}`); c != 204 {
		t.Fatalf("unknown metric must still be 204: %d", c)
	}
	if c := post(`{"metric":"lcp","value":1,"route":"` + strings.Repeat("a", 2000) + `"}`); c != 413 {
		t.Fatalf("oversize body: %d, want 413", c)
	}
	if n := testutil.CollectAndCount(wv.Seconds, "uniwork_web_vitals_seconds"); n != 1 {
		t.Fatalf("series = %d, want 1 (only the lcp sample)", n)
	}
	// Without a metrics registry the route still answers 204.
	h = New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rum", strings.NewReader(`{"metric":"cls","value":0.1}`))
	h.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("no metrics: %d", rec.Code)
	}
}
