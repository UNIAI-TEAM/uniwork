package router

import (
	"net/http"
	"testing"
)

// The BYOK proxy budgets 60/min per signed-in person across every provider,
// route and surface (ADR 0029, ADR 0034): the provider in the path and a web
// vs desktop device token must not mint a fresh budget.
func TestAIBYOKProxyBudgetsEachSignedInUserAcrossProviders(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.11"
	for _, uid := range []string{"user-a", "user-b"} {
		webTok, err := minter.MintWebSession(uid, "web-sess")
		if err != nil {
			t.Fatal(err)
		}
		devTok, err := minter.MintSession(uid, "dev-sess")
		if err != nil {
			t.Fatal(err)
		}
		web := caller{ip: office, bearer: webTok}
		dev := caller{ip: office, bearer: devTok}
		web.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/openai/chat/completions", 20)
		dev.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/anthropic/messages", 20)
		dev.spend(t, h, http.MethodGet, "/api/v1/orgs/o1/ai/byok/gemini/models", 20)
		dev.wantRefused(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/gemini/generate", "one budget for the whole proxy group across web and desktop")
		web.wantRefused(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/openai/chat/completions", "web bearer shares the spent budget")
	}
}
