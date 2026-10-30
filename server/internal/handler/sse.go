package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"
)

// sseHeartbeat is the gap between ": ping" comments, so a proxy does not cut
// a connection that is quiet during a long tool call (R3). A var so tests can
// shorten it.
var sseHeartbeat = 15 * time.Second

// sseWriteIdle is the longest one write to the client may block. The server
// has no WriteTimeout (a stream outlives any fixed one), so each chunk gets
// its own deadline: a client that stops reading cannot pin the handler.
const sseWriteIdle = 60 * time.Second

// sseWriter writes server-sent events. Nothing is written, not even the
// header, until start: a refusal before the first event can still be JSON
// (R5). One mutex orders event frames and pings; close stops and waits for
// the ping goroutine, so nothing writes to w after the handler returns.
type sseWriter struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	mu      sync.Mutex
	started bool
	dead    bool   // a write or flush failed: the client is gone
	onDead  func() // called once, with mu held, when dead is set
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
	_ = s.rc.SetWriteDeadline(time.Now().Add(sseWriteIdle))
	if _, err := s.w.Write([]byte(chunk)); err != nil {
		s.kill()
		return
	}
	s.flush()
}

// flush pushes the buffer out; a failure other than an unflushable writer
// (tests) means the client is gone.
func (s *sseWriter) flush() {
	if err := s.rc.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		s.kill()
	}
}

func (s *sseWriter) kill() {
	if s.dead {
		return
	}
	s.dead = true
	if s.onDead != nil {
		s.onDead()
	}
}

// close stops the heartbeat and waits for it.
func (s *sseWriter) close() {
	close(s.stop)
	s.wg.Wait()
}
