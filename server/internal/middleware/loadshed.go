package middleware

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// LoadShed bounds the requests the server works on at once. Past max it
// answers 503 with Retry-After at once instead of queueing: a burst queued
// into a 512 MiB pod (everyone opening the app at 9 a.m.) ran it out of memory
// and took every request down with it. Exact skip paths (the probes) pass
// through, so a shedding pod still reports itself alive and ready, and so do
// the two WebSocket routes, whose connections would hold a slot for their
// whole life. They are exempt by path, not by Upgrade header, which any
// request can carry. A max of zero or less turns it off (a Config built by
// hand in tests).
func LoadShed(max int, skip ...string) func(http.Handler) http.Handler {
	if max <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	exempt := make(map[string]bool, len(skip))
	for _, p := range skip {
		exempt[p] = true
	}
	slots := make(chan struct{}, max)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if exempt[r.URL.Path] || isWebSocketPath(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
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

// isWebSocketPath matches the realtime socket and the meeting lobby socket
// (router: /api/v1/ws and /api/v1/meetings/{meetingID}/lobby-ws).
func isWebSocketPath(path string) bool {
	return path == "/api/v1/ws" ||
		(strings.HasPrefix(path, "/api/v1/meetings/") && strings.HasSuffix(path, "/lobby-ws"))
}
