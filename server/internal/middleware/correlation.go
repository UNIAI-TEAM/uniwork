package middleware

import (
	"net"
	"net/http"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// CorrelationHeader is the header a client may set to tie a user action to
// everything the server does about it. The response echoes it back so a
// support ticket can carry one id from the browser console to the audit log.
const CorrelationHeader = "X-Correlation-ID"

// userAgentMaxLen bounds what is copied into an append-only column. A user
// agent is attacker-controlled and audit_events cannot be edited afterwards.
const userAgentMaxLen = 512

// Correlation puts the request provenance on the context: correlation id,
// chi's request id, the client address and the user agent. The audit recorder
// reads it at the bottom of the stack, so no service signature has to carry it.
//
// A client-supplied id is only trusted when it matches
// audit.ValidCorrelationID — the value is written to logs and to a column, and
// an arbitrary header there is a log-injection hole.
//
// The client address is resolved here the same way the rate limiter does it,
// from RemoteAddr unless a trusted proxy sits in front (ADR 0004: nothing in
// this codebase rewrites RemoteAddr from a header).
func Correlation(trustedProxies []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get(CorrelationHeader)
			if !audit.ValidCorrelationID(id) {
				id = util.NewID()
			}
			ua := r.UserAgent()
			if len(ua) > userAgentMaxLen {
				ua = ua[:userAgentMaxLen]
			}
			info := audit.RequestInfo{
				CorrelationID: id,
				RequestID:     chimw.GetReqID(r.Context()),
				IP:            extractIP(r, trustedProxies),
				UserAgent:     ua,
			}
			w.Header().Set(CorrelationHeader, id)
			next.ServeHTTP(w, r.WithContext(audit.WithRequest(r.Context(), info)))
		})
	}
}
