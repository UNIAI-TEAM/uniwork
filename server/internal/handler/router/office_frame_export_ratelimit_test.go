package router

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// The PDF export holds an engine worker per call, so its budget is the
// user's, across every document: a path that names {documentID} must not
// hand out a fresh budget per document.
func TestOfficeFrameExportBudgetIsPerUserAcrossDocuments(t *testing.T) {
	t.Setenv("FF_DOCUMENTS", "true")
	t.Setenv("FF_OFFICE_DOCS_WEB", "true")
	// A stand-in for the frame token check: "frame-<uid>" verifies as uid.
	frameAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, ok := strings.CutPrefix(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), "frame-")
			if !ok {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(mw.WithUserID(r.Context(), uid)))
		})
	}
	h := New(Deps{
		Cfg:             config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:          auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour},
		Redis:           newRedisTestClient(t),
		FeatureFlags:    featureflag.NewService(featureflag.NewEnvProvider("FF_")),
		OfficeFrameAuth: frameAuth,
	}, stubRoutes())
	export := func(doc string) string { return "/api/v1/office-frame/documents/" + doc + "/export/pdf" }
	const budget = 20

	alice := caller{ip: "10.20.0.9", bearer: "frame-alice"}
	for i := 0; i < budget; i++ {
		if code := alice.send(h, http.MethodPost, export("doc-"+string(rune('a'+i)))); code != http.StatusOK {
			t.Fatalf("export %d = %d, want 200", i+1, code)
		}
	}
	alice.wantRefused(t, h, http.MethodPost, export("doc-new"), "a new document does not reset the user's export budget")

	// Another user behind the same address keeps a whole budget.
	bob := caller{ip: "10.20.0.9", bearer: "frame-bob"}
	bob.spend(t, h, http.MethodPost, export("doc-a"), budget)
	bob.wantRefused(t, h, http.MethodPost, export("doc-a"), "the second user's own budget")
}

// The frame avatar route budgets per token user (120/min) across documents and
// target user ids (UNI-1986), so walking user or document ids cannot mint a
// fresh budget and one office NAT does not pool everyone's reads.
func TestOfficeFrameAvatarBudgetIsPerUserAcrossDocuments(t *testing.T) {
	t.Setenv("FF_DOCUMENTS", "true")
	t.Setenv("FF_OFFICE_DOCS_WEB", "true")
	frameAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, ok := strings.CutPrefix(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), "frame-")
			if !ok {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(mw.WithUserID(r.Context(), uid)))
		})
	}
	h := New(Deps{
		Cfg:             config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:          auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour},
		Redis:           newRedisTestClient(t),
		FeatureFlags:    featureflag.NewService(featureflag.NewEnvProvider("FF_")),
		OfficeFrameAuth: frameAuth,
	}, stubRoutes())
	avatar := func(doc, user string) string {
		return "/api/v1/office-frame/documents/" + doc + "/avatars/" + user
	}
	const budget = 120

	alice := caller{ip: "10.20.0.10", bearer: "frame-alice"}
	for i := range budget {
		if code := alice.send(h, http.MethodGet, avatar("doc-a", "user-"+string(rune('a'+(i%26))))); code != http.StatusOK {
			t.Fatalf("avatar %d = %d, want 200", i+1, code)
		}
	}
	alice.wantRefused(t, h, http.MethodGet, avatar("doc-new", "user-new"), "a new document or user id does not reset the frame avatar budget")

	bob := caller{ip: "10.20.0.10", bearer: "frame-bob"}
	bob.spend(t, h, http.MethodGet, avatar("doc-a", "user-a"), budget)
	bob.wantRefused(t, h, http.MethodGet, avatar("doc-a", "user-a"), "the second user's own avatar budget")
}
