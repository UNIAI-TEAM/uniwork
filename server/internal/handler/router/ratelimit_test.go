package router

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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
	device  string // X-UniWork-Device header, never verified
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
	if c.device != "" {
		req.Header.Set("X-UniWork-Device", c.device)
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

// OAuth endpoints for external MCP clients (ADR 0031): authorize, token and
// revoke ride the credential budget, 60 a minute per address and path;
// registration is a public write that creates rows, so it gets 10 an hour.
// The discovery documents stay on the global budget only.
func TestMCPOAuthRoutesAreBudgeted(t *testing.T) {
	h, _ := limitedMux(t)
	for i, route := range []struct{ method, path string }{
		{http.MethodGet, "/oauth/authorize"},
		{http.MethodPost, "/oauth/token"},
		{http.MethodPost, "/oauth/revoke"},
	} {
		c := caller{ip: fmt.Sprintf("10.20.1.%d", i+1)}
		c.spend(t, h, route.method, route.path, 60)
		c.wantRefused(t, h, route.method, route.path, "credential budget: 60 a minute")
	}

	c := caller{ip: "10.20.1.10"}
	c.spend(t, h, http.MethodPost, "/oauth/register", 10)
	c.wantRefused(t, h, http.MethodPost, "/oauth/register", "registration budget: 10 an hour")

	// The budgets are per route: an address that spent registration still
	// reaches the token endpoint, and the reverse.
	c.spend(t, h, http.MethodPost, "/oauth/token", 1)
	d := caller{ip: "10.20.1.11"}
	d.spend(t, h, http.MethodPost, "/oauth/token", 60)
	d.spend(t, h, http.MethodPost, "/oauth/register", 1)

	// Another address has its own budget.
	caller{ip: "10.20.1.12"}.spend(t, h, http.MethodPost, "/oauth/register", 1)

	for _, path := range []string{
		"/.well-known/oauth-protected-resource",
		"/.well-known/oauth-protected-resource/mcp",
		"/.well-known/oauth-authorization-server",
	} {
		anonymous := caller{ip: "10.20.1.13"}
		anonymous.spend(t, h, http.MethodGet, path, 100)
	}
}

// With no Redis the limiters are no-ops, as everywhere else: the routes stay
// reachable and the mux still binds the same handlers.
func TestMCPOAuthRoutesWorkWithoutRedis(t *testing.T) {
	mux := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}}, stubRoutes())
	for _, c := range []struct{ method, path, want string }{
		{http.MethodGet, "/oauth/authorize", "McpAuthorize"},
		{http.MethodPost, "/oauth/token", "McpToken"},
		{http.MethodPost, "/oauth/revoke", "McpRevoke"},
		{http.MethodPost, "/oauth/register", "McpRegister"},
		{http.MethodPost, "/mcp", "McpServe"},
		{http.MethodGet, "/mcp", "McpServe"},
		{http.MethodDelete, "/mcp", "McpServe"},
	} {
		for i := 0; i < 70; i++ {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
			if rec.Code != http.StatusOK || rec.Body.String() != c.want {
				t.Fatalf("%s %s #%d = %d %q, want 200 %s", c.method, c.path, i, rec.Code, rec.Body.String(), c.want)
			}
		}
	}
}

// /mcp budgets each access token, 120 a minute, and is off the global limiter.
// The global limiter names only session JWTs, so an MCP token would fall back
// to its client address, and every team behind one AI vendor's egress address
// would share 300 a minute. Four tokens from one address spend 480 here.
func TestMCPBudgetsEachAccessTokenAndSkipsTheGlobalLimiter(t *testing.T) {
	h, _ := limitedMux(t)
	vendor := "10.30.0.1"
	teams := []string{"uwm_at_team-a", "uwm_at_team-b", "uwm_at_team-c", "uwm_at_team-d"}
	for _, token := range teams {
		caller{ip: vendor, bearer: token}.spend(t, h, http.MethodPost, "/mcp", 120)
	}
	caller{ip: vendor, bearer: teams[0]}.wantRefused(t, h, http.MethodPost, "/mcp", "per-token budget: 120 a minute")
	caller{ip: vendor, bearer: "uwm_at_team-e"}.spend(t, h, http.MethodPost, "/mcp", 1)

	// 480 requests did not touch the address's global budget either.
	rest := caller{ip: vendor}
	rest.spend(t, h, http.MethodGet, "/api/v1/meetings/m1/motions", 300)
	rest.wantRefused(t, h, http.MethodGet, "/api/v1/meetings/m1/motions", "the global limiter still covers every other route")
}

