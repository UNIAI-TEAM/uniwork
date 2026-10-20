package router

import (
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// DOC-07 (UNI-1631 §3.1, Q4): an access request notifies the document's
// managers, so each signed-in person gets 20 an hour across EVERY document - a
// fresh document id mints no fresh budget (RateLimitByIdentityBucket, not
// RateLimitByIdentity, which would key the counter by the path and hand each
// document its own 20) - an office NAT does not pool them, and the limiter's
// 429 carries code rate_limited, so the client tells it from
// access_request_cooldown by its code.
func TestDocumentAccessRequestsBudgetEachSignedInUserAcrossDocuments(t *testing.T) {
	t.Setenv("FF_DOCUMENTS", "true")
	minter := auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour}
	h := New(Deps{
		Cfg:          config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:       minter,
		Redis:        newRedisTestClient(t),
		FeatureFlags: featureflag.NewService(featureflag.NewEnvProvider("FF_")),
	}, stubRoutes())
	requests := func(doc string) string { return "/api/v1/documents/" + doc + "/access-requests" }
	const office = "10.20.0.10"
	const budget = 20

	alice := caller{ip: office, bearer: mustMint(t, minter, "alice")}
	for i := range budget {
		if code := alice.send(h, http.MethodPost, requests("doc-"+string(rune('a'+i)))); code != http.StatusOK {
			t.Fatalf("access request %d = %d, want 200", i+1, code)
		}
	}
	alice.wantRefused(t, h, http.MethodPost, requests("doc-new"), "a new document does not reset the person's access-request budget")

	bob := caller{ip: office, bearer: mustMint(t, minter, "bob")}
	bob.spend(t, h, http.MethodPost, requests("doc-a"), budget)
	bob.wantRefused(t, h, http.MethodPost, requests("doc-a"), "the second person's own budget")
}
