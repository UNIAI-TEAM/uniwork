package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	mw "github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// frameAIMux is the router with a stand-in frame auth ("frame-<uid>" verifies
// as uid) and Redis, so the frame AI budgets run.
func frameAIMux(t *testing.T) (http.Handler, auth.TokenMinter) {
	t.Helper()
	t.Setenv("FF_DOCUMENTS", "true")
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
	minter := auth.TokenMinter{Secret: []byte(limiterTestSecret), TTL: time.Hour}
	return New(Deps{
		Cfg:             config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: limiterTestSecret},
		Minter:          minter,
		Redis:           newRedisTestClient(t),
		FeatureFlags:    featureflag.NewService(featureflag.NewEnvProvider("FF_")),
		OfficeFrameAuth: frameAuth,
	}, stubRoutes()), minter
}

func frameAIPath(doc, rest string) string {
	return "/api/v1/office-frame/documents/" + doc + "/ai" + rest
}

// Each frame AI route reaches its own Routes field behind the frame auth.
func TestOfficeFrameAIRoutesBindTheirHandlers(t *testing.T) {
	h, _ := frameAIMux(t)
	cases := map[string]string{
		"GET /cloud":                "OfficeFrameAiCloudStatus",
		"POST /cloud/search":        "OfficeFrameAiCloudSearch",
		"POST /cloud/images":        "OfficeFrameAiCloudImages",
		"POST /cloud/media/analyze": "OfficeFrameAiCloudAnalyzeMedia",
		"POST /cloud/transcribe":    "OfficeFrameAiCloudTranscribe",
	}
	for route, want := range cases {
		method, rest, _ := strings.Cut(route, " ")
		req := httptest.NewRequest(method, frameAIPath("doc-1", rest), nil)
		req.Header.Set("Authorization", "Bearer frame-alice")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("%s = %d %q, want %s", route, rec.Code, rec.Body.String(), want)
		}
		// Without the frame token the handler is never reached.
		req = httptest.NewRequest(method, frameAIPath("doc-1", rest), nil)
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without a frame token = %d, want 401", route, rec.Code)
		}
	}
}

// No frame token service: the frame AI routes answer 404 like the other frame routes.
func TestOfficeFrameAIRoutesAreNotFoundWithoutFrameAuth(t *testing.T) {
	t.Setenv("FF_DOCUMENTS", "true")
	h := New(Deps{
		Cfg:          config.Config{FrontendOrigin: "http://localhost:3000"},
		FeatureFlags: featureflag.NewService(featureflag.NewEnvProvider("FF_")),
	}, stubRoutes())
	req := httptest.NewRequest(http.MethodGet, frameAIPath("doc-1", "/cloud"), nil)
	req.Header.Set("Authorization", "Bearer frame-alice")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
}

// The frame AI budgets are keyed by the person: a new document does not
// reset them, and the session routes draw on the same budget (a frame and a
// host tab of one user share it).
func TestOfficeFrameAIBudgetsArePerPersonAndSharedWithTheSessionRoutes(t *testing.T) {
	h, minter := frameAIMux(t)
	const office = "10.20.0.31"
	alice := caller{ip: office, bearer: "frame-alice"}
	aliceSession := caller{ip: office, bearer: mustMint(t, minter, "alice")}

	// Cloud tools: 20/min; the status GET is outside the tool budget.
	alice.spend(t, h, http.MethodPost, frameAIPath("doc-a", "/cloud/search"), 10)
	aliceSession.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/cloud/images", 10)
	alice.spend(t, h, http.MethodGet, frameAIPath("doc-a", "/cloud"), 5)
	alice.wantRefused(t, h, http.MethodPost, frameAIPath("doc-b", "/cloud/transcribe"), "one cloud tool budget")

	// UniWork AI: 60/min across the turn, the writer and the session turn.
	alice.spend(t, h, http.MethodPost, frameAIPath("doc-a", "/uniwork/chat/completions"), 30)
	alice.spend(t, h, http.MethodPost, frameAIPath("doc-b", "/uniwork/write"), 20)
	aliceSession.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/uniwork/chat/completions", 10)
	alice.wantRefused(t, h, http.MethodPost, frameAIPath("doc-c", "/uniwork/chat/completions"), "one UniWork AI budget across documents and the session routes")

	// Another person behind the same address keeps whole budgets.
	bob := caller{ip: office, bearer: "frame-bob"}
	bob.spend(t, h, http.MethodPost, frameAIPath("doc-a", "/cloud/search"), 20)
	bob.wantRefused(t, h, http.MethodPost, frameAIPath("doc-a", "/cloud/search"), "bob's own budget")
}
