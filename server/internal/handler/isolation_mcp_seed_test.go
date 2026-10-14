package handler

import (
	"context"
	"net/url"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// buildMcp gives the tenant's owner what the MCP connector writes: the
// organization's switch on, a live grant with its tokens (mcpGrant) and a
// pending consent attempt the owner has read (mcpAttempt), so the matrix can
// aim A's ids at B's routes. The browser consent and the PKCE exchange are a
// protocol between an AI app and the browser, not something one bearer can
// replay over HTTP, so they go through McpAuthService directly.
func (w *isoWorld) buildMcp(t *testing.T, tn *isoTenant) {
	t.Helper()
	ctx := context.Background()
	svc := w.deps.McpAuth
	if _, err := svc.SetPolicy(ctx, tn.userID, tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetWritePolicy(ctx, tn.userID, tn.orgID, true); err != nil {
		t.Fatal(err)
	}
	reg, err := svc.Register(ctx, service.McpRegistration{ClientName: "iso-" + tn.tag, RedirectURIs: []string{mcpTestRedirect}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	start := func() string {
		to, err := svc.Start(ctx, service.McpAuthorizeInput{
			ResponseType: "code", ClientID: reg.Client.ClientID, RedirectURI: mcpTestRedirect,
			CodeChallenge: mcpTestChallenge, CodeChallengeMethod: "S256",
		})
		if err != nil {
			t.Fatal(err)
		}
		u, _ := url.Parse(to)
		return u.Query().Get("attempt")
	}

	first := start()
	consent, err := svc.Consent(ctx, tn.userID, first)
	if err != nil {
		t.Fatal(err)
	}
	back, err := svc.Approve(ctx, tn.userID, first, consent.CSRFToken, tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	bu, _ := url.Parse(back)
	pair, err := svc.Exchange(ctx, service.McpExchangeInput{
		ClientID: reg.Client.ClientID, Code: bu.Query().Get("code"), CodeVerifier: mcpTestVerifier, RedirectURI: mcpTestRedirect,
	})
	if err != nil {
		t.Fatal(err)
	}
	// The grant's access token is what TestIsolationMCP presents to /mcp.
	tn.ids["mcpAccess"] = pair.AccessToken
	grants, err := svc.ListMyGrants(ctx, tn.userID)
	if err != nil || len(grants) == 0 {
		t.Fatalf("seed grant of %s: %v %v", tn.tag, grants, err)
	}
	tn.ids["mcpGrant"] = grants[0].ID

	// Read once by the owner, so the attempt is claimed: another account
	// reading or deciding it must be told nothing. The owner's live CSRF token
	// is kept so the matrix can send it from the wrong account: the token is
	// genuine, so the refusal has to come from the claim, not from a guess.
	pending := start()
	claimed, err := svc.Consent(ctx, tn.userID, pending)
	if err != nil {
		t.Fatal(err)
	}
	tn.ids["mcpAttempt"] = pending
	tn.ids["mcpCSRF"] = claimed.CSRFToken
}

// mcpAttemptDigest hashes the tenant's pending consent attempt row. The table
// carries no organization (an attempt precedes the choice of one), so the
// tenant digest cannot see it.
func (w *isoWorld) mcpAttemptDigest(t *testing.T, tn *isoTenant) string {
	t.Helper()
	var sum string
	if err := w.pool.QueryRow(context.Background(), `SELECT md5(x::text) FROM mcp_auth_attempts x WHERE id = $1`, tn.ids["mcpAttempt"]).Scan(&sum); err != nil {
		t.Fatal(err)
	}
	return sum
}
