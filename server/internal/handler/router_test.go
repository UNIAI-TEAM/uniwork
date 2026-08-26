package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
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
