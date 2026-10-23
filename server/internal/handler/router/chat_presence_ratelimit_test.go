package router

import (
	"net/http"
	"testing"
)

// Every shell page beats presence every 15s, so about eight people behind one
// office NAT spent an address-keyed 30/min budget. The presence and typing
// limiter budgets each signed-in person instead.
func TestChatPresenceAndTypingBudgetEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.8"
	for _, path := range []string{
		"/api/v1/workspaces/w1/chat/presence",
		"/api/v1/workspaces/w1/chat/rooms/r1/typing",
	} {
		for _, uid := range []string{"user-a", "user-b"} {
			c := caller{ip: office, bearer: mustMint(t, minter, uid)}
			c.spend(t, h, http.MethodPost, path, 30)
			c.wantRefused(t, h, http.MethodPost, path, "a signed-in user's own budget")
		}
	}
}
