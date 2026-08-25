package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/auth"
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
			next.ServeHTTP(w, r.WithContext(WithUserID(r.Context(), uid)))
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
