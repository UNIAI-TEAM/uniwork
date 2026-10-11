package router

import (
	"net/http"
	"testing"
)

// UNI-1197: a connect dials a third party with a password the caller picked,
// so each signed-in person gets 10 tries per 10 minutes on the route, not per
// workspace, and an office NAT does not pool everyone's budget.
func TestEmailHubConnectBudgetsEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.9"
	const path = "/api/v1/workspaces/w1/email-hub/accounts"
	a := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	a.spend(t, h, http.MethodPost, path, 10)
	a.wantRefused(t, h, http.MethodPost, path, "10 connects per 10 minutes")
	a.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/w2/email-hub/accounts", "the budget is per route, not per workspace")
	a.spend(t, h, http.MethodGet, path, 5) // listing mailboxes is not connecting one

	b := caller{ip: office, bearer: mustMint(t, minter, "user-b")}
	b.spend(t, h, http.MethodPost, path, 10)
}
