package router

import (
	"net/http"
	"testing"
)

// The personal AI key routes budget 30/min per signed-in person (ADR 0029),
// so colleagues behind one office NAT do not share one budget.
func TestAICredentialRoutesBudgetEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.9"
	path := "/api/v1/orgs/o1/ai/credentials"
	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodGet, path, 30)
		c.wantRefused(t, h, http.MethodGet, path, "a signed-in user's own AI key budget")
	}
}
