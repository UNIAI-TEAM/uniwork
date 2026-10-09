package middleware

import (
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// hungRedis is a TCP listener that accepts connections and never answers,
// the shape of a Redis whose event loop is stuck. The client keeps go-redis
// defaults (ReadTimeout 5s, MaxRetries 3), as cmd/server builds it, except a
// non-zero poolSize.
func hungRedis(t *testing.T, poolSize int) *redis.Client {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var held []net.Conn
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			held = append(held, c)
			mu.Unlock()
		}
	}()
	rdb := redis.NewClient(&redis.Options{Addr: ln.Addr().String(), PoolSize: poolSize})
	t.Cleanup(func() {
		_ = rdb.Close()
		_ = ln.Close()
		mu.Lock()
		defer mu.Unlock()
		for _, c := range held {
			_ = c.Close()
		}
	})
	return rdb
}

func serveOnce(h http.Handler, addr string) (int, time.Duration) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/meetings/m1/participants", nil)
	req.RemoteAddr = addr
	rec := httptest.NewRecorder()
	start := time.Now()
	h.ServeHTTP(rec, req)
	return rec.Code, time.Since(start)
}

// A stalled Redis must cost a request at most the limiter's own deadline,
// not go-redis' read timeout times its retries: the limiter fails open.
func TestRateLimit_HungRedisFailsOpenWithinTheDeadline(t *testing.T) {
	h := RateLimit(hungRedis(t, 0), 5, time.Minute, nil)(okHandler)
	for i := 0; i < 3; i++ {
		code, took := serveOnce(h, "10.0.5.1:9000")
		if code != http.StatusOK {
			t.Fatalf("request %d: status %d, want 200 (fail open)", i+1, code)
		}
		if took > 500*time.Millisecond {
			t.Fatalf("request %d waited %v on a hung Redis; the limiter deadline is %v", i+1, took, rateLimitRedisTimeout)
		}
	}
}

func TestRateLimit_UnreachableRedisFailsOpenFast(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close() // nothing listens there any more: every dial is refused
	rdb := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = rdb.Close() })

	h := RateLimit(rdb, 5, time.Minute, nil)(okHandler)
	code, took := serveOnce(h, "10.0.5.2:9000")
	if code != http.StatusOK {
		t.Fatalf("status %d, want 200 (fail open)", code)
	}
	if took > 500*time.Millisecond {
		t.Fatalf("request waited %v on an unreachable Redis", took)
	}
}

// The limiter stops waiting after its deadline, but go-redis does not stop
// a call that already holds a connection: it waits out its read timeout. The
// pool here is larger than the cap, so the cap and not the pool is what keeps
// the limiter from holding a connection (and a goroutine) per request; the
// excess requests skip Redis and fail open at once.
func TestRateLimit_HungRedisBoundsAbandonedCalls(t *testing.T) {
	h := RateLimit(hungRedis(t, 8*rateLimitMaxInFlight), 5, time.Minute, nil)(okHandler)
	const requests = 4 * rateLimitMaxInFlight
	before := runtime.NumGoroutine()

	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if code, _ := serveOnce(h, "10.0.5.3:9000"); code != http.StatusOK {
				t.Errorf("status %d, want 200 (fail open)", code)
			}
		}()
	}
	wg.Wait()
	if took := time.Since(start); took > time.Second {
		t.Fatalf("%d concurrent requests took %v on a hung Redis", requests, took)
	}
	// go-redis keeps a few goroutines of its own; the abandoned calls must
	// stay near the cap, far below one per request.
	if grew := runtime.NumGoroutine() - before; grew > rateLimitMaxInFlight+requests/4 {
		t.Fatalf("%d goroutines outlived %d requests; abandoned Redis calls must be capped at %d",
			grew, requests, rateLimitMaxInFlight)
	}
}

// Behind one office NAT every member shares the IP; a verified identity
// gives each of them a budget of their own.
func TestRateLimitByIdentity_EachIdentityHasItsOwnBudget(t *testing.T) {
	rdb := newRedisTestClient(t)
	h := RateLimitByIdentity(rdb, 2, time.Minute, nil, func(r *http.Request) string {
		return r.Header.Get("X-Test-Identity")
	})(okHandler)

	send := func(identity string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/meetings/m1/chat", nil)
		req.RemoteAddr = "10.0.6.1:9000"
		if identity != "" {
			req.Header.Set("X-Test-Identity", identity)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, who := range []string{"user:a", "user:b"} {
		for i := 0; i < 2; i++ {
			if code := send(who); code != http.StatusOK {
				t.Fatalf("%s request %d: status %d, want 200", who, i+1, code)
			}
		}
		if code := send(who); code != http.StatusTooManyRequests {
			t.Fatalf("%s request 3: status %d, want 429", who, code)
		}
	}
	// No identity: the IP's own budget, untouched by the two identities.
	for i := 0; i < 2; i++ {
		if code := send(""); code != http.StatusOK {
			t.Fatalf("anonymous request %d: status %d, want 200", i+1, code)
		}
	}
	if code := send(""); code != http.StatusTooManyRequests {
		t.Fatalf("anonymous request 3: status %d, want 429", code)
	}
}

// An identity key never collides with an IP key, whatever the identity
// function returns.
func TestRateLimitKeyKeepsIdentitiesApartFromAddresses(t *testing.T) {
	if rateLimitKey(60, "/x", identitySubject("10.0.0.1")) == rateLimitKey(60, "/x", "10.0.0.1") {
		t.Fatal("an identity equal to an address shares that address's bucket")
	}
}

// m1: a bucket is one budget per identity for every path in the group, while
// the plain limiter keys by path; the buckets of two groups stay apart.
func TestRateLimitByIdentityBucket_OneBudgetAcrossPaths(t *testing.T) {
	rdb := newRedisTestClient(t)
	who := func(*http.Request) string { return "user:bucket-a" }
	group := RateLimitByIdentityBucket(rdb, "test-group-a", 2, time.Minute, nil, who)(okHandler)
	other := RateLimitByIdentityBucket(rdb, "test-group-b", 2, time.Minute, nil, who)(okHandler)

	send := func(h http.Handler, path string) int {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "10.0.7.1:9000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	for i, path := range []string{"/api/v1/orgs/o1/ai/byok/openai/models", "/api/v1/orgs/o2/ai/byok/gemini/generate"} {
		if code := send(group, path); code != http.StatusOK {
			t.Fatalf("request %d: status %d, want 200", i+1, code)
		}
	}
	// A third path of the same group draws on the same two-request budget.
	if code := send(group, "/api/v1/orgs/o3/ai/byok/anthropic/messages"); code != http.StatusTooManyRequests {
		t.Fatalf("third path in the group: status %d, want 429", code)
	}
	if code := send(other, "/api/v1/orgs/o3/ai/cloud/search"); code != http.StatusOK {
		t.Fatalf("another group: status %d, want 200", code)
	}
}
