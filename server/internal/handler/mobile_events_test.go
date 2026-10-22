package handler

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/metrics"
)

// /mobile/events (audit "no-product-analytics"): signed in, capped at 4 KiB and 20
// events, always 204, and only known events and results become counters, labelled by
// OS, store version and OTA update from the X-Client-* headers — never by person or organization.
func TestMobileEventsEndpoint(t *testing.T) {
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	token, err := minter.Mint("01J8X4USER0000000000000001")
	if err != nil {
		t.Fatal(err)
	}
	events := metrics.NewMobileEvents()
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: "test"}
	h := New(Deps{Cfg: cfg, Log: slog.Default(), Minter: minter, MobileEvents: events})
	post := func(h http.Handler, body string, bearer bool) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/mobile/events", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Client-Platform", "mobile")
		req.Header.Set("X-Client-Version", "0.3.0")
		req.Header.Set("X-Client-OS", "android")
		req.Header.Set("X-Client-Update-Id", "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
		if bearer {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	batch := `{"events":[
		{"name":"app_open","result":"cold"},
		{"name":"message_send","result":"sent","duration_ms":420},
		{"name":"message_send","result":"failed"},
		{"name":"call_connect","result":"connected","duration_ms":2100},
		{"name":"call_push","result":"lost"},
		{"name":"push_open","result":"leaked-room-id"},
		{"name":"room_opened","result":"ok"}
	]}`
	if c := post(h, batch, false); c != http.StatusUnauthorized {
		t.Fatalf("without a session: %d, want 401", c)
	}
	if c := post(h, batch, true); c != http.StatusNoContent {
		t.Fatalf("batch: %d, want 204", c)
	}
	if got := testutil.ToFloat64(events.Events.WithLabelValues("message_send", "sent", "android", "0.3.0", "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")); got != 1 {
		t.Fatalf("message_send sent = %v, want 1", got)
	}
	if got := testutil.ToFloat64(events.Events.WithLabelValues("call_push", "lost", "android", "0.3.0", "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")); got != 1 {
		t.Fatalf("call_push lost = %v, want 1 (a ring that reached no notification is counted)", got)
	}
	if n := testutil.CollectAndCount(events.Events, "uniwork_mobile_events_total"); n != 5 {
		t.Fatalf("series = %d, want 5 (unknown events and results are dropped)", n)
	}
	if n := testutil.CollectAndCount(events.Durations, "uniwork_mobile_event_duration_seconds"); n != 2 {
		t.Fatalf("duration series = %d, want 2", n)
	}
	if c := post(h, `{"events":[{"name":"app_open","result":"`+strings.Repeat("a", 5000)+`"}]}`, true); c != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize body: %d, want 413", c)
	}
	many := `{"events":[` + strings.TrimSuffix(strings.Repeat(`{"name":"app_open","result":"warm"},`, 25), ",") + `]}`
	if c := post(h, many, true); c != http.StatusNoContent {
		t.Fatalf("25 events: %d", c)
	}
	if got := testutil.ToFloat64(events.Events.WithLabelValues("app_open", "warm", "android", "0.3.0", "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")); got != 20 {
		t.Fatalf("a batch counts at most 20 events, got %v", got)
	}
	// Without a metrics registry the route still answers 204.
	bare := New(Deps{Cfg: cfg, Log: slog.Default(), Minter: minter})
	if c := post(bare, batch, true); c != http.StatusNoContent {
		t.Fatalf("no metrics: %d", c)
	}
}
