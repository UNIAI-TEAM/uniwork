package handler

// The credential, BYOK proxy and cloud handlers carry no session assumption: a router
// group with its own credential (the web Office frame token) mounts them under
// other paths with a resolver of its own. Mounted here on a path the session
// router never uses, behind fake resolvers.

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func mountAIOnFramePaths(m AIMountable) http.Handler {
	r := chi.NewRouter()
	r.Route("/frame-ai", func(r chi.Router) {
		r.Get("/credentials", m.CredentialsList)
		r.Put("/credentials/{aiProvider}", m.CredentialSave)
		r.Delete("/credentials/{aiProvider}", m.CredentialDelete)
		r.Post("/byok/{aiProvider}/chat/completions", m.ByokChatCompletions)
		r.Post("/byok/{aiProvider}/messages", m.ByokMessages)
		r.Post("/byok/{aiProvider}/generate", m.ByokGenerate)
		r.Get("/byok/{aiProvider}/models", m.ByokModels)
		r.Get("/cloud", m.CloudStatus)
		r.Post("/cloud/search", m.CloudSearch)
		r.Post("/cloud/images", m.CloudImages)
		r.Post("/cloud/media/analyze", m.CloudAnalyzeMedia)
		r.Post("/cloud/transcribe", m.CloudTranscribe)
	})
	return r
}

type aiMountRoute struct{ method, path string }

var aiMountRoutes = []aiMountRoute{
	{"GET", "/frame-ai/credentials"},
	{"PUT", "/frame-ai/credentials/openai"},
	{"DELETE", "/frame-ai/credentials/openai"},
	{"POST", "/frame-ai/byok/openai/chat/completions"},
	{"POST", "/frame-ai/byok/anthropic/messages"},
	{"POST", "/frame-ai/byok/gemini/generate"},
	{"GET", "/frame-ai/byok/openai/models"},
	{"GET", "/frame-ai/cloud"},
	{"POST", "/frame-ai/cloud/search"},
	{"POST", "/frame-ai/cloud/images"},
	{"POST", "/frame-ai/cloud/media/analyze"},
	{"POST", "/frame-ai/cloud/transcribe"},
}

func serveAIMount(h http.Handler, rt aiMountRoute) *httptest.ResponseRecorder {
	req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func newBareHandlers() *handlers {
	return &handlers{Deps: Deps{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}}
}

// A resolver that cannot name the caller ends the request before any service
// or body is touched; the answer does not depend on the route.
func TestMountedAIHandlersRefuseWhenTheResolverFails(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"no credential", errors.New("bad frame token"), http.StatusUnauthorized, "unauthorized"},
		{"org not visible", service.ErrNotFound, http.StatusNotFound, "not_found"},
		{"org forbidden", service.ErrForbidden, http.StatusForbidden, "forbidden"},
	}
	for _, c := range cases {
		h := mountAIOnFramePaths(newBareHandlers().aiMountable(func(*http.Request) (string, string, error) { return "", "", c.err }))
		for _, rt := range aiMountRoutes {
			rec := serveAIMount(h, rt)
			if rec.Code != c.status || !strings.Contains(rec.Body.String(), `"`+c.code+`"`) {
				t.Errorf("%s %s %s: %d %s", c.name, rt.method, rt.path, rec.Code, rec.Body.String())
			}
		}
	}
}

// An empty id is not an actor: a resolver bug must fail closed, not reach a
// service with a blank user or organization.
func TestMountedAIHandlersRefuseABlankActor(t *testing.T) {
	for _, ids := range [][2]string{{"", "org1"}, {"user1", ""}} {
		h := mountAIOnFramePaths(newBareHandlers().aiMountable(func(*http.Request) (string, string, error) { return ids[0], ids[1], nil }))
		for _, rt := range aiMountRoutes {
			if rec := serveAIMount(h, rt); rec.Code != http.StatusUnauthorized {
				t.Errorf("%v %s %s: %d %s", ids, rt.method, rt.path, rec.Code, rec.Body.String())
			}
		}
	}
}

// With an actor named, every mounted route reaches its own handler: the
// services are absent here, so each answers its own "not configured" 503 and
// the resolver was consulted for each — proof the route, resolver and handler
// line up without a session, a cookie or an {orgID} path parameter (the mount
// path has none).
func TestMountedAIHandlersReachTheServicesBehindAFakeResolver(t *testing.T) {
	var calls int
	h := mountAIOnFramePaths(newBareHandlers().aiMountable(func(*http.Request) (string, string, error) {
		calls++
		return "user1", "org1", nil
	}))
	for _, rt := range aiMountRoutes {
		rec := serveAIMount(h, rt)
		want := "cloud_unavailable"
		switch {
		case strings.Contains(rt.path, "/byok/"):
			want = "ai_byok_not_configured"
		case strings.Contains(rt.path, "/credentials"):
			want = "ai_credentials_unavailable"
		}
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("%s %s: %d %s", rt.method, rt.path, rec.Code, rec.Body.String())
		}
	}
	if calls != len(aiMountRoutes) {
		t.Fatalf("resolver consulted %d times for %d routes", calls, len(aiMountRoutes))
	}
}

// The default resolver is the session one: the authenticated user from the
// context plus the {orgID} path parameter, and no user means unauthorized.
func TestSessionAIActorNeedsAUserAndTakesTheOrgFromThePath(t *testing.T) {
	req := httptest.NewRequest("GET", "/orgs/org9/ai/cloud", nil)
	if _, _, err := sessionAIActor(req); err == nil {
		t.Fatal("a request without a user resolved")
	}
	rc := chi.NewRouteContext()
	rc.URLParams.Add("orgID", "org9")
	ctx := context.WithValue(middleware.WithUserID(req.Context(), "user7"), chi.RouteCtxKey, rc)
	user, org, err := sessionAIActor(req.WithContext(ctx))
	if err != nil || user != "user7" || org != "org9" {
		t.Fatalf("resolved %q %q %v", user, org, err)
	}
}
