package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// RequireAuthWithDevice extends bearer validation with a live native-device
// status check. Browser sessions are represented by the same sid namespace;
// a checker returns nil for those rows and only rejects a known revoked device.
func RequireAuthWithDevice(m auth.TokenMinter, check func(context.Context, string, string) error) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || token == "" {
				writeUnauthorized(w, "missing bearer token")
				return
			}
			uid, sid, err := m.ParseSession(token)
			if err != nil {
				writeUnauthorized(w, "invalid token")
				return
			}
			if check != nil {
				if err := check(r.Context(), uid, sid); err != nil {
					if codedErrorCode(err) == "device_revoked" {
						writeDeviceRevoked(w)
						return
					}
					writeUnauthorized(w, "unauthorized")
					return
				}
			}
			platform, _, _ := ClientMetadataFromContext(r.Context())
			telemetry.SetActor(r.Context(), uid, string(audit.KindHuman), platform)
			ctx := context.WithValue(WithUserID(r.Context(), uid), sessionIDKey, sid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

type errorCodeCarrier interface{ CodeValue() string }

func codedErrorCode(err error) string {
	var carrier errorCodeCarrier
	if errors.As(err, &carrier) {
		return carrier.CodeValue()
	}
	return ""
}

func writeDeviceRevoked(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("device_revoked", "desktop device is no longer authorized"))
}

type ctxKey int

const (
	userIDKey    ctxKey = 1
	sessionIDKey ctxKey = 2
)

func RequireAuth(m auth.TokenMinter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(h, "Bearer ")
			if !ok || token == "" {
				writeUnauthorized(w, "missing bearer token")
				return
			}
			uid, sid, err := m.ParseSession(token)
			if err != nil {
				writeUnauthorized(w, "invalid token")
				return
			}
			platform, _, _ := ClientMetadataFromContext(r.Context())
			telemetry.SetActor(r.Context(), uid, string(audit.KindHuman), platform)
			ctx := context.WithValue(WithUserID(r.Context(), uid), sessionIDKey, sid)
			next.ServeHTTP(w, r.WithContext(ctx))
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
	_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("unauthorized", msg))
}

// WithUserID also seeds the flag EvalContext with the user, so a service
// asking for a user-scoped override needs nothing more; organization targeting
// adds OrganizationID itself where it knows the tenant.
func WithUserID(ctx context.Context, uid string) context.Context {
	ctx = context.WithValue(ctx, userIDKey, uid)
	return featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: uid})
}

// SessionID is the `sid` claim of the bearer token: the session the request
// runs in, "" for tokens minted before sessions had ids.
func SessionID(ctx context.Context) string {
	v, _ := ctx.Value(sessionIDKey).(string)
	return v
}

func UserID(ctx context.Context) string {
	uid, _ := ctx.Value(userIDKey).(string)
	return uid
}
