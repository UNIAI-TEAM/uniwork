package router

import (
	"net/http"
	"testing"
)

// Each Office cloud tool budgets 20/min per signed-in person (contract D6),
// so colleagues behind one office NAT do not share one budget; the status
// read is not on that budget.
func TestAICloudToolsBudgetEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.10"
	path := "/api/v1/orgs/o1/ai/cloud/search"
	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodPost, path, 20)
		c.wantRefused(t, h, http.MethodPost, path, "a signed-in user's own cloud tool budget")
	}
	c := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	c.spend(t, h, http.MethodGet, "/api/v1/orgs/o1/ai/cloud", 21)
}
