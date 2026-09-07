package middleware

import (
	"context"
	"net/http"
)

// PlatformRoleSource answers "which platform role does this user hold": ""
// for none, and whether MFA is on for them. The admin service implements
// it; the middleware never queries.
type PlatformRoleSource interface {
	PlatformRole(ctx context.Context, userID string) (role string, mfaEnabled bool, err error)
}

type platformRoleKey struct{}

// RequirePlatformRole guards /api/v1/admin/* (spec F-11 §5.1). A user without
// a platform role gets 404, not 403, so the routes' existence is not
// revealed; a support holder on a route that needs admin gets 403
// platform_role_insufficient. A role holder without MFA gets 403
// mfa_required: the console is closed until they enrol (spec F-01 §2 I6).
// Runs after RequireAuth.
func RequirePlatformRole(src PlatformRoleSource, min string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role := PlatformRoleFromContext(r.Context())
			if role == "" {
				got, mfa, err := src.PlatformRole(r.Context(), UserID(r.Context()))
				if err != nil || got == "" {
					http.NotFound(w, r)
					return
				}
				if !mfa {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`{"error":{"code":"mfa_required","message":"platform roles require two-factor authentication"}}`))
					return
				}
				role = got
				r = r.WithContext(context.WithValue(r.Context(), platformRoleKey{}, role))
			}
			if min == "admin" && role != "admin" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":{"code":"platform_role_insufficient","message":"support role is read-only"}}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// PlatformRoleFromContext is the role RequirePlatformRole resolved, "" outside it.
func PlatformRoleFromContext(ctx context.Context) string {
	v, _ := ctx.Value(platformRoleKey{}).(string)
	return v
}
