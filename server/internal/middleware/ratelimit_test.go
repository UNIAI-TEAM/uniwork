package middleware

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
})

func TestExceptPathsSkipsOnlyTheExactPaths(t *testing.T) {
	var wrapped []string
	block := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			wrapped = append(wrapped, r.URL.Path)
			w.WriteHeader(http.StatusTooManyRequests)
		})
	}
	h := ExceptPaths(block, "/healthz", "/readyz")(okHandler)
	for path, want := range map[string]int{
		"/healthz":           http.StatusOK,
		"/readyz":            http.StatusOK,
		"/healthz/extra":     http.StatusTooManyRequests,
		"/api/v1/auth/login": http.StatusTooManyRequests,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want {
			t.Errorf("%s: status %d, want %d", path, rec.Code, want)
		}
	}
	if len(wrapped) != 2 {
		t.Fatalf("middleware saw %v, want only the two non-probe paths", wrapped)
	}
}

func TestRateLimit_NilRedis(t *testing.T) {
	mw := RateLimit(nil, 5, time.Minute, nil)
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "1.2.3.4:12345"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("nil redis should pass through; got status %d", rec.Code)
	}
}

func TestRateLimit_AllowsUnderLimit(t *testing.T) {
	rdb := newRedisTestClient(t)
	mw := RateLimit(rdb, 3, time.Minute, nil)
	handler := mw(okHandler)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
		req.RemoteAddr = "10.0.0.1:9000"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}
}

func TestRateLimit_BlocksOverLimit(t *testing.T) {
	rdb := newRedisTestClient(t)
	mw := RateLimit(rdb, 2, time.Minute, nil)
	handler := mw(okHandler)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
		req.RemoteAddr = "10.0.0.2:9000"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.0.2:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}

	// The standard error envelope, so the client reads code "rate_limited"
	// instead of falling back to "internal".
	var body struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Error.Code != "rate_limited" || body.Error.Message != "too many requests" {
		t.Fatalf("unexpected error body: %+v", body.Error)
	}
}

func TestRateLimit_SkipsPreflight(t *testing.T) {
	// A CORS preflight is the browser asking whether it may send the real
	// request. Counting it halves every budget for browser clients and
	// counts nothing for curl.
	rdb := newRedisTestClient(t)
	handler := RateLimit(rdb, 1, time.Minute, nil)(okHandler)

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodOptions, "/auth/register", nil)
		req.RemoteAddr = "10.0.0.7:9000"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("preflight %d: expected 200, got %d", i+1, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", nil)
	req.RemoteAddr = "10.0.0.7:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first real request after preflights: expected 200, got %d", rec.Code)
	}
}

func TestRateLimit_StackedLimitersCountSeparately(t *testing.T) {
	// The router stacks a global limiter over a per-route credential
	// limiter. Sharing one counter made every credential request cost two,
	// so the documented 60/min was 30 — and 20 for a browser, with the
	// preflight above.
	rdb := newRedisTestClient(t)
	outer := RateLimit(rdb, 5, time.Minute, nil)
	inner := RateLimit(rdb, 2, time.Minute, nil)
	handler := outer(inner(okHandler))

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "10.0.0.8:9000"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.RemoteAddr = "10.0.0.8:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("request 3: expected 429, got %d", rec.Code)
	}
}

func TestRateLimit_RetryAfterHeader(t *testing.T) {
	rdb := newRedisTestClient(t)
	mw := RateLimit(rdb, 1, 2*time.Minute, nil)
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.0.3:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	req = httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.0.3:9000"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	retryAfter := rec.Header().Get("Retry-After")
	if retryAfter != "120" {
		t.Fatalf("expected Retry-After=120, got %q", retryAfter)
	}
}

