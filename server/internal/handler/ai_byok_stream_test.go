package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// stalledWriter is a client that stopped reading: Write blocks until the write
// deadline the handler set (as a full TCP window does under a real server),
// and forever if none was set.
type stalledWriter struct {
	hdr      http.Header
	deadline atomic.Pointer[time.Time]
	status   int
}

func (w *stalledWriter) Header() http.Header { return w.hdr }
func (w *stalledWriter) WriteHeader(c int)   { w.status = c }
func (w *stalledWriter) Flush()              {}
func (w *stalledWriter) SetWriteDeadline(t time.Time) error {
	w.deadline.Store(&t)
	return nil
}

func (w *stalledWriter) Write([]byte) (int, error) {
	d := w.deadline.Load()
	if d == nil {
		time.Sleep(10 * time.Second) // no deadline: the goroutine is pinned
		return 0, nil
	}
	time.Sleep(time.Until(*d))
	return 0, os.ErrDeadlineExceeded
}

type endlessBody struct{ closed atomic.Bool }

func (b *endlessBody) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}

func (b *endlessBody) Close() error { b.closed.Store(true); return nil }

// M1: a client that stops reading releases the handler once the per-write
// deadline passes, and the vendor body is closed (which aborts the upstream).
func TestServeProxyStreamEndsWhenClientStopsReading(t *testing.T) {
	w := &stalledWriter{hdr: http.Header{}}
	body := &endlessBody{}
	done := make(chan error, 1)
	go func() {
		done <- serveProxyStream(w, &ai.ProxyStream{Status: 200, Stream: true, Body: body}, 50*time.Millisecond)
	}()
	select {
	case err := <-done:
		if err != errProxyClientGone {
			t.Fatalf("err = %v, want errProxyClientGone", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("handler is pinned by a client that stopped reading")
	}
	if !body.closed.Load() {
		t.Fatal("vendor body was not closed: the upstream request keeps running")
	}
}

// m3: the vendor body is never rendered or sniffed on the API origin.
func TestServeProxyStreamSetsHardeningHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	s := &ai.ProxyStream{Status: 200, Header: http.Header{"Content-Type": {"application/octet-stream"}}, Body: io.NopCloser(strings.NewReader("<script>1</script>"))}
	if err := serveProxyStream(rec, s, time.Second); err != nil {
		t.Fatal(err)
	}
	h := rec.Result().Header
	if h.Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(h.Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatalf("headers = %v", h)
	}
	if rec.Body.String() != "<script>1</script>" {
		t.Fatalf("body = %q", rec.Body.String())
	}
}