// Whatever cannot be one of our tokens shares its address's budget: nobody
// mints a fresh one by changing the bearer, and a session JWT is not an MCP
// token.
func TestMCPCredentialsThatAreNotAccessTokensShareTheAddressBudget(t *testing.T) {
	h, minter := limitedMux(t)
	ip := "10.30.0.2"
	caller{ip: ip}.spend(t, h, http.MethodPost, "/mcp", 40)
	caller{ip: ip, bearer: "junk-1"}.spend(t, h, http.MethodPost, "/mcp", 40)
	caller{ip: ip, bearer: mustMint(t, minter, "user-a")}.spend(t, h, http.MethodPost, "/mcp", 40)
	caller{ip: ip, bearer: "junk-2"}.wantRefused(t, h, http.MethodPost, "/mcp", "no token of ours: the address's 120 a minute is spent")
	caller{ip: ip, bearer: mustMint(t, minter, "user-b")}.wantRefused(t, h, http.MethodPost, "/mcp", "a session JWT is not an access token")

	// Another address, and a real token from the spent one, are unaffected.
	caller{ip: "10.30.0.3"}.spend(t, h, http.MethodPost, "/mcp", 1)
	caller{ip: ip, bearer: "uwm_at_someone"}.spend(t, h, http.MethodPost, "/mcp", 1)
}

// POST, GET and DELETE are one connection's traffic: one budget.
func TestMCPMethodsShareOneBudget(t *testing.T) {
	h, _ := limitedMux(t)
	c := caller{ip: "10.30.0.4", bearer: "uwm_at_methods"}
	c.spend(t, h, http.MethodPost, "/mcp", 100)
	c.spend(t, h, http.MethodGet, "/mcp", 20)
	c.wantRefused(t, h, http.MethodDelete, "/mcp", "one budget for every method")
}

func TestMCPBearerKey(t *testing.T) {
	req := func(authorization string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/mcp", nil)
		if authorization != "" {
			r.Header.Set("Authorization", authorization)
		}
		return r
	}
	a := mcpBearer(req("Bearer uwm_at_aaa"))
	if a == "" || a != mcpBearer(req("bearer uwm_at_aaa")) || a != mcpBearer(req("BEARER  uwm_at_aaa ")) {
		t.Fatalf("the same token must key the same whatever the scheme's case or the spacing: %q", a)
	}
	if b := mcpBearer(req("Bearer uwm_at_bbb")); b == "" || b == a {
		t.Fatalf("another token must key differently: %q vs %q", b, a)
	}
	if strings.Contains(a, "uwm_at_aaa") {
		t.Fatalf("the key must not carry the token: %q", a)
	}
	for name, header := range map[string]string{
		"none": "", "scheme only": "Bearer", "empty": "Bearer ", "Basic": "Basic uwm_at_aaa", "refresh token": "Bearer uwm_rt_aaa", "jwt": "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x",
	} {
		if got := mcpBearer(req(header)); got != "" {
			t.Errorf("%s: key = %q, want the address fallback", name, got)
		}
	}
}

// Ruling 28: the per-token budget is read before authentication, so a caller
// who rotates well-formed uwm_at_ strings gets a fresh 120 a minute from each.
// A per-address ceiling of 1200 a minute sits in front of it and counts every
// request of the address whatever token it carries. Four teams behind one
// vendor address (480 a minute at their own ceilings) fit under it.
func TestMCPAddressCeilingStopsRotatingTokens(t *testing.T) {
	h, _ := limitedMux(t)
	c := caller{ip: "10.30.1.1"}
	for i := 0; i < 1200; i++ {
		c.bearer = fmt.Sprintf("uwm_at_rotating-%d", i)
		if code := c.send(h, http.MethodPost, "/mcp"); code == http.StatusTooManyRequests {
			t.Fatalf("request %d of 1200 from one address was refused with 429", i+1)
		}
	}
	c.bearer = "uwm_at_rotating-1200"
	c.wantRefused(t, h, http.MethodPost, "/mcp", "the 1201st request of an address in a minute, with a token never seen before")
	// The refusal carries the standard envelope and Retry-After.
	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	req.RemoteAddr = c.ip + ":40000"
	req.Header.Set("Authorization", "Bearer uwm_at_rotating-1201")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "60" {
		t.Fatalf("429 answer: %d Retry-After %q", rec.Code, rec.Header().Get("Retry-After"))
	}

	// A token the address spent is still limited by its own 120, and another
	// address has its own ceiling.
	other := caller{ip: "10.30.1.2", bearer: "uwm_at_one-team"}
	other.spend(t, h, http.MethodPost, "/mcp", 120)
	other.wantRefused(t, h, http.MethodPost, "/mcp", "per-token budget still applies under the ceiling")
	caller{ip: "10.30.1.3", bearer: "uwm_at_fresh"}.spend(t, h, http.MethodPost, "/mcp", 1)
}

