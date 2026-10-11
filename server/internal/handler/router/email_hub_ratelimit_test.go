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

// UNI-1197: starting a sign-in sends the browser to a third party, so it
// takes connect's per-person, per-route budget. Google and Microsoft share
// the start route's 10, and spending them leaves the password connect's own
// 10 untouched.
func TestEmailHubOAuthStartBudgetsEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const start = "/api/v1/workspaces/w1/email-hub/oauth/google/start"
	a := caller{ip: "10.20.0.10", bearer: mustMint(t, minter, "oauth-user-a")}
	a.spend(t, h, http.MethodPost, start, 10)
	a.wantRefused(t, h, http.MethodPost, start, "10 starts per 10 minutes")
	a.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/w2/email-hub/oauth/microsoft/start", "the budget is per route, not per workspace or provider")
	a.spend(t, h, http.MethodPost, "/api/v1/workspaces/w1/email-hub/accounts", 10)
}
