package service

import (
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func TestMcpAuthenticateAcceptsLiveAccessToken(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	p, err := w.svc.Authenticate(w.ctx, pair.AccessToken)
	if err != nil || p.UserID != w.owner.ID || p.OrganizationID != w.org.ID || p.ClientID != c.ClientID || p.GrantID == "" {
		t.Fatalf("principal = %+v, %v", p, err)
	}
}

func TestMcpAuthenticateRefusals(t *testing.T) {
	cases := map[string]struct {
		setup func(t *testing.T, w *mcpWorld, pair McpTokenPair) string
		want  error
	}{
		"refresh token as access": {func(_ *testing.T, _ *mcpWorld, p McpTokenPair) string { return p.RefreshToken }, ErrMcpTokenInvalid},
		"unknown token":           {func(_ *testing.T, _ *mcpWorld, _ McpTokenPair) string { return "uwm_at_nope" }, ErrMcpTokenInvalid},
		"empty bearer":            {func(_ *testing.T, _ *mcpWorld, _ McpTokenPair) string { return "" }, ErrMcpTokenInvalid},
		"session jwt":             {func(_ *testing.T, _ *mcpWorld, _ McpTokenPair) string { return "eyJhbGciOiJIUzI1NiJ9.e30.x" }, ErrMcpTokenInvalid},
		"expired": {func(_ *testing.T, w *mcpWorld, p McpTokenPair) string {
			w.svc.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
			return p.AccessToken
		}, ErrMcpTokenInvalid},
		"token revoked": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_tokens SET revoked_at = now() WHERE digest = $1`, digest(p.AccessToken)); err != nil {
				t.Fatal(err)
			}
			return p.AccessToken
		}, ErrMcpTokenInvalid},
		"grant revoked": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			// Only the grant row changes: the token itself is still live, so the
			// refusal can only come from the grant check.
			if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_grants SET revoked_at = now() WHERE organization_id = $1`, w.org.ID); err != nil {
				t.Fatal(err)
			}
			if n := w.liveTokens(t); n != 2 {
				t.Fatalf("live tokens = %d, the token must still be live for this case", n)
			}
			return p.AccessToken
		}, ErrMcpTokenInvalid},
		"grant revoked through the API": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			grants, _ := w.svc.ListMyGrants(w.ctx, w.owner.ID)
			if err := w.svc.RevokeMyGrant(w.ctx, w.owner.ID, grants[0].ID); err != nil {
				t.Fatal(err)
			}
			return p.AccessToken
		}, ErrMcpTokenInvalid},
		"no longer a member": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			// Leave is the only path that deletes a membership and it revokes the
			// grants; this is the belt for a membership that vanished some other way.
			if _, err := w.pool.Exec(w.ctx, `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, w.org.ID, w.owner.ID); err != nil {
				t.Fatal(err)
			}
			return p.AccessToken
		}, ErrMcpTokenInvalid},
		"organization switched off": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
				t.Fatal(err)
			}
			return p.AccessToken
		}, ErrMcpConnectorDisabled},
		"flag off": {func(_ *testing.T, w *mcpWorld, p McpTokenPair) string {
			w.svc.SetFlags(mcpFlags(false))
			return p.AccessToken
		}, ErrMcpConnectorDisabled},
		"no flag service": {func(_ *testing.T, w *mcpWorld, p McpTokenPair) string {
			w.svc.SetFlags(nil)
			return p.AccessToken
		}, ErrMcpConnectorDisabled},
		"organization suspended": {func(t *testing.T, w *mcpWorld, p McpTokenPair) string {
			if _, err := w.pool.Exec(w.ctx, `UPDATE organizations SET status = 'suspended' WHERE id = $1`, w.org.ID); err != nil {
				t.Fatal(err)
			}
			return p.AccessToken
		}, ErrOrganizationSuspended},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w := newMcpWorld(t)
			_, pair := w.issue(t)
			if _, err := w.svc.Authenticate(w.ctx, tc.setup(t, w, pair)); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
}

// A refused request is not a use: nothing is stamped on a grant that was not
// served.
func TestMcpAuthenticateTouchesOnlyServedGrants(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	if _, err := w.svc.Authenticate(w.ctx, pair.RefreshToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatal(err)
	}
	grants, err := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if err != nil || len(grants) != 1 || grants[0].LastUsedAt != nil {
		t.Fatalf("grant stamped by a refused request: %+v, %v", grants, err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); err != nil {
		t.Fatal(err)
	}
	grants, _ = w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if len(grants) != 1 || grants[0].LastUsedAt == nil {
		t.Fatalf("grant not stamped by a served request: %+v", grants)
	}
	client, err := w.q.GetMcpClientByClientID(w.ctx, c.ClientID)
	if err != nil || !client.LastUsedAt.Valid {
		t.Fatalf("client not stamped: %+v, %v", client, err)
	}
}

func TestMcpAuthenticateRefusesDeactivatedMember(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-member@example.com", "Member")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, pair := w.issueAs(t, member)
	if _, err := w.pool.Exec(w.ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.org.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deactivated member: %v", err)
	}
	// Spec §8: the grant stays and only the gate blocks; reactivation resumes it.
	if _, err := w.pool.Exec(w.ctx, `UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`, w.org.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if p, err := w.svc.Authenticate(w.ctx, pair.AccessToken); err != nil || p.UserID != member.ID {
		t.Fatalf("after reactivation: %+v, %v", p, err)
	}
}

// Spec §8: switching the organization off blocks at once and deletes nothing;
// switching it on again lets the old grant work.
func TestMcpAuthenticateResumesWhenSwitchedBackOn(t *testing.T) {
	w := newMcpWorld(t)
	_, pair := w.issue(t)
	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpConnectorDisabled) {
		t.Fatalf("switched off: %v", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("switching off deleted tokens: live = %d", n)
	}
	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); err != nil {
		t.Fatalf("switched back on: %v", err)
	}
}

// The tool registry reads the actor and organization from the ToolContext the
// transport builds; the workspace is always the tool's own input.
func TestMcpPrincipalToolContextIsTheConsentingHuman(t *testing.T) {
	tc := McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", ClientID: "c1"}.ToolContext()
	if tc.ActorID != "u1" || tc.ActorKind != audit.KindHuman || tc.OrganizationID != "o1" || tc.WorkspaceID != "" {
		t.Fatalf("ToolContext = %+v", tc)
	}
	if p := principalOf(tc); p.UserID != "u1" || p.OrganizationID != "o1" {
		t.Fatalf("principalOf(ToolContext) = %+v", p)
	}
}

// The principal says whether this call may write: the grant's scope and both
// write switches, read on every request so turning one off acts at once.
func TestAuthenticateReportsWriteAccess(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startWrite(t, c)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	to, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	pair, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: u.Query().Get("code"), CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	p, err := w.svc.Authenticate(w.ctx, pair.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if !p.CanWrite() || p.Scope != "read write" || p.ClientName != "Test Client" {
		t.Fatalf("principal = %+v, want a writer named Test Client", p)
	}
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	p, err = w.svc.Authenticate(w.ctx, pair.AccessToken)
	if err != nil {
		t.Fatalf("Authenticate after the write switch went off: %v", err)
	}
	if p.CanWrite() || p.WriteOpen || p.Scope != "read write" || p.ClientName != "Test Client" {
		t.Fatalf("write switch off, principal = %+v, want the grant intact and WriteOpen false", p)
	}
}

// A grant that holds only read cannot write even when both switches are on:
// the scope is the third condition of CanWrite.
func TestAuthenticateReadOnlyGrantCannotWrite(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	_, pair := w.issue(t)
	p, err := w.svc.Authenticate(w.ctx, pair.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if !p.WriteOpen || p.Scope != "read" || p.CanWrite() {
		t.Fatalf("principal = %+v, want write open, scope read, CanWrite false", p)
	}
}

// CanWrite needs both switches and a grant that holds write.
func TestMcpPrincipalCanWriteTruthTable(t *testing.T) {
	cases := []struct {
		open  bool
		scope string
		want  bool
	}{
		{true, "read write", true},
		{true, "read", false},
		{false, "read write", false},
		{false, "read", false},
		{true, "", false},
	}
	for _, c := range cases {
		if got := (McpPrincipal{WriteOpen: c.open, Scope: c.scope}).CanWrite(); got != c.want {
			t.Errorf("WriteOpen=%v Scope=%q: CanWrite = %v, want %v", c.open, c.scope, got, c.want)
		}
	}
}
