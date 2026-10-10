package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
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
	for _, path := range []string{"/api/v1/ws", "/api/v1/meetings/01HZZZZZZZZZZZZZZZZZZZZZZZ/lobby-ws"} {
		ws := httptest.NewRequest(http.MethodGet, path, nil)
		ws.Header.Set("Connection", "Upgrade")
		ws.Header.Set("Upgrade", "websocket")
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, ws)
		if rec.Code != http.StatusOK {
			t.Errorf("WebSocket upgrade on %s while shedding: status %d, want it passed through", path, rec.Code)
		}
	}
	// Upgrade headers on any other route buy no exemption: anyone can send them.
	forged := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	forged.Header.Set("Connection", "Upgrade")
	forged.Header.Set("Upgrade", "websocket")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, forged)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("forged upgrade on a plain route while shedding: status %d, want 503", rec.Code)
	}

	close(release)
	done.Wait()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/x", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("after the burst: status %d, want 200", rec.Code)
	}
}

// An admitted request has bodyReadTimeout to send its body, so a client that
// stalls mid-body gives its slot back. A handler still working once its body
// is in, or one with no body, keeps its context past the deadline.
func TestLoadShedCutsOffAStalledBody(t *testing.T) {
	old := bodyReadTimeout
	bodyReadTimeout = 200 * time.Millisecond
	t.Cleanup(func() { bodyReadTimeout = old })
	readErr := make(chan error, 1)
	srv := httptest.NewServer(LoadShed(1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			readErr <- err
			w.WriteHeader(http.StatusRequestTimeout)
			return
		}
		time.Sleep(3 * bodyReadTimeout)
		if r.Context().Err() != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	})))
	defer srv.Close()

	pr, pw := io.Pipe()
	defer pw.Close()
	go func() { _, _ = pw.Write([]byte("partial")) }() // and then nothing more
	stalled, _ := http.NewRequest(http.MethodPost, srv.URL+"/upload", pr)
	go func() {
		if res, err := srv.Client().Do(stalled); err == nil {
			_ = res.Body.Close()
		}
	}()
	select {
	case <-readErr:
	case <-time.After(5 * time.Second):
		t.Fatal("stalled body was never cut off")
	}

	for _, tc := range []struct {
		method string
		body   io.Reader
	}{{http.MethodPost, strings.NewReader("whole")}, {http.MethodGet, nil}} {
		req, _ := http.NewRequest(tc.method, srv.URL+"/work", tc.body)
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s slower than the deadline: status %d, want 200 with its context intact", tc.method, res.StatusCode)
		}
	}
}
