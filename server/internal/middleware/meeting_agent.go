package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/meetings"
)

type meetingAgentKey struct{}

// RequireMeetingAgentToken guards the scribe agent's routes (spec
// 2026-10-20-meeting-scribe-agent-design §7.1, ADR 0037). No uwma_ bearer —
// a session JWT included — is 401. A uwma_ token with a bad signature, past
// its expiry, or naming another meeting than {meetingID} is 404, the answer
// for any id the caller may not see. The verified claims ride the context;
// the service attributes what the agent causes to its system actor.
func RequireMeetingAgentToken(key []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := meetingAgentBearer(r)
			if token == "" {
				writeUnauthorized(w, "missing meeting agent token")
				return
			}
			c, ok := meetings.VerifyAgentToken(key, token, time.Now())
			if !ok || c.MeetingID != chi.URLParam(r, "meetingID") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("not_found", "không tìm thấy"))
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), meetingAgentKey{}, c)))
		})
	}
}

func meetingAgentBearer(r *http.Request) string {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || !strings.HasPrefix(token, meetings.AgentTokenPrefix) {
		return ""
	}
	return token
}

// MeetingAgentClaims returns the claims RequireMeetingAgentToken verified.
func MeetingAgentClaims(ctx context.Context) meetings.AgentClaims {
	c, _ := ctx.Value(meetingAgentKey{}).(meetings.AgentClaims)
	return c
}

// MeetingAgentRateKey keys the meeting-agent budget by token hash. It is read
// before verification, so it bounds a token, not a caller; the routes sit
// outside the global limiter because one agent pod serves many meetings from
// one address.
func MeetingAgentRateKey(r *http.Request) string {
	token := meetingAgentBearer(r)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return "uwma:" + hex.EncodeToString(sum[:8])
}
