package router

import (
	"net/http"
	"testing"
)

// The personal AI key routes budget 30/min per signed-in person across the
// whole group (ADR 0029), not per URL: the organization and provider in the
// path must not mint a fresh budget, and colleagues behind one office NAT do
// not share one.
func TestAICredentialRoutesBudgetEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.9"
	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodGet, "/api/v1/orgs/o1/ai/credentials", 10)
		c.spend(t, h, http.MethodPut, "/api/v1/orgs/o1/ai/credentials/openai", 10)
		c.spend(t, h, http.MethodDelete, "/api/v1/orgs/o2/ai/credentials/gemini", 10)
		c.wantRefused(t, h, http.MethodPut, "/api/v1/orgs/o3/ai/credentials/anthropic", "one budget for the whole credential group")
	}
}