// The ceiling counts GET and DELETE too, and does not touch routes that are
// not /mcp.
func TestMCPAddressCeilingCoversEveryMethodAndNothingElse(t *testing.T) {
	h, _ := limitedMux(t)
	c := caller{ip: "10.30.1.4"}
	for i := 0; i < 1200; i++ {
		c.bearer = fmt.Sprintf("uwm_at_m-%d", i)
		method := []string{http.MethodPost, http.MethodGet, http.MethodDelete}[i%3]
		if code := c.send(h, method, "/mcp"); code == http.StatusTooManyRequests {
			t.Fatalf("request %d refused", i+1)
		}
	}
	c.bearer = "uwm_at_m-last"
	c.wantRefused(t, h, http.MethodDelete, "/mcp", "one ceiling for every method")
	// The discovery documents and OAuth endpoints are on their own budgets.
	c.bearer = ""
	c.spend(t, h, http.MethodGet, "/.well-known/oauth-protected-resource", 5)
	c.spend(t, h, http.MethodPost, "/oauth/token", 5)
}

func TestDesktopDeviceKey(t *testing.T) {
	req := func(v string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/desktop/refresh", nil)
		if v != "" {
			r.Header.Set("X-UniWork-Device", v)
		}
		return r
	}
	id := "01J8X4DEVN1P2Q3R4S5T6W7V8X"[:26]
	a := desktopDevice(req(id))
	if a == "" || a != desktopDevice(req(" "+id+" ")) {
		t.Fatalf("a ULID must key, whatever the spacing: %q", a)
	}
	if b := desktopDevice(req("01J8X4DEVN1P2Q3R4S5T6W7V8Y")); b == "" || b == a {
		t.Fatalf("another id must key differently: %q vs %q", b, a)
	}
	for name, v := range map[string]string{"none": "", "short": "abc", "long": id + "0", "slash": id[:25] + "/", "space inside": id[:12] + " " + id[13:]} {
		if got := desktopDevice(req(v)); got != "" {
			t.Errorf("%s: key = %q, want the address fallback", name, got)
		}
	}
}

// Spec N1 §3.4: phones behind one carrier address each refresh on their own
// budget; the address ceiling still stops a caller rotating device ids; a
// client that sends no header (Office today) keeps the old 60 a minute per address.
func TestDesktopRefreshBudgetsEachDeviceUnderAnAddressCeiling(t *testing.T) {
	h, _ := limitedMux(t)
	const path = "/api/v1/auth/desktop/refresh"
	deviceID := func(i int) string { return fmt.Sprintf("01J8X4DEVN1P2Q3R4S5T6%05d", i) } // 26 chars
	carrier := "10.40.0.1"
	for i := 0; i < 100; i++ {
		caller{ip: carrier, device: deviceID(i)}.spend(t, h, http.MethodPost, path, 1)
	}
	one := caller{ip: carrier, device: deviceID(0)}
	one.spend(t, h, http.MethodPost, path, 59)
	one.wantRefused(t, h, http.MethodPost, path, "one device's budget: 60 a minute")
	caller{ip: carrier, device: deviceID(1)}.spend(t, h, http.MethodPost, path, 1)

	rotating := caller{ip: "10.40.0.2"}
	for i := 0; i < 600; i++ {
		rotating.device = deviceID(1000 + i)
		if code := rotating.send(h, http.MethodPost, path); code == http.StatusTooManyRequests {
			t.Fatalf("request %d of 600 refused", i+1)
		}
	}
	rotating.device = deviceID(9999)
	rotating.wantRefused(t, h, http.MethodPost, path, "the address ceiling: 600 a minute whatever the device id")

	// A device id is not a secret: a stranger who knows one spends only the
	// budget of (their address, id), never the real device's.
	stranger := caller{ip: "10.40.0.9", device: deviceID(5)}
	stranger.spend(t, h, http.MethodPost, path, 60)
	stranger.wantRefused(t, h, http.MethodPost, path, "the stranger's own (address, device) budget")
	caller{ip: carrier, device: deviceID(5)}.spend(t, h, http.MethodPost, path, 1)

	legacy := caller{ip: "10.40.0.3"}
	legacy.spend(t, h, http.MethodPost, path, 60)
	legacy.wantRefused(t, h, http.MethodPost, path, "no header: the address's own 60 a minute, as before")
	// start and exchange stay on the credential budget, untouched by the above.
	caller{ip: carrier}.spend(t, h, http.MethodGet, "/api/v1/auth/desktop/start", 60)
	caller{ip: carrier}.wantRefused(t, h, http.MethodGet, "/api/v1/auth/desktop/start", "credential budget still 60 a minute per address")
}
