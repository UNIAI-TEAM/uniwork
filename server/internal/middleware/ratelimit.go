package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// rateLimitScript atomically increments the counter and sets the TTL on
// first access. Using a Lua script ensures INCR and EXPIRE cannot be
// split by a network failure — if INCR succeeds the TTL is guaranteed
// to be set, preventing a stuck key that acts as a permanent ban.
var rateLimitScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`)

// ParseTrustedProxies parses a comma-separated list of CIDRs into a
// slice of *net.IPNet. Invalid entries are warned and skipped.
// Returns nil if raw is empty (default: never trust X-Forwarded-For).
func ParseTrustedProxies(raw string) []*net.IPNet {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var nets []*net.IPNet
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		_, cidr, err := net.ParseCIDR(p)
		if err != nil {
			slog.Warn("ratelimit: invalid trusted proxy CIDR, skipping", "cidr", p, "error", err)
			continue
		}
		nets = append(nets, cidr)
	}
	return nets
}

// rateLimitRedisTimeout bounds one limiter round trip. The limiter sits in
// front of every request, so a Redis that stalls must cost each request this
// much at most, not go-redis' read timeout times its retries; past it the
// request proceeds unlimited (fail-open), as on any other Redis error.
const rateLimitRedisTimeout = 100 * time.Millisecond

// rateLimitMaxInFlight caps the Redis calls one limiter has outstanding. The
// client is built without ContextTimeoutEnabled, so a call the limiter gave
// up on keeps its pool connection until go-redis' own read timeout; under a
// hung Redis the limiter in front of every request would hold one connection
// per request, up to the whole pool. Past the cap the limiter skips Redis and
// fails open at once, so it never holds more connections than this.
const rateLimitMaxInFlight = 64

var errRateLimitSaturated = errors.New("ratelimit: too many redis calls in flight")

// IdentityFunc names the caller a limiter budgets for, or "" when it cannot
// name one. It must return only identities it has verified (a parsed bearer
// token, an HMAC-checked guest session): whatever it returns is a fresh
// budget, so a forgeable value would let any client mint its own.
type IdentityFunc func(*http.Request) string

// RateLimit returns a per-IP fixed-window rate limiter backed by Redis.
// If rdb is nil the middleware is a no-op (fail-open).
//
// trustedProxies controls X-Forwarded-For handling: when the direct
// connection (RemoteAddr) originates from a CIDR in the list, the
// rightmost non-trusted IP in the XFF chain is used as the client IP.
// When the list is empty (default), XFF is never consulted — only
// RemoteAddr is used. This matches the project's conservative trust
// model (see health_realtime.go).
func RateLimit(rdb *redis.Client, limit int, window time.Duration, trustedProxies []*net.IPNet) func(http.Handler) http.Handler {
	return RateLimitByIdentity(rdb, limit, window, trustedProxies, nil)
}

// RateLimitByIdentity is RateLimit keyed by the caller identity returns
// instead of the client IP whenever it returns one, so people sharing one
// address (an office NAT) each get the whole budget. A request it cannot
// name falls back to the IP key. A nil identity is RateLimit.
func RateLimitByIdentity(rdb *redis.Client, limit int, window time.Duration, trustedProxies []*net.IPNet, identity IdentityFunc) func(http.Handler) http.Handler {
	return RateLimitByIdentityBucket(rdb, "", limit, window, trustedProxies, identity)
}

// RateLimitByIdentityBucket is RateLimitByIdentity with one budget shared by
// every route the limiter wraps: the counter is keyed by bucket instead of
// the request path, so a group whose paths carry ids (a document, an
// organization, a provider) is limited per person per group, not per person
// per URL. An empty bucket keys by path, which is RateLimitByIdentity.
func RateLimitByIdentityBucket(rdb *redis.Client, bucket string, limit int, window time.Duration, trustedProxies []*net.IPNet, identity IdentityFunc) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if rdb == nil {
			return next
		}
		inFlight := make(chan struct{}, rateLimitMaxInFlight)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// A CORS preflight is not a request the client made; counting it
			// halves every budget for browsers and none for curl.
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			ip := extractIP(r, trustedProxies)
			subject := ip
			if identity != nil {
				if id := identity(r); id != "" {
					subject = identitySubject(id)
				}
			}
			scope := r.URL.Path
			if bucket != "" {
				// "~" never starts a request path, so a bucket cannot share a
				// path's counter.
				scope = "~" + bucket
			}
			key := rateLimitKey(limit, scope, subject)

			count, err := countRequest(r.Context(), rdb, inFlight, key, window)
			if err != nil {
				slog.Warn("ratelimit: redis error; allowing request", "error", err, "ip", ip)
				next.ServeHTTP(w, r)
				return
			}
			if count > int64(limit) {
				w.Header().Set("Retry-After", fmt.Sprintf("%d", int(window.Seconds())))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				// Same envelope as handler.respondError; the client maps the code.
				_ = json.NewEncoder(w).Encode(sdo.NewErrorSDO("rate_limited", "too many requests"))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// countRequest runs the counter script and waits for it at most
// rateLimitRedisTimeout. The call runs on its own goroutine because the
// deadline alone does not reach go-redis' socket reads unless the client was
// built with ContextTimeoutEnabled; the cancel still ends it early when it was.
func countRequest(parent context.Context, rdb *redis.Client, inFlight chan struct{}, key string, window time.Duration) (int64, error) {
	select {
	case inFlight <- struct{}{}:
	default:
		return 0, errRateLimitSaturated
	}
	ctx, cancel := context.WithTimeout(parent, rateLimitRedisTimeout)
	defer cancel()
	type result struct {
		count int64
		err   error
	}
	done := make(chan result, 1)
	go func() {
		defer func() { <-inFlight }()
		n, err := rateLimitScript.Run(ctx, rdb, []string{key}, int(window.Seconds())).Int64()
		done <- result{n, err}
	}()
	select {
	case res := <-done:
		return res.count, res.err
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

// ExceptPaths applies m to every request except those whose path is exactly
// one of paths, which go straight to the next handler.
func ExceptPaths(m func(http.Handler) http.Handler, paths ...string) func(http.Handler) http.Handler {
	skip := make(map[string]bool, len(paths))
	for _, p := range paths {
		skip[p] = true
	}
	return func(next http.Handler) http.Handler {
		wrapped := m(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if skip[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			wrapped.ServeHTTP(w, r)
		})
	}
}

// extractIP determines the client IP for rate limiting purposes.
// It only honors X-Forwarded-For when RemoteAddr is from a trusted proxy.
// ClientIP is the address a session records and the rate limiter keys on;
// X-Forwarded-For counts only behind a trusted proxy.
func ClientIP(r *http.Request, trustedProxies []*net.IPNet) string {
	return extractIP(r, trustedProxies)
}

func extractIP(r *http.Request, trustedProxies []*net.IPNet) string {
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}

	if len(trustedProxies) > 0 {
		remoteIP := net.ParseIP(remoteHost)
		if remoteIP != nil && isTrustedProxy(remoteIP, trustedProxies) {
			if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
				// Walk right-to-left: the rightmost non-trusted entry is
				// the last hop before the trusted proxy chain.
				parts := strings.Split(xff, ",")
				for i := len(parts) - 1; i >= 0; i-- {
					candidate := net.ParseIP(strings.TrimSpace(parts[i]))
					if candidate != nil && !isTrustedProxy(candidate, trustedProxies) {
						return candidate.String()
					}
				}
			}
		}
	}

	// Default: use RemoteAddr in canonical form.
	if ip := net.ParseIP(remoteHost); ip != nil {
		return ip.String()
	}
	return remoteHost
}

func isTrustedProxy(ip net.IP, cidrs []*net.IPNet) bool {
	for _, cidr := range cidrs {
		if cidr.Contains(ip) {
			return true
		}
	}
	return false
}

// The limit is part of the key: the router stacks a global limiter over a
// per-route one on the same path, and two limiters on one counter charge
// every request twice.
func rateLimitKey(limit int, path, subject string) string {
	sanitized := strings.TrimPrefix(path, "/")
	sanitized = strings.ReplaceAll(sanitized, "/", ":")
	return fmt.Sprintf("uw:ratelimit:%d:%s:%s", limit, sanitized, subject)
}

// identitySubject marks an identity so it can never land in an address's
// bucket: no IPv4 or IPv6 literal starts with "id:".
func identitySubject(id string) string {
	return "id:" + id
}
