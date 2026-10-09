package router

import (
	"net/http"
	"testing"
)

// The Office cloud tools share one 20/min budget per signed-in person
// (contract D6), whichever tool or organization path is called, and
// colleagues behind one office NAT do not share it; the status read is not on
// that budget.
func TestAICloudToolsBudgetEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.10"
	for _, uid := range []string{"user-a", "user-b"} {
		c := caller{ip: office, bearer: mustMint(t, minter, uid)}
		c.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/cloud/search", 8)
		c.spend(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/cloud/images", 6)
		c.spend(t, h, http.MethodPost, "/api/v1/orgs/o2/ai/cloud/transcribe", 6)
		c.wantRefused(t, h, http.MethodPost, "/api/v1/orgs/o1/ai/cloud/media/analyze", "one budget for every cloud tool")
	}
	c := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	c.spend(t, h, http.MethodGet, "/api/v1/orgs/o1/ai/cloud", 21)
}
