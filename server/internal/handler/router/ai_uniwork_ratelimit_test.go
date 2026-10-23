package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
)

// The three UniWork AI routes draw on one 60/min budget per person under the
// ai-uniwork bucket (G6-03b §5.1, ADR 0029 D6): the organization and document
// ids the paths carry do not mint a new budget, the frame route and the
// session routes of one person share it, and the failing turn answers
// ai_rate_limited rather than the generic rate_limited of every other bucket.
func TestAIUniworkRoutesUseOwnLimiterBucket(t *testing.T) {
	h, minter := frameAIMux(t)
	const office = "10.20.0.41"
	aliceFrame := caller{ip: office, bearer: "frame-alice"}
	aliceSession := caller{ip: office, bearer: mustMint(t, minter, "alice")}

	aliceFrame.spend(t, h, http.MethodPost, frameAIPath("doc-a", "/uniwork/chat/completions"), 20)
	aliceFrame.spend(t, h, http.MethodPost, frameAIPath("doc-b", "/uniwork/chat/completions"), 20)
	aliceSession.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/uniwork/chat/completions", 20)
	refused := aliceFrame.sendRec(h, http.MethodPost, frameAIPath("doc-c", "/uniwork/chat/completions"))
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("the turn past the budget: status %d, want 429 (one ai-uniwork budget across the three routes and every id)", refused.Code)
	}
	if code := refusalCode(t, refused); code != "ai_rate_limited" {
		t.Fatalf("refusal code = %q, want ai_rate_limited", code)
	}

	// Another person behind the same address keeps a whole budget.
	caller{ip: office, bearer: "frame-bob"}.spend(t, h, http.MethodPost, frameAIPath("doc-a", "/uniwork/chat/completions"), 1)

	// The turn budget is its own: the neighbouring buckets still answer.
	aliceSession.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/openai/chat/completions", 40)
	aliceSession.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/cloud/images", 20)
}

// A 429 of the ai-uniwork bucket carries the wait as well: Retry-After: 60
// (the window), so the client backs off by the header the same way it does
// for every other limiter (G6-03b §5.2).
func TestAIUniworkRateLimitedHasRetryAfter(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.42"
	alice := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	alice.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/uniwork/chat/completions", 60)

	refused := alice.sendRec(h, http.MethodPost, "/api/v1/orgs/o1/ai/uniwork/chat/completions")
	if refused.Code != http.StatusTooManyRequests {
		t.Fatalf("the 61st turn: status %d, want 429", refused.Code)
	}
	if code := refusalCode(t, refused); code != "ai_rate_limited" {
		t.Fatalf("refusal code = %q, want ai_rate_limited", code)
	}
	if retry := refused.Header().Get("Retry-After"); retry != "60" {
		t.Fatalf("Retry-After = %q, want 60", retry)
	}
}

// One run is one question plus eight tool-result rounds: ten requests, eleven
// with one resend (G6-03b §5.4). Eleven is far under 60, so no turn of a full
// run may ever be refused by the limiter, however fast the client drives it.
func TestAIUniworkRunWithinCapNeverHitsLimiter(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.43"
	alice := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	for i := 0; i < 11; i++ {
		rec := alice.sendRec(h, http.MethodPost, "/api/v1/orgs/o1/ai/uniwork/chat/completions")
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("turn %d of one run: 429 (a run's ten model calls plus a resend must never reach the bucket)", i+1)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("turn %d of one run: status %d, want 200", i+1, rec.Code)
		}
	}
}

// frameIdentityMux is the router with the frame identity the global limiter
// uses: `Bearer frame-<uid>--<doc>` names a person and a document, the shape
// handler.frameIdentity builds from a verified token.
func frameIdentityMux(t *testing.T) http.Handler {
	t.Helper()
	return New(Deps{
		Cfg:    config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter: auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour},
		Redis:  newRedisTestClient(t),
		FrameIdentity: func(r *http.Request) string {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer frame-")
			if !ok {
				return ""
			}
			uid, doc, ok := strings.Cut(token, "--")
			if !ok || uid == "" || doc == "" {
				return ""
			}
			return "user:" + uid + ":doc:" + doc
		},
	}, stubRoutes())
}

// The global limiter runs before routing, so a frame request used to fall back
// to its address: one office NAT shared 300/min across every frame in the
// building (G6-03b §5.3). It verifies the frame token itself now and names the
// person and the document, so each person-document pair has its own budget and
// a token it cannot verify buys nothing.
func TestAIUniworkGlobalLimiterKeysFrameTokenByIdentity(t *testing.T) {
	h := frameIdentityMux(t)
	const office = "10.20.0.44"
	const path = "/api/v1/meetings/m1/motions"

	aliceDocA := caller{ip: office, bearer: "frame-alice--doc-a"}
	aliceDocA.spend(t, h, http.MethodGet, path, 300)
	aliceDocA.wantRefused(t, h, http.MethodGet, path, "the frame user's own global budget")

	// Another document of the same person, and another person, are other
	// wallets behind the same address.
	caller{ip: office, bearer: "frame-alice--doc-b"}.spend(t, h, http.MethodGet, path, 300)
	caller{ip: office, bearer: "frame-bob--doc-a"}.spend(t, h, http.MethodGet, path, 300)

	// The address itself is untouched: a frame token never fell back to it.
	anonymous := caller{ip: office}
	anonymous.spend(t, h, http.MethodGet, path, 300)
	anonymous.wantRefused(t, h, http.MethodGet, path, "the address's own budget")

	// A token the identity cannot verify keeps the address's (now spent)
	// budget instead of minting one.
	caller{ip: office, bearer: "frame-nobody"}.wantRefused(t, h, http.MethodGet, path, "an unverifiable frame token")
}

// sendRec is caller.send with the recorder, for the assertions about the
// refusal body and its headers.
func (c caller) sendRec(h http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = c.ip + ":40000"
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// refusalCode reads the code out of the shared error envelope.
func refusalCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode refusal body: %v", err)
	}
	return body.Error.Code
}
