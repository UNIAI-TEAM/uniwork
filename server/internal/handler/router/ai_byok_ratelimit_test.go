package router

import (
	"net/http"
	"testing"
)

// The BYOK proxy budgets 60/min per signed-in person across every provider
// and route (ADR 0029): the provider in the path must not mint a fresh budget.
func TestAIBYOKProxyBudgetsEachSignedInUserAcrossProviders(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.11"
	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/openai/chat/completions", 20)
		c.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/anthropic/messages", 20)
		c.spend(t, h, http.MethodGet, "/api/v1/orgs/o1/ai/byok/gemini/models", 20)
		c.wantRefused(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/byok/gemini/generate", "one budget for the whole proxy group")
	}
}
