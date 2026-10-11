package handler

import (
	"net/http"
	"testing"
)

// The owner reads which sign-in buttons to show. Tests register no OAuth
// client, so both keys are present and false.
func TestEmailHubProvidersForTheOwner(t *testing.T) {
	srv, token, wsID, _, _ := setupEmailHubHTTP(t)
	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/email-hub/providers", token, nil)
	google, gOK := out["google"].(bool)
	microsoft, mOK := out["microsoft"].(bool)
	if res.StatusCode != http.StatusOK || !gOK || !mOK || google || microsoft {
		t.Fatalf("providers: %d %v", res.StatusCode, out)
	}
}
