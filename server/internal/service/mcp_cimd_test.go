package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMcpCIMDFetcherRefusesLoopbackAndOtherPorts(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	defer srv.Close()
	f := NewCIMDFetcher("https://app.example.test")
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

type cimdRoundTrip func(*http.Request) (*http.Response, error)

func (f cimdRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// cimdFetcherAnswering is the production fetcher with its network replaced by
// answer, so what it sends and how it reads a reply are tested without a dial.
func cimdFetcherAnswering(t *testing.T, answer func(*http.Request) (*http.Response, error)) *cimdFetcher {
	t.Helper()
	f, ok := NewCIMDFetcher("https://app.example.test/").(*cimdFetcher)
	if !ok {
		t.Fatal("NewCIMDFetcher is not a *cimdFetcher")
	}
	f.client.Transport = cimdRoundTrip(answer)
	return f
}

func cimdReply(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
}

// M10: the host of a metadata document sees who fetched it, and how to reach
// the operator, never anything secret.
func TestMcpCIMDFetcherNamesItself(t *testing.T) {
	var ua, accept string
	f := cimdFetcherAnswering(t, func(r *http.Request) (*http.Response, error) {
		ua, accept = r.Header.Get("User-Agent"), r.Header.Get("Accept")
		return cimdReply(`{}`), nil
	})
	if _, err := f.Fetch(context.Background(), "https://client.example/meta.json"); err != nil {
		t.Fatal(err)
	}
	if ua != "UniWork-MCP-CIMD/1 (+https://app.example.test)" || accept != "application/json" {
		t.Fatalf("User-Agent %q, Accept %q", ua, accept)
	}
}

// A document over the limit is the host's definitive answer, not a transient
// failure: a cached row must not keep the client alive behind it.
func TestMcpCIMDDocumentTooLargeIsARejection(t *testing.T) {
	f := cimdFetcherAnswering(t, func(*http.Request) (*http.Response, error) {
		return cimdReply(strings.Repeat("x", cimdMaxBytes+1)), nil
	})
	_, err := f.Fetch(context.Background(), "https://client.example/meta.json")
	if !errors.Is(err, errCIMDRejected) || strings.Contains(err.Error(), "client.example") {
		t.Fatalf("too large: %v; want errCIMDRejected naming no host", err)
	}
	f = cimdFetcherAnswering(t, func(*http.Request) (*http.Response, error) {
		return cimdReply(strings.Repeat("x", cimdMaxBytes)), nil
	})
	if body, err := f.Fetch(context.Background(), "https://client.example/meta.json"); err != nil || len(body) != cimdMaxBytes {
		t.Fatalf("at the limit: %d bytes, %v", len(body), err)
	}
}
