package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func serve(t *testing.T, header string) (*http.Response, audit.RequestInfo) {
	t.Helper()
	var seen audit.RequestInfo
	h := Correlation(nil)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = audit.RequestFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	req.RemoteAddr = "203.0.113.7:5555"
	req.Header.Set("User-Agent", "test-agent")
	if header != "" {
		req.Header.Set(CorrelationHeader, header)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result(), seen
}

func TestCorrelationAcceptsAWellFormedClientID(t *testing.T) {
	res, seen := serve(t, "client-supplied-01")
	if seen.CorrelationID != "client-supplied-01" {
		t.Fatalf("correlation id = %q", seen.CorrelationID)
	}
	if res.Header.Get(CorrelationHeader) != "client-supplied-01" {
		t.Fatal("the id must be echoed so support can start from the browser")
	}
	if seen.IP != "203.0.113.7" || seen.UserAgent != "test-agent" {
		t.Fatalf("provenance = %+v", seen)
	}
}

// The value lands in a structured log line and in a column that cannot be
// edited afterwards, so anything outside the accepted shape is replaced rather
// than trusted.
func TestCorrelationReplacesAnythingItCannotTrust(t *testing.T) {
	for _, bad := range []string{"", "short", "has space", "quote\"inject"} {
		_, seen := serve(t, bad)
		if seen.CorrelationID == bad {
			t.Fatalf("%q was used as-is", bad)
		}
		if !audit.ValidCorrelationID(seen.CorrelationID) {
			t.Fatalf("generated id %q is not in the accepted shape", seen.CorrelationID)
		}
	}
}

// ADR 0004: nothing rewrites RemoteAddr from a header unless a trusted proxy
// sits in front, and no proxies are configured here.
func TestCorrelationIgnoresForwardedForWithoutTrustedProxies(t *testing.T) {
	var seen audit.RequestInfo
	h := Correlation(nil)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = audit.RequestFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if seen.IP != "10.0.0.1" {
		t.Fatalf("IP = %q; a client must not choose its own address", seen.IP)
	}
}

func TestCorrelationTruncatesAnOversizedUserAgent(t *testing.T) {
	long := make([]byte, userAgentMaxLen*2)
	for i := range long {
		long[i] = 'a'
	}
	var seen audit.RequestInfo
	h := Correlation(nil)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		seen = audit.RequestFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", string(long))
	h.ServeHTTP(httptest.NewRecorder(), req)
	if len(seen.UserAgent) != userAgentMaxLen {
		t.Fatalf("user agent length = %d, want %d", len(seen.UserAgent), userAgentMaxLen)
	}
}
