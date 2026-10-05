package handler

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

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

// Kubelet probes must never wait on Redis: the global rate limiter sits in
// front of every route, and when its Redis call stalls (pool exhausted,
// server hung) a probe that waits past its 1s timeout gets the pod killed.
// The LiveKit webhook skips the limiter too: all its events share LiveKit's
// one address, and a refused event is dropped. The fake server below accepts
// connections and never answers; a request that skips the limiter never dials
// it, and one that does not is the control that the dial is observable.
func TestProbesAndLiveKitWebhookSkipTheGlobalRateLimiter(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	var held []net.Conn
	var mu sync.Mutex
	accepted := func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(held)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			held = append(held, c)
			mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		mu.Lock()
		defer mu.Unlock()
		for _, c := range held {
			_ = c.Close()
		}
	})
	rdb := redis.NewClient(&redis.Options{Addr: ln.Addr().String(), ReadTimeout: 3 * time.Second, MaxRetries: -1})
	t.Cleanup(func() { _ = rdb.Close() })

	r := New(Deps{Redis: rdb})
	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/healthz", nil),
		httptest.NewRequest(http.MethodGet, "/readyz", nil),
		httptest.NewRequest(http.MethodPost, "/api/v1/integrations/livekit/webhook", nil),
	} {
		start := time.Now()
		r.ServeHTTP(httptest.NewRecorder(), req)
		if took := time.Since(start); took > 500*time.Millisecond {
			t.Fatalf("%s %s waited %v on Redis", req.Method, req.URL.Path, took)
		}
	}
	// Dialling is synchronous in the client, so any limiter call above has
	// been accepted by now; give the accept loop a moment to record it.
	time.Sleep(50 * time.Millisecond)
	if n := accepted(); n != 0 {
		t.Fatalf("probes or the LiveKit webhook reached the rate limiter (%d Redis connections)", n)
	}

	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/meetings/m1/motions", nil))
	deadline := time.Now().Add(2 * time.Second)
	for accepted() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("control: a limited route never dialled Redis, so the check above proves nothing")
		}
		time.Sleep(10 * time.Millisecond)
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