func TestRateLimit_DifferentIPs(t *testing.T) {
	rdb := newRedisTestClient(t)
	mw := RateLimit(rdb, 1, time.Minute, nil)
	handler := mw(okHandler)

	ips := []string{"10.0.1.1:9000", "10.0.1.2:9000", "10.0.1.3:9000"}
	for _, addr := range ips {
		req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
		req.RemoteAddr = addr
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("ip %s: expected 200, got %d", addr, rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.1.1:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 for repeated IP, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.1.3:9000"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 for repeated IP 10.0.1.3, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// X-Forwarded-For trust model tests
// ---------------------------------------------------------------------------

func mustParseCIDR(cidr string) *net.IPNet {
	_, n, err := net.ParseCIDR(cidr)
	if err != nil {
		panic(err)
	}
	return n
}

func TestExtractIP_NoTrustedProxies_IgnoresXFF(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "203.0.113.1:9000"
	req.Header.Set("X-Forwarded-For", "198.51.100.1, 203.0.113.1")

	ip := extractIP(req, nil)
	if ip != "203.0.113.1" {
		t.Fatalf("with no trusted proxies, expected RemoteAddr; got %q", ip)
	}
}

func TestExtractIP_TrustedProxy_HonorsXFF(t *testing.T) {
	trusted := []*net.IPNet{mustParseCIDR("10.0.0.0/8")}

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.0.1:9000"
	req.Header.Set("X-Forwarded-For", "198.51.100.42, 10.0.0.5")

	ip := extractIP(req, trusted)
	// Rightmost non-trusted: 198.51.100.42 (10.0.0.5 is trusted)
	if ip != "198.51.100.42" {
		t.Fatalf("expected rightmost non-trusted IP; got %q", ip)
	}
}

func TestExtractIP_UntrustedSource_IgnoresXFF(t *testing.T) {
	trusted := []*net.IPNet{mustParseCIDR("10.0.0.0/8")}

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "203.0.113.99:9000" // Not in trusted CIDR
	req.Header.Set("X-Forwarded-For", "198.51.100.1")

	ip := extractIP(req, trusted)
	if ip != "203.0.113.99" {
		t.Fatalf("untrusted source should use RemoteAddr; got %q", ip)
	}
}

func TestExtractIP_IPv6Normalization(t *testing.T) {
	req1 := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req1.RemoteAddr = "[::1]:9000"

	req2 := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req2.RemoteAddr = "[0:0:0:0:0:0:0:1]:9000"

	ip1 := extractIP(req1, nil)
	ip2 := extractIP(req2, nil)
	if ip1 != ip2 {
		t.Fatalf("IPv6 representations should normalize to same key: %q vs %q", ip1, ip2)
	}
}

func TestRateLimit_LuaScript_SetsTTL(t *testing.T) {
	rdb := newRedisTestClient(t)
	mw := RateLimit(rdb, 10, 30*time.Second, nil)
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodPost, "/auth/send-code", nil)
	req.RemoteAddr = "10.0.99.1:9000"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	key := rateLimitKey(10, "/auth/send-code", "10.0.99.1")
	ttl, err := rdb.TTL(req.Context(), key).Result()
	if err != nil {
		t.Fatalf("TTL: %v", err)
	}
	if ttl <= 0 || ttl > 31*time.Second {
		t.Fatalf("expected TTL ~30s, got %v", ttl)
	}
}

func TestParseTrustedProxies_Empty(t *testing.T) {
	if nets := ParseTrustedProxies(""); nets != nil {
		t.Fatalf("empty string should return nil, got %v", nets)
	}
	if nets := ParseTrustedProxies("  "); nets != nil {
		t.Fatalf("whitespace should return nil, got %v", nets)
	}
}

func TestParseTrustedProxies_Valid(t *testing.T) {
	nets := ParseTrustedProxies("10.0.0.0/8, 172.16.0.0/12")
	if len(nets) != 2 {
		t.Fatalf("expected 2 CIDRs, got %d", len(nets))
	}
}

func TestParseTrustedProxies_InvalidSkipped(t *testing.T) {
	nets := ParseTrustedProxies("10.0.0.0/8, not-a-cidr, 172.16.0.0/12")
	if len(nets) != 2 {
		t.Fatalf("expected 2 valid CIDRs (invalid skipped), got %d", len(nets))
	}
}

func TestRateLimitBucket_SharesOneBudgetAcrossPaths(t *testing.T) {
	// A route whose path carries an id must not hand out one budget per id.
	rdb := newRedisTestClient(t)
	user := func(r *http.Request) string { return r.Header.Get("X-Test-User") }
	handler := RateLimitByIdentityBucket(rdb, "export", 2, time.Minute, nil, user)(okHandler)
	send := func(path, uid string) int {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "10.0.2.1:9000"
		req.Header.Set("X-Test-User", uid)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, path := range []string{"/documents/a/export", "/documents/b/export"} {
		if code := send(path, "u1"); code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d", path, code)
		}
	}
	if code := send("/documents/c/export", "u1"); code != http.StatusTooManyRequests {
		t.Fatalf("third document: expected 429, got %d", code)
	}
	// Another user on the same address has its own budget.
	if code := send("/documents/c/export", "u2"); code != http.StatusOK {
		t.Fatalf("other user: expected 200, got %d", code)
	}
}

// Keyed by the concrete path, every message id was a fresh budget: one person
// toggling reactions across messages was never limited. Per route, every id
// under one pattern shares the caller's budget, and two callers behind one
// address do not share theirs.
func TestRateLimitPerRoute_SharesOneBudgetAcrossIDs(t *testing.T) {
	rdb := newRedisTestClient(t)
	who := func(r *http.Request) string { return r.Header.Get("X-Test-User") }
	r := chi.NewRouter()
	limit := RateLimitPerRoute(rdb, 2, time.Minute, nil, who)
	r.With(limit).Post("/rooms/{roomID}/messages/{messageID}/reactions", okHandler)
	r.With(limit).Post("/rooms/{roomID}/messages/{messageID}/pin", okHandler)

	send := func(user, path string) int {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "10.0.2.1:9000"
		req.Header.Set("X-Test-User", user)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}
	for i, path := range []string{"/rooms/r1/messages/m1/reactions", "/rooms/r2/messages/m2/reactions"} {
		if code := send("alice", path); code != http.StatusOK {
			t.Fatalf("request %d: status %d, want 200", i+1, code)
		}
	}
	if code := send("alice", "/rooms/r3/messages/m3/reactions"); code != http.StatusTooManyRequests {
		t.Fatalf("a third id under the same route: status %d, want 429", code)
	}
	if code := send("alice", "/rooms/r3/messages/m3/pin"); code != http.StatusOK {
		t.Fatalf("another route: status %d, want its own budget", code)
	}
	if code := send("bob", "/rooms/r3/messages/m3/reactions"); code != http.StatusOK {
		t.Fatalf("another caller on the same address: status %d, want their own budget", code)
	}
}

// A bucket may name its own refusal code (G6-03b §5.2): the ai-uniwork bucket
// answers ai_rate_limited so the client tells a limiter 429 of the UniWork
// turn from every other bucket's rate_limited, which stays the default for a
// bucket that names no code.
func TestRateLimitBucketRefusalCode(t *testing.T) {
	rdb := newRedisTestClient(t)
	send := func(h http.Handler, path string) (int, string, string) {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "10.0.3.1:9000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var body struct {
			Error struct{ Code string } `json:"error"`
		}
		_ = json.NewDecoder(rec.Body).Decode(&body)
		return rec.Code, body.Error.Code, rec.Header().Get("Retry-After")
	}

	uniwork := RateLimitByIdentityBucket(rdb, "ai-uniwork", 1, time.Minute, nil, nil, "ai_rate_limited")(okHandler)
	other := RateLimitByIdentityBucket(rdb, "ai-cloud", 1, time.Minute, nil, nil)(okHandler)

	if code, _, _ := send(uniwork, "/documents/d1/ai/uniwork/chat/completions"); code != http.StatusOK {
		t.Fatalf("first turn: status %d, want 200", code)
	}
	code, refusal, retry := send(uniwork, "/documents/d2/ai/uniwork/chat/completions")
	if code != http.StatusTooManyRequests || refusal != "ai_rate_limited" {
		t.Fatalf("second turn = %d %s, want 429 ai_rate_limited", code, refusal)
	}
	if retry != "60" {
		t.Fatalf("Retry-After = %q, want the 60 s window", retry)
	}

	if code, _, _ := send(other, "/orgs/o1/ai/cloud/search"); code != http.StatusOK {
		t.Fatalf("first cloud tool: status %d, want 200", code)
	}
	if code, refusal, _ := send(other, "/orgs/o1/ai/cloud/images"); code != http.StatusTooManyRequests || refusal != "rate_limited" {
		t.Fatalf("a bucket without a code = %d %s, want 429 rate_limited", code, refusal)
	}
}

// The document edit requests (UNI-1645 R8) answer edit_request_rate_limited
// with fields.retry_after_s from this limiter and from their database cap
// alike, so the client reads one shape.
func TestRateLimitBucketRetryAfter_CarriesCodeAndRetryAfterField(t *testing.T) {
	rdb := newRedisTestClient(t)
	user := func(r *http.Request) string { return r.Header.Get("X-Test-User") }
	handler := RateLimitByIdentityBucketRetryAfter(rdb, "edit-request", 1, time.Minute, nil, user, "edit_request_rate_limited")(okHandler)
	send := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "10.0.3.1:9000"
		req.Header.Set("X-Test-User", "u1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	if rec := send("/documents/a/edit-requests"); rec.Code != http.StatusOK {
		t.Fatalf("first request: expected 200, got %d", rec.Code)
	}
	rec := send("/documents/b/edit-requests")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second document: expected 429 (one budget across documents), got %d", rec.Code)
	}
	var body struct {
		Error struct {
			Code   string         `json:"code"`
			Fields map[string]any `json:"fields"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if body.Error.Code != "edit_request_rate_limited" {
		t.Errorf("code = %q, want edit_request_rate_limited", body.Error.Code)
	}
	if got, ok := body.Error.Fields["retry_after_s"].(float64); !ok || got != 60 {
		t.Errorf("fields.retry_after_s = %v, want 60", body.Error.Fields["retry_after_s"])
	}
	if rec.Header().Get("Retry-After") != "60" {
		t.Errorf("Retry-After = %q, want 60", rec.Header().Get("Retry-After"))
	}
}
