package router

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// redisTestDB keeps this package's rate-limit counters apart from every other
// package's: `go test ./...` runs packages in parallel and each helper
// flushes its own database around every test.
const redisTestDB = 12

const limiterTestSecret = "router-ratelimit-test-secret"

func newRedisTestClient(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = redisTestDB
	rdb := redis.NewClient(opts)
	ctx := context.Background()
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flush redis test db: %v", err)
	}
	t.Cleanup(func() {
		_ = rdb.FlushDB(ctx).Err()
		_ = rdb.Close()
	})
	return rdb
}

// limitedMux is the real middleware stack over stub handlers, with Redis, a
// signing secret for bearer tokens and guest sessions, and nothing else.
func limitedMux(t *testing.T) (http.Handler, auth.TokenMinter) {
	t.Helper()
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret}
	minter := auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour}
	return New(Deps{Cfg: cfg, Minter: minter, Redis: newRedisTestClient(t)}, stubRoutes()), minter
}

// caller is one way of presenting a request: an address plus whatever
// credentials it carries.
type caller struct {
	ip      string
	bearer  string
	guestID string // signed with the server secret
	forged  string // raw uw_guest cookie value, never signed
}

func (c caller) send(h http.Handler, method, path string) int {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = c.ip + ":40000"
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	if c.guestID != "" {
		req.AddCookie(&http.Cookie{Name: meetings.GuestCookieName, Value: meetings.SignGuestCookie(c.guestID, []byte(limiterTestSecret))})
	}
	if c.forged != "" {
		req.AddCookie(&http.Cookie{Name: meetings.GuestCookieName, Value: c.forged})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

// spend sends n requests and fails on the first that is refused.
func (c caller) spend(t *testing.T, h http.Handler, method, path string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if code := c.send(h, method, path); code == http.StatusTooManyRequests {
			t.Fatalf("%s %s: request %d of %d refused with 429", method, path, i+1, n)
		}
	}
}

func (c caller) wantRefused(t *testing.T, h http.Handler, method, path, why string) {
	t.Helper()
	if code := c.send(h, method, path); code != http.StatusTooManyRequests {
		t.Fatalf("%s %s: status %d, want 429 (%s)", method, path, code, why)
	}
}

func mustMint(t *testing.T, m auth.TokenMinter, uid string) string {
	t.Helper()
	tok, err := m.Mint(uid)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// Every LiveKit webhook comes from the one LiveKit address. On the global
// per-IP budget, about fifty joins a minute across the platform answered 429
// and LiveKit dropped the events. The route is HMAC-signed; it skips the
// global limiter, and nothing else does.
func TestLiveKitWebhookSkipsTheGlobalRateLimiter(t *testing.T) {
	h, _ := limitedMux(t)
	livekit := caller{ip: "10.20.0.1"}
	livekit.spend(t, h, http.MethodPost, "/api/v1/integrations/livekit/webhook", 400)

	livekit.spend(t, h, http.MethodGet, "/api/v1/meetings/m1/motions", 300)
	livekit.wantRefused(t, h, http.MethodGet, "/api/v1/meetings/m1/motions", "the global limiter still covers every other route")
}

// Thirty to sixty people in a room often share one office NAT. The in-room
// limiters budget per verified person; whoever the server cannot verify
// shares the address's budget, so a made-up cookie or token buys nothing.
func TestInRoomLimitersBudgetEachVerifiedCaller(t *testing.T) {
	h, minter := limitedMux(t)
	const path = "/api/v1/meetings/m1/chat"
	const budget = 120 // joinLimit

	// Each group gets its own address, so the global per-address budget (which
	// guests and anonymous callers share) never decides the outcome here.
	for name, callers := range map[string][]caller{
		"users": {
			{ip: "10.20.0.2", bearer: mustMint(t, minter, "user-a")},
			{ip: "10.20.0.2", bearer: mustMint(t, minter, "user-b")},
		},
		"guests": {
			{ip: "10.20.0.3", guestID: "guest-a"},
			{ip: "10.20.0.3", guestID: "guest-b"},
		},
	} {
		for _, c := range callers {
			c.spend(t, h, http.MethodPost, path, budget)
			c.wantRefused(t, h, http.MethodPost, path, name+": each verified caller still has a budget")
		}
	}

	const office = "10.20.0.4"
	anonymous := caller{ip: office}
	anonymous.spend(t, h, http.MethodPost, path, budget)
	anonymous.wantRefused(t, h, http.MethodPost, path, "the address's own budget")

	forgedGuest := caller{ip: office, forged: "guest-c." + fmt.Sprintf("%064x", 0)}
	forgedGuest.wantRefused(t, h, http.MethodPost, path, "an unsigned guest cookie shares the address's budget")
	otherSecret := auth.TokenMinter{Secret: []byte("not-the-server-secret"), TTL: time.Hour}
	forgedUser := caller{ip: office, bearer: mustMint(t, otherSecret, "user-c")}
	forgedUser.wantRefused(t, h, http.MethodPost, path, "a token the server did not sign shares the address's budget")
}

// The same holds on POST /join and the ballot route, the other in-room
// writes a whole room sends at once.
func TestJoinAndBallotBudgetEachVerifiedCaller(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.5"
	for _, path := range []string{"/api/v1/meetings/m1/join", "/api/v1/meetings/m1/motions/v1/ballot"} {
		for _, uid := range []string{"user-a", "user-b"} {
			c := caller{ip: office, bearer: mustMint(t, minter, uid)}
			c.spend(t, h, http.MethodPost, path, 120)
			c.wantRefused(t, h, http.MethodPost, path, "a verified caller's own budget")
		}
	}
}

// Every client in a room refetches the roster, the chat history and the
// recordings list; at 60 per minute per address an office NAT ran out in
// seconds. Like the motion list they sit on the global budget only.
func TestInRoomReadsAreOffTheCredentialBudget(t *testing.T) {
	h, _ := limitedMux(t)
	anonymous := caller{ip: "10.20.0.6"}
	for _, path := range []string{
		"/api/v1/meetings/m1/participants",
		"/api/v1/meetings/m1/chat",
		"/api/v1/meetings/m1/recordings",
	} {
		anonymous.spend(t, h, http.MethodGet, path, 300)
		anonymous.wantRefused(t, h, http.MethodGet, path, "the global budget still applies")
	}
}

// The global limiter verifies the bearer token itself (it runs before any
// auth middleware), so each signed-in person behind one address gets the
// whole budget. Guest sessions cost an anonymous request to mint, so the
// global limiter keeps them on the address: it is the per-address ceiling.
func TestGlobalLimiterBudgetsEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.7"
	const path = "/api/v1/meetings/m1/motions"

	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodGet, path, 300)
		c.wantRefused(t, h, http.MethodGet, path, "a signed-in user's own global budget")
	}

	anonymous := caller{ip: office}
	anonymous.spend(t, h, http.MethodGet, path, 300)
	anonymous.wantRefused(t, h, http.MethodGet, path, "the address's global budget")

	otherSecret := auth.TokenMinter{Secret: []byte("not-the-server-secret"), TTL: time.Hour}
	caller{ip: office, bearer: mustMint(t, otherSecret, "user-c")}.
		wantRefused(t, h, http.MethodGet, path, "a token the server did not sign shares the address's budget")
	caller{ip: office, guestID: "guest-a"}.
		wantRefused(t, h, http.MethodGet, path, "guests stay on the address in the global limiter")
}

