package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// Past the in-flight bound the server answers 503 with Retry-After instead
// of queueing the burst into memory; probes and WebSocket upgrades pass.
func TestLoadShedRefusesPastTheBound(t *testing.T) {
	release := make(chan struct{})
	var started sync.WaitGroup
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/slow" {
			started.Done()
			<-release
		}
		w.WriteHeader(http.StatusOK)
	})
	h := LoadShed(2, "/healthz", "/readyz")(slow)

	var done sync.WaitGroup
	for i := 0; i < 2; i++ {
		started.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/slow", nil))
		}()
	}
	started.Wait()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/x", nil))
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("over the bound: status %d, Retry-After %q; want 503 with Retry-After", rec.Code, rec.Header().Get("Retry-After"))
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s while shedding: status %d, want 200", path, rec.Code)
		}
	}
	ws := httptest.NewRequest(http.MethodGet, "/api/v1/ws", nil)
	ws.Header.Set("Connection", "Upgrade")
	ws.Header.Set("Upgrade", "websocket")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, ws)
	if rec.Code != http.StatusOK {
		t.Errorf("WebSocket upgrade while shedding: status %d, want it passed through", rec.Code)
	}

	close(release)
	done.Wait()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/x", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("after the burst: status %d, want 200", rec.Code)
	}
}
