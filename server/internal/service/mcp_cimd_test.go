package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMcpCIMDFetcherRefusesLoopbackAndOtherPorts(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer srv.Close()
	f := NewCIMDFetcher()
	if _, err := f.Fetch(context.Background(), srv.URL+"/meta.json"); !errors.Is(err, errCIMDNotAllowed) {
		t.Fatalf("loopback on a random port: %v", err)
	}
	for _, raw := range []string{"http://client.example/meta.json", "https://client.example:8443/meta.json", "https://127.0.0.1/meta.json"} {
		if _, err := f.Fetch(context.Background(), raw); !errors.Is(err, errCIMDNotAllowed) {
			t.Errorf("%s: %v", raw, err)
		}
	}
}

// Only a definitive answer from the host is "rejected"; a transient failure
// keeps the stale-while-error fallback in resolveCIMD.
func TestMcpCIMDStatusClassification(t *testing.T) {
	for _, code := range []int{301, 302, 400, 401, 403, 404, 410, 451} {
		if err := cimdStatusError(code); !errors.Is(err, errCIMDRejected) {
			t.Errorf("status %d: %v, want errCIMDRejected", code, err)
		}
	}
	for _, code := range []int{408, 429, 500, 502, 503, 504, 599} {
		err := cimdStatusError(code)
		if err == nil || errors.Is(err, errCIMDRejected) || errors.Is(err, errCIMDNotAllowed) {
			t.Errorf("status %d: %v, want a transient (non-sentinel) error", code, err)
		}
	}
	if err := cimdStatusError(404); strings.Contains(err.Error(), "http") || !strings.Contains(err.Error(), "404") {
		t.Errorf("error text %q must name the status and no host or URL", err)
	}
}
