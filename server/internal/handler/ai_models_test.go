package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// agentFlagOn reads every flag as its default except ask_uni_agent.
type agentFlagOn struct{}

func (agentFlagOn) IsEnabled(_ context.Context, key string, def bool) bool {
	return key == "ask_uni_agent" || def
}

// askWorld is a server whose Ask UNI runs on its own fake provider, the agent
// switched on, with one owner, a workspace and a plain organization member.
func askWorld(t *testing.T, fake *provider.Fake) (srv *httptest.Server, owner, member, wsID string) {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	gw := service.NewAIGateway(pool, q, fake, ai.Options{})
	d.AskUNI = service.NewAskUNIService(pool, q, d.Workspaces, d.Organizations, d.Tasks, d.Meetings, d.Chat, gw, nil)
	d.AskUNI.SetFlags(agentFlagOn{})
	d.AskUNI.SetReadTools(service.NewMcpToolService(q, d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin))
	srv = httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	owner, wsID = registerOrgWorkspace(t, srv, "askmodels-owner@example.com", "Owner", "askmodels")
	var memberID string
	member, memberID = signUp(t, srv, "askmodels-member@example.com", "Member")
	if _, err := pool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) SELECT organization_id, $1, 'member' FROM organization_members WHERE role = 'owner' AND organization_id = (SELECT id FROM organizations WHERE slug = 'askmodels')`, memberID); err != nil {
		t.Fatal(err)
	}
	return srv, owner, member, wsID
}

// The body's model and effort reach the run: effort lands on the provider
// request, a model the organization cannot use is Auto, and neither a lone
// unknown model nor an unknown effort is rejected.
func TestAskUniPassesModelAndEffort(t *testing.T) {
	fake := &provider.Fake{Reply: ai.FakeReply}
	srv, owner, _, wsID := askWorld(t, fake)
	path := "/api/v1/workspaces/" + wsID + "/ai/ask"
	for effort, want := range map[string]string{"low": "low", "high": "high", "xhigh": "medium", "": "medium"} {
		res, out := doJSON(t, srv, "POST", path, owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi", "model": "no-such-model", "effort": effort})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("effort %q: %d %v", effort, res.StatusCode, out)
		}
		if fake.Last.Effort != want || fake.Last.Model != "fake" {
			t.Errorf("effort %q reached the provider as %q on model %q, want %q on the default", effort, fake.Last.Effort, fake.Last.Model, want)
		}
	}
}

func TestAskUniAnswersRetryAfterOnALimit(t *testing.T) {
	fake := &provider.Fake{Err: &provider.StatusError{Status: 429, RetryAfter: 17 * time.Second}}
	srv, owner, _, wsID := askWorld(t, fake)
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/ai/ask", owner, map[string]any{"question": "task nào quá hạn?", "locale": "vi"})
	wantError(t, "ask under a vendor limit", res, out, http.StatusTooManyRequests, "ai_rate_limited")
	if got := res.Header.Get("Retry-After"); got != "17" {
		t.Errorf("Retry-After = %q, want 17", got)
	}
}

func TestOrgAskModelsRoute(t *testing.T) {
	srv, owner, member, _ := askWorld(t, &provider.Fake{Reply: ai.FakeReply})
	path := "/api/v1/orgs/askmodels/ai/ask-models"

	res, out := doJSON(t, srv, "GET", path, owner, nil)
	if res.StatusCode != http.StatusOK || len(out["models"].([]any)) != 2 {
		t.Fatalf("default read: %d %v, want haiku and sonnet", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{"models": []string{"opus", "sonnet"}})
	if res.StatusCode != http.StatusOK || len(out["models"].([]any)) != 2 || out["models"].([]any)[0] != "opus" {
		t.Fatalf("owner put: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", path, member, nil)
	if res.StatusCode != http.StatusOK || out["models"].([]any)[0] != "opus" {
		t.Fatalf("member read: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", path, member, map[string]any{"models": []string{"haiku"}})
	wantError(t, "member put", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, srv, "PUT", path, owner, map[string]any{"models": []string{"gpt"}})
	wantError(t, "unknown key", res, out, http.StatusBadRequest, "invalid_request")
}
