package middleware

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// RequireFeatureFlag returns 404 JSON {"error":{"code":"feature_disabled"}} when
// the named catalogue flag evaluates off for the request. When the key is not
// in the catalogue, the default is false so unknown gates stay closed.
func RequireFeatureFlag(flags *featureflag.Service, name string) func(http.Handler) http.Handler {
	def := false
	if f, ok := featureflags.Lookup(name); ok {
		def = f.Default
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !flags.IsEnabled(r.Context(), name, def) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":{"code":"feature_disabled","message":"feature is disabled"}}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
