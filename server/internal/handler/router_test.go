package handler

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
)

// The router must never replace r.RemoteAddr with a forwarded header: the
// rate limiter keys its buckets by RemoteAddr and only consults
// X-Forwarded-For when the peer is inside TRUSTED_PROXIES. A middleware that
// rewrote the address first (chi's RealIP) would let any client choose its
// own bucket with one header.
func TestRouterKeepsRemoteAddrDespiteForwardedHeaders(t *testing.T) {
	r := New(Deps{}).(chi.Router)
	var seen string
	r.Get("/echo-addr", func(w http.ResponseWriter, req *http.Request) {
		seen = req.RemoteAddr
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/echo-addr", nil)
	req.RemoteAddr = "203.0.113.7:4242"
	req.Header.Set("X-Forwarded-For", "198.51.100.1")
	req.Header.Set("X-Real-IP", "198.51.100.2")
	req.Header.Set("True-Client-IP", "198.51.100.3")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d", rec.Code)
	}
	if seen != "203.0.113.7:4242" {
		t.Fatalf("RemoteAddr was rewritten to %q", seen)
	}
}

// correlation_id is the trace id (spec F-11 §2.5): the value a user reads
// from X-Trace-Id is the one audit_events and outbox_events carry, so support
// needs exactly one id from the browser to the database.
func TestCorrelationIDIsTheTraceID(t *testing.T) {
	stop, err := telemetry.Init(context.Background(), telemetry.Config{ServiceName: "test"}, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stop(context.Background()) })
	r := New(Deps{}).(chi.Router)
	var inCtx string
	r.Get("/echo-cid", func(w http.ResponseWriter, req *http.Request) {
		inCtx = audit.CorrelationID(req.Context())
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/echo-cid", nil)
	req.Header.Set("X-Correlation-ID", "client-supplied-id")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	trace := rec.Header().Get(telemetry.TraceHeader)
	if len(trace) != 32 {
		t.Fatalf("X-Trace-Id = %q", trace)
	}
	if got := rec.Header().Get("X-Correlation-ID"); got != trace || inCtx != trace {
		t.Fatalf("correlation header %q / context %q, want trace %q", got, inCtx, trace)
	}
}
