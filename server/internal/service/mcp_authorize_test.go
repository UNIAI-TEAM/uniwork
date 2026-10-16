package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// startAttempt registers nothing: it opens an attempt for c and returns its id.
func (w *mcpWorld) startAttempt(t *testing.T, c McpClient, redirect, state string) string {
	t.Helper()
	consentURL, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: redirect, CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", State: state})
	if err != nil {
		t.Fatal(err)
	}
	return attemptID(t, consentURL)
}

func (w *mcpWorld) countRows(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(w.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMcpStartRefusesUnknownClientWithoutRedirect(t *testing.T) {
	w := newMcpWorld(t)
	_, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: "mcpc_nope", RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	var ae *McpAuthorizeError
	if !errors.As(err, &ae) || ae.Code != "invalid_client" || ae.RedirectURI != "" {
		t.Fatalf("unknown client: %#v", err)
	}
	c := w.publicClient(t, "https://x.test/cb")
	_, err = w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb2", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	if !errors.As(err, &ae) || ae.RedirectURI != "" {
		t.Fatalf("near-miss redirect must not be redirected to: %#v", err)
	}
}

func TestMcpStartRedirectsProtocolErrors(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	base := McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", State: "s1"}
	for name, mut := range map[string]func(*McpAuthorizeInput){
		"unsupported_response_type": func(in *McpAuthorizeInput) { in.ResponseType = "token" },
		"invalid_request":           func(in *McpAuthorizeInput) { in.CodeChallengeMethod = "plain" },
		"invalid_scope":             func(in *McpAuthorizeInput) { in.Scope = "admin" },
		"invalid_target":            func(in *McpAuthorizeInput) { in.Resource = "https://elsewhere.test/mcp" },
	} {
		in := base
		mut(&in)
		_, err := w.svc.Start(w.ctx, in)
		var ae *McpAuthorizeError
		if !errors.As(err, &ae) || ae.Code != name || ae.RedirectURI != "https://x.test/cb" || ae.State != "s1" {
			t.Errorf("%s: %#v", name, err)
		}
	}
	consentURL, err := w.svc.Start(w.ctx, base)
	if err != nil || attemptID(t, consentURL) == "" {
		t.Fatalf("valid start: %q %v", consentURL, err)
	}
	if u, _ := url.Parse(consentURL); u.Host != "app.example.test" || u.Path != "/auth/connect/authorize" {
		t.Fatalf("consent url = %s", consentURL)
	}
}

func TestMcpConsentBelongsToFirstReader(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "")
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil || consent.CSRFToken == "" || consent.RedirectHost != "x.test" || len(consent.Organizations) != 1 || !consent.Organizations[0].Enabled {
		t.Fatalf("consent = %+v, %v", consent, err)
	}
	other := registerVerified(t, w.q, w.auth, "mcp-other@example.com", "Other")
	if _, err := w.svc.Consent(w.ctx, other.ID, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another person reading the attempt: %v", err)
	}
	if _, err := w.svc.Approve(w.ctx, other.ID, id, consent.CSRFToken, w.org.ID, false); err == nil {
		t.Fatal("another person approved the attempt")
	}
}

func TestMcpApproveChecksCSRFAndOrganization(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "")
	consent, _ := w.svc.Consent(w.ctx, w.owner.ID, id)
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); !errors.Is(err, ErrMcpConnectorDisabled) {
		t.Fatalf("org not enabled: %v", err)
	}
	w.enable(t)
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, "wrong", w.org.ID, false); !errors.Is(err, ErrMcpCSRF) {
		t.Fatalf("wrong csrf: %v", err)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, "01NOTMYORG000000000000000", false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign organization: %v", err)
	}
}

