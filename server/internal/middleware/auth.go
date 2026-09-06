package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
)

type ctxKey int

const userIDKey ctxKey = 1

func RequireAuth(m auth.TokenMinter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || token == "" {
				writeUnauthorized(w, "missing bearer token")
				return
			}
			uid, err := m.Parse(token)
			if err != nil {
				writeUnauthorized(w, "invalid token")
				return
			}
			platform, _, _ := ClientMetadataFromContext(r.Context())
			telemetry.SetActor(r.Context(), uid, string(audit.KindHuman), platform)
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
		})
	}
}

// OptionalAuth attaches user id when a valid bearer token is present; otherwise
// the request continues anonymously (guest flows use uw_guest cookie separately).
func OptionalAuth(m auth.TokenMinter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(h, "Bearer ")
			if ok && token != "" {
				if uid, err := m.Parse(token); err == nil {
					platform, _, _ := ClientMetadataFromContext(r.Context())
					telemetry.SetActor(r.Context(), uid, string(audit.KindHuman), platform)
					r = r.WithContext(WithUserID(r.Context(), uid))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"` + msg + `"}}`))
}

func WithUserID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, userIDKey, uid)
}

func UserID(ctx context.Context) string {
	uid, _ := ctx.Value(userIDKey).(string)
	return uid
}
