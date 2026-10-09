package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// maxBYOKBody caps a proxied vendor body: chat turns carry inline images
// (contract: 16 MiB on the proxy routes).
const maxBYOKBody = 16 << 20

// byokProxy serves one BYOK proxy route. The body stays opaque JSON; the
// vendor's answer is copied back chunk by chunk with a flush after each, so
// an SSE stream reaches the browser as the vendor emits it.
func (h *handlers) byokProxy(op ai.ProxyOp) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.AIBYOK == nil {
			respondError(w, http.StatusServiceUnavailable, "ai_byok_not_configured", "BYOK proxy is not configured")
			return
		}
		var body json.RawMessage
		if op != ai.ProxyModels && !decode(w, r, &body, maxBYOKBody) {
			return
		}
		s, err := h.AIBYOK.Proxy(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), chi.URLParam(r, "aiProvider"), op, body)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		defer s.Body.Close()
		for k, vs := range s.Header {
			w.Header()[k] = vs
		}
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
				if _, werr := w.Write(buf[:n]); werr != nil {
					return // client gone; Close settles the usage row as incomplete
				}
				_ = rc.Flush()
			}
			if rerr == io.EOF {
				return
			}
			if rerr != nil {
				h.Log.Warn("ai: byok stream interrupted", "err", rerr)
				return
			}
		}
	}
}