// The same without Redis: none of the in-room reads passes through the
// credential limiter (TestMotionListIsNotOnTheCredentialBudget holds the
// motion list).
func TestInRoomReadsSkipTheCredentialLimiter(t *testing.T) {
	refuse := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) })
	}
	pass := func(next http.Handler) http.Handler { return next }
	mux := chi.NewRouter()
	registerPublicMeetings(newAPI(mux, &apiCatalog{}), stubRoutes(), refuse, pass, pass)

	for path, want := range map[string]string{
		"/meetings/m1/participants": "ListParticipants",
		"/meetings/m1/chat":         "ListChatMessages",
		"/meetings/m1/recordings":   "ListRecordings",
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("GET %s = %d %q, want 200 from %s", path, rec.Code, rec.Body.String(), want)
		}
	}
}

// Chat writes are budgeted per signed-in person and per route, not per
// address and concrete path: an office NAT sending congratulations into one
// room ran out of a shared 120/min, while one person walking message ids
// toggled reactions or invited members without any limit at all.
func TestChatWritesBudgetEachUserPerRoute(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.8"
	ws := "/api/v1/workspaces/w1/chat"
	for _, tc := range []struct {
		method string
		path   func(i int) string
		budget int
	}{
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r%d/messages", ws, i) }, 120},
		{http.MethodPost, func(int) string { return ws + "/messages" }, 120},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r1/messages/m%d/reactions", ws, i) }, 60},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r1/messages/m%d/pin", ws, i) }, 60},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r1/messages/m%d/poll/vote", ws, i) }, 60},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r%d/voice/invite", ws, i) }, 20},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("%s/rooms/r%d/members", ws, i) }, 20},
		{http.MethodPatch, func(i int) string { return fmt.Sprintf("%s/rooms/r%d", ws, i) }, 20},
		{http.MethodPatch, func(i int) string { return fmt.Sprintf("%s/rooms/r1/members/u%d", ws, i) }, 20},
		{http.MethodDelete, func(i int) string { return fmt.Sprintf("%s/rooms/r1/members/u%d", ws, i) }, 20},
		{http.MethodPatch, func(i int) string { return fmt.Sprintf("%s/channels/c%d", ws, i) }, 20},
		{http.MethodPost, func(i int) string { return fmt.Sprintf("/api/v1/workspaces/w%d/chat/room", i) }, 20},
	} {
		a := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
		for i := 0; i < tc.budget; i++ {
			if code := a.send(h, tc.method, tc.path(i)); code == http.StatusTooManyRequests {
				t.Fatalf("%s %s: request %d of %d refused", tc.method, tc.path(i), i+1, tc.budget)
			}
		}
		a.wantRefused(t, h, tc.method, tc.path(tc.budget), "another id under the same route shares the budget")
		b := caller{ip: office, bearer: mustMint(t, minter, "user-b")}
		if code := b.send(h, tc.method, tc.path(tc.budget)); code == http.StatusTooManyRequests {
			t.Fatalf("%s %s: a second person behind the same address was refused", tc.method, tc.path(tc.budget))
		}
	}
}
