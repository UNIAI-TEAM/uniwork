package handler

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// sseHeartbeat is the gap between ": ping" comments, so a proxy does not cut
// a connection that is quiet during a long tool call (R3). A var so tests can
// shorten it.
var sseHeartbeat = 15 * time.Second

// sseWriter writes server-sent events. Nothing is written, not even the
// header, until start: a refusal before the first event can still be JSON
// (R5). One mutex orders event frames and pings; close stops and waits for
// the ping goroutine, so nothing writes to w after the handler returns.
type sseWriter struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	mu      sync.Mutex
	started bool
	dead    bool // a write failed: the client is gone
	stop    chan struct{}
	wg      sync.WaitGroup
}

func newSSEWriter(w http.ResponseWriter) *sseWriter {
	return &sseWriter{w: w, rc: http.NewResponseController(w), stop: make(chan struct{})}
}

// start sends the stream header and begins the heartbeat; later calls do nothing.
func (s *sseWriter) start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}
	s.started = true
	h := s.w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	s.w.WriteHeader(http.StatusOK)
	s.flush()
	s.wg.Add(1)
	go s.ping(sseHeartbeat)
}

func (s *sseWriter) ping(every time.Duration) {
	defer s.wg.Done()
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			s.mu.Lock()
			s.write(": ping\n\n")
			s.mu.Unlock()
		}
	}
}

// event writes one frame, starting the stream first when it has not started.
func (s *sseWriter) event(name string, data any) {
	raw, err := json.Marshal(data)
	if err != nil {
		return
	}
	s.start()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.write("event: " + name + "\ndata: " + string(raw) + "\n\n")
}

// write sends one chunk and flushes; the caller holds mu. Each write gets its
// own deadline so a client that stops reading cannot pin the handler.
func (s *sseWriter) write(chunk string) {
	if s.dead {
		return
	}
	_ = s.rc.SetWriteDeadline(time.Now().Add(byokWriteIdle))
	if _, err := s.w.Write([]byte(chunk)); err != nil {
		s.dead = true
		return
	}
	s.flush()
}

func (s *sseWriter) flush() {
	if err := s.rc.Flush(); err != nil && !s.dead {
		// A writer that cannot flush (not http.ErrNotSupported-safe to ignore
		// in production, where Unwrap reaches the connection) just buffers.
		_ = err
	}
}

// close stops the heartbeat and waits for it.
func (s *sseWriter) close() {
	close(s.stop)
	s.wg.Wait()
}
