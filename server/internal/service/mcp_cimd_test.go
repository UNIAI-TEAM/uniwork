package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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