// A person who did not claim the attempt cannot approve it even with the
// claimant's CSRF token and an organization of their own that is enabled.
func TestMcpApproveRefusesAnotherUsersAttempt(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "")
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	other := registerVerified(t, w.q, w.auth, "mcp-intruder@example.com", "Intruder")
	otherOrg, err := w.orgs.Create(w.ctx, other.ID, "Other Org", "mcp-other-org")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.q.SetOrganizationMcpPolicy(w.ctx, db.SetOrganizationMcpPolicyParams{ID: otherOrg.ID, Enabled: true, ActorID: other.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Approve(w.ctx, other.ID, id, consent.CSRFToken, otherOrg.ID, false); !errors.Is(err, ErrMcpCSRF) {
		t.Fatalf("another user approving the claimant's attempt: %v", err)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE client_id = $1`, c.ClientID); n != 0 {
		t.Fatalf("grants after refused approve = %d", n)
	}
	// The claimant can still finish it.
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); err != nil {
		t.Fatalf("claimant approve: %v", err)
	}
}

// An attempt that lapsed after the consent page loaded is refused, and leaves
// neither a grant nor an audit row behind.
func TestMcpApproveRefusesExpiredAttempt(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "")
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_auth_attempts SET expires_at = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); !errors.Is(err, ErrMcpAttemptExpired) {
		t.Fatalf("expired attempt: %v", err)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1`, w.org.ID); n != 0 {
		t.Fatalf("grants after expired approve = %d", n)
	}
	if n := w.countRows(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND organization_id = $2`, audit.ActionMcpGrantCreated, w.org.ID); n != 0 {
		t.Fatalf("audit rows after expired approve = %d", n)
	}
}

// Expiry that passes between the row lock and the update (the service clock
// still reads the attempt as live) surfaces as the same expired error, not as
// a raw "no rows", and rolls the grant back with it.
func TestMcpApproveExpiryRacingTheUpdateIsExpired(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "")
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_auth_attempts SET expires_at = now() - interval '1 hour' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	w.svc.now = func() time.Time { return time.Now().Add(-2 * time.Hour) } // the lock check still sees it as live
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); !errors.Is(err, ErrMcpAttemptExpired) {
		t.Fatalf("expiry racing the update: %v", err)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1`, w.org.ID); n != 0 {
		t.Fatalf("the grant survived a refused approve: %d", n)
	}
	if n := w.countRows(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND organization_id = $2`, audit.ActionMcpGrantCreated, w.org.ID); n != 0 {
		t.Fatalf("audit rows after a refused approve = %d", n)
	}
}

// Review Focus 3: a redirect that already carries a query keeps it.
func TestMcpApproveKeepsRedirectQuery(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	redirect := "https://claude.ai/api/mcp/auth_callback?a=1"
	c := w.publicClient(t, redirect)
	id := w.startAttempt(t, c, redirect, "abc")
	consent, _ := w.svc.Consent(w.ctx, w.owner.ID, id)
	to, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(to)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("a") != "1" || q.Get("code") == "" || q.Get("state") != "abc" || q.Get("iss") != mcpTestAPI {
		t.Fatalf("redirect = %s", to)
	}
	if u.Scheme != "https" || u.Host != "claude.ai" || u.Path != "/api/mcp/auth_callback" || strings.Count(to, "?") != 1 {
		t.Fatalf("redirect must keep one query string on the registered path: %s", to)
	}
	if again, _ := w.svc.Consent(w.ctx, w.owner.ID, id); again.Status != "approved" || again.CSRFToken != "" {
		t.Fatalf("reload after approve = %+v", again)
	}
}

// Review Focus 4: approving the same client again reuses the live grant.
func TestMcpReconsentReusesGrant(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	w.approve(t, c, "https://x.test/cb")
	w.approve(t, c, "https://x.test/cb")
	grants := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1 AND revoked_at IS NULL`, w.org.ID)
	created := w.countRows(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND organization_id = $2`, audit.ActionMcpGrantCreated, w.org.ID)
	if grants != 1 || created != 1 {
		t.Fatalf("grants = %d, created rows = %d; want 1 and 1", grants, created)
	}
}

func TestMcpCancelRedirectsAccessDenied(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startAttempt(t, c, "https://x.test/cb", "s")
	consent, _ := w.svc.Consent(w.ctx, w.owner.ID, id)
	to, err := w.svc.Cancel(w.ctx, w.owner.ID, id, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := url.Parse(to); u.Query().Get("error") != "access_denied" || u.Query().Get("state") != "s" {
		t.Fatalf("cancel redirect = %s", to)
	}
}

// Ruling 32: a client that vanishes between Start and the consent page (its
// metadata document withdrawn, a registered client swept) is a 410 the page
// can word, not the raw sentinel that mapServiceError turns into a 500.
func TestMcpConsentOfAWithdrawnClientIsGone(t *testing.T) {
	type setup struct {
		prepare  func(t *testing.T, w *mcpWorld) (clientID, redirect string)
		withdraw func(t *testing.T, w *mcpWorld, clientID string)
	}
	cimdID := "https://client.example/oauth/metadata.json"
	var doc *fakeCIMD
	cases := map[string]setup{
		"metadata document withdrawn": {
			prepare: func(t *testing.T, w *mcpWorld) (string, string) {
				body, _ := json.Marshal(map[string]any{"client_id": cimdID, "client_name": "Doc Client", "redirect_uris": []string{"https://client.example/cb"}})
				doc = &fakeCIMD{body: body}
				w.svc.SetFetcher(doc)
				return cimdID, "https://client.example/cb"
			},
			withdraw: func(t *testing.T, w *mcpWorld, _ string) {
				// The document is gone and the 24 h cache has run out. The
				// attempt itself stays live: the claim reads the database clock.
				doc.err = fmt.Errorf("%w: status 404", errCIMDRejected)
				w.svc.now = func() time.Time { return time.Now().Add(25 * time.Hour) }
			},
		},
		"registered client swept": {
			prepare: func(t *testing.T, w *mcpWorld) (string, string) {
				return w.publicClient(t, "https://x.test/cb").ClientID, "https://x.test/cb"
			},
			withdraw: func(t *testing.T, w *mcpWorld, clientID string) {
				if _, err := w.pool.Exec(w.ctx, `DELETE FROM mcp_clients WHERE client_id = $1`, clientID); err != nil {
					t.Fatal(err)
				}
			},
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			w := newMcpWorld(t)
			w.enable(t)
			clientID, redirect := c.prepare(t, w)
			id := w.startAttempt(t, McpClient{ClientID: clientID}, redirect, "")
			c.withdraw(t, w, clientID)
			_, err := w.svc.Consent(w.ctx, w.owner.ID, id)
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != "client_unavailable" || ce.Status != http.StatusGone || ce.Msg == "" {
				t.Fatalf("consent of a withdrawn client = %v, want CodedError client_unavailable (410) with a message", err)
			}
			if errors.Is(err, errMcpClientUnknown) || !errors.Is(err, ErrMcpClientUnavailable) {
				t.Fatalf("err = %v, want it to wrap ErrMcpClientUnavailable and not the raw sentinel", err)
			}
		})
	}
}

// startWrite opens an attempt that asks for write and returns its id.
func (w *mcpWorld) startWrite(t *testing.T, c McpClient) string {
	t.Helper()
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", Scope: "read write"})
	if err != nil {
		t.Fatal(err)
	}
	return attemptID(t, to)
}

func (w *mcpWorld) grantScope(t *testing.T, clientID string) string {
	t.Helper()
	g, err := w.q.GetActiveMcpGrant(w.ctx, db.GetActiveMcpGrantParams{OrganizationID: w.org.ID, UserID: w.owner.ID, ClientID: clientID})
	if err != nil {
		t.Fatal(err)
	}
	return g.Scope
}

// The grant holds write only when the app asked for it, the person ticked it
// and the organization allows it; a later consent can raise or lower it, and
// each change is audited.
func TestApproveDecidesTheGrantScope(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")

	// Write asked and ticked, but the organization has not opened write.
	id := w.startWrite(t, c)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	if !consent.WriteRequested || consent.Organizations[0].WriteEnabled {
		t.Fatalf("consent = %+v, want write requested but not open", consent)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope with write closed = %q, want read", got)
	}

	// The organization opens write; the same app asks again and the person ticks it.
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	id = w.startWrite(t, c)
	consent, _ = w.svc.Consent(w.ctx, w.owner.ID, id)
	if !consent.Organizations[0].WriteEnabled {
		t.Fatalf("consent after opening write = %+v", consent.Organizations)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read write" {
		t.Fatalf("scope after ticking write = %q, want read write", got)
	}

	// Reconnecting without the tick takes write away.
	id = w.startWrite(t, c)
	consent, _ = w.svc.Consent(w.ctx, w.owner.ID, id)
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope after unticking = %q, want read", got)
	}
	var changes int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'mcp_grant.scope_changed'`, w.org.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if changes != 2 {
		t.Fatalf("scope_changed rows = %d, want 2", changes)
	}
}

// An app that asked for read only never gets write, whatever the box says.
func TestApproveNeverWidensBeyondTheRequest(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	c := w.publicClient(t, "https://x.test/cb")
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	if err != nil {
		t.Fatal(err)
	}
	id := attemptID(t, to)
	consent, _ := w.svc.Consent(w.ctx, w.owner.ID, id)
	if consent.WriteRequested {
		t.Fatal("a read-only request reads as asking for write")
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope = %q, want read", got)
	}
}

// The platform write flag is the third leg of the gate: with the organization's
// write switch on, turning the flag off still keeps write out of the grant.
func TestApproveNeedsThePlatformWriteFlag(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	c := w.publicClient(t, "https://x.test/cb")

	w.svc.SetFlags(mcpFlagsExcept{off: mcpWriteFlagKey})
	id := w.startWrite(t, c)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	if !consent.WriteRequested || !consent.Organizations[0].Enabled || consent.Organizations[0].WriteEnabled {
		t.Fatalf("consent with the write flag off = %+v, want the connector on and write closed", consent)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope with the write flag off = %q, want read", got)
	}
}
