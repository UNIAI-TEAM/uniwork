package router

import (
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// UNI-1645 R8: an edit request pings the holder, so each signed-in person
// gets 20 a minute across every document (a fresh document id is no fresh
// budget), an office NAT does not pool them, and the other lock routes are
// not on that budget.
func TestDocumentEditRequestsBudgetEachSignedInUserAcrossDocuments(t *testing.T) {
	t.Setenv("FF_DOCUMENTS", "true")
	minter := auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour}
	h := New(Deps{
		Cfg:          config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:       minter,
		Redis:        newRedisTestClient(t),
		FeatureFlags: featureflag.NewService(featureflag.NewEnvProvider("FF_")),
	}, stubRoutes())
	requests := func(doc string) string { return "/api/v1/documents/" + doc + "/edit-requests" }
	const office = "10.20.0.9"
	const budget = 20

	alice := caller{ip: office, bearer: mustMint(t, minter, "alice")}
	for i := 0; i < budget; i++ {
		if code := alice.send(h, http.MethodPost, requests("doc-"+string(rune('a'+i)))); code != http.StatusOK {
			t.Fatalf("edit request %d = %d, want 200", i+1, code)
		}
	}
	alice.wantRefused(t, h, http.MethodPost, requests("doc-new"), "a new document does not reset the person's edit request budget")
	alice.spend(t, h, http.MethodPost, "/api/v1/documents/doc-a/edit-lock", 5)
	alice.spend(t, h, http.MethodGet, "/api/v1/documents/doc-a/edit-lock", 5)

	bob := caller{ip: office, bearer: mustMint(t, minter, "bob")}
	bob.spend(t, h, http.MethodPost, requests("doc-a"), budget)
	bob.wantRefused(t, h, http.MethodPost, requests("doc-a"), "the second person's own budget")
}
