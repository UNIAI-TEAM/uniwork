package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// LoadShed bounds the requests the server works on at once. Past max it
// answers 503 with Retry-After at once instead of queueing: a burst queued
// into a 512 MiB pod (everyone opening the app at 9 a.m.) ran it out of memory
// and took every request down with it. Exact skip paths (the probes) pass
// through, so a shedding pod still reports itself alive and ready, and so do
// the two WebSocket routes, whose connections would hold a slot for their
// whole life. A skip entry may also be a route pattern whose {param} segments
// each stand for exactly one non-empty path segment (G6-03a §7.4: the UniWork
// AI routes are exempt by pattern, because a prefix under /api/v1/orgs/{orgID}
// /ai/ would also exempt the BYOK and cloud routes). An exempt request still
// gets its body deadline: the exempt branch used to skip it, which let a
// client trickle the body of an exempt route forever. They are exempt by path,
// not by Upgrade header, which any request can carry. A max of zero or less
// turns it off (a Config built by hand in tests).
func LoadShed(max int, skip ...string) func(http.Handler) http.Handler {
	if max <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	exempt := make([]shedExemption, 0, len(skip))
	for _, p := range skip {
		exempt = append(exempt, newShedExemption(p))
	}
	slots := make(chan struct{}, max)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if shedExempt(exempt, r.URL.Path) {
				setBodyDeadline(w, r)
				next.ServeHTTP(w, r)
				return
			}
			if isWebSocketPath(r.URL.Path) {
				// No body deadline here: the upgrade hijacks the connection and
				// a read deadline set for a request body would outlive it.
				next.ServeHTTP(w, r)
				return
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
				setBodyDeadline(w, r)
				next.ServeHTTP(w, r)
			default:
				w.Header().Set("Retry-After", "2")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("server_busy", "server is busy, retry shortly"))
			}
		})
	}
}

// shedExemption is one skip entry: an exact path (the probes) or a route
// pattern whose {param} segments each stand for one non-empty path segment.
type shedExemption struct {
	path     string
	segments []string
	pattern  bool
}

func newShedExemption(p string) shedExemption {
	return shedExemption{path: p, segments: shedSegments(p), pattern: strings.Contains(p, "{")}
}

// shedSegments splits a path or pattern into its non-empty segments.
func shedSegments(p string) []string {
	trimmed := strings.Trim(p, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func (e shedExemption) matches(path string) bool {
	if !e.pattern {
		return path == e.path
	}
	got := shedSegments(path)
	if len(got) != len(e.segments) {
		return false
	}
	for i, want := range e.segments {
		if strings.HasPrefix(want, "{") && strings.HasSuffix(want, "}") {
			if got[i] == "" {
				return false
			}
			continue
		}
		if want != got[i] {
			return false
		}
	}
	return true
}

// shedExempt reports whether path is one of the skip entries.
func shedExempt(exempt []shedExemption, path string) bool {
	for _, e := range exempt {
		if e.matches(path) {
			return true
		}
	}
	return false
}

// bodyReadTimeout is how long an admitted request may take to send its body.
// The server sets no ReadTimeout (WebSockets outlive any request deadline),
// so without it a client trickling a body holds its slot forever.
var bodyReadTimeout = 60 * time.Second

// setBodyDeadline bounds the read of a request body. net/http clears the
// deadline itself once the body hits EOF, so a handler still working after
// that keeps its context. A request without a body is left alone: its
// background read is already running and the deadline would cancel it.
// ErrNotSupported (a writer that does not reach the conn) leaves it unbounded.
func setBodyDeadline(w http.ResponseWriter, r *http.Request) {
	if r.Body != nil && r.Body != http.NoBody {
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(bodyReadTimeout))
	}
}

// isWebSocketPath matches the realtime socket and the meeting lobby socket
// (router: /api/v1/ws and /api/v1/meetings/{meetingID}/lobby-ws).
func isWebSocketPath(path string) bool {
	return path == "/api/v1/ws" ||
		(strings.HasPrefix(path, "/api/v1/meetings/") && strings.HasSuffix(path, "/lobby-ws"))
}
