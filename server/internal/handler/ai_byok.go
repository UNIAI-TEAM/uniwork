package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// maxBYOKBody caps a proxied vendor body: chat turns carry inline images
// (contract: 16 MiB on the proxy routes).
const maxBYOKBody = 16 << 20

// byokProxy serves one BYOK proxy route. The body stays opaque JSON; the
// vendor's answer is copied back chunk by chunk with a flush after each, so
// an SSE stream reaches the browser as the vendor emits it.
func (h *aiHandlers) byokProxy(op ai.ProxyOp) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, orgID, ok := h.resolve(w, r)
		if !ok {
			return
		}
		if h.AIBYOK == nil {
			respondError(w, http.StatusServiceUnavailable, "ai_byok_not_configured", "BYOK proxy is not configured")
			return
		}
		var body json.RawMessage
		if op != ai.ProxyModels && !decode(w, r, &body, maxBYOKBody) {
			return
		}
		s, err := h.AIBYOK.Proxy(r.Context(), userID, orgID, chi.URLParam(r, "aiProvider"), op, body, r.Header)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		if err := serveProxyStream(w, s, byokWriteIdle); err != nil && !errors.Is(err, errProxyClientGone) {
			h.Log.Warn("ai: byok stream interrupted", "err", err)
		}
	}
}

// byokWriteIdle is the longest one write to the client may block. The server
// has no WriteTimeout (a stream outlives any fixed one), so each chunk gets
// its own deadline: a client that stops reading cannot pin the goroutine, the
// vendor connection and the buffered request body past this.
const byokWriteIdle = 60 * time.Second

// errProxyClientGone marks a write the client side refused or timed out on.
var errProxyClientGone = errors.New("ai: byok client stopped reading")

// serveProxyStream copies the vendor answer to the client and always closes
// it: closing aborts the vendor request and settles the usage row (as
// incomplete when the body did not reach EOF). The vendor body is never
// sniffed or rendered by the browser: nosniff plus a CSP that allows nothing.
func serveProxyStream(w http.ResponseWriter, s *ai.ProxyStream, writeIdle time.Duration) error {
	defer s.Body.Close()
	for k, vs := range s.Header {
		w.Header()[k] = vs
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if s.Stream {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
	}
	w.WriteHeader(s.Status)
	rc := http.NewResponseController(w)
	buf := make([]byte, 32<<10)
	for {
		n, rerr := s.Body.Read(buf)
		if n > 0 {
			// Refreshed per chunk; a writer without deadline support (tests,
			// HTTP/1 hijack wrappers) just keeps the old behaviour.
			_ = rc.SetWriteDeadline(time.Now().Add(writeIdle))
			if _, werr := w.Write(buf[:n]); werr != nil {
				return errProxyClientGone
			}
			if ferr := rc.Flush(); ferr != nil && !errors.Is(ferr, http.ErrNotSupported) {
				return errProxyClientGone
			}
		}
		if rerr == io.EOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}
