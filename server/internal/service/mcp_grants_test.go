package service

import (
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func auditCount(t *testing.T, w *mcpWorld, action string) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND organization_id = $2`, action, w.org.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// liveTokensOf counts a person's live tokens across every organization.
func (w *mcpWorld) liveTokensOf(t *testing.T, userID string) int {
	t.Helper()
	return w.countRows(t, `SELECT count(*) FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id WHERE g.user_id = $1 AND t.revoked_at IS NULL`, userID)
}

// otherOrg builds a second organization owned by a stranger and returns it
// with its owner (slug is also the owner's mailbox).
func (w *mcpWorld) otherOrg(t *testing.T, slug string) (db.Organization, db.User) {
	t.Helper()
	owner := registerVerified(t, w.q, w.auth, slug+"@example.com", "Other Owner")
	org, err := w.orgs.Create(w.ctx, owner.ID, "Other Org", slug)
	if err != nil {
		t.Fatal(err)
	}
	return org, owner
}

// grantIn gives userID a live grant (and a live token pair) in org for a new
// client, without the consent flow: the other organization has its own switch.
func (w *mcpWorld) grantIn(t *testing.T, orgID, userID string) db.McpGrant {
	t.Helper()
	c := w.publicClient(t, "https://y.test/cb")
	g, err := w.q.CreateMcpGrant(w.ctx, db.CreateMcpGrantParams{
		ID: util.NewID(), OrganizationID: orgID, UserID: userID, ClientID: c.ClientID,
		Scope: mcpScopeRead, CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.issuePair(w.ctx, w.q, g, util.NewID()); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestMcpMyGrantsListAndRevoke(t *testing.T) {
	w := newMcpWorld(t)
	c, _ := w.issue(t)
	grants, err := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if err != nil || len(grants) != 1 || grants[0].ClientID != c.ClientID || grants[0].OrganizationName != "MCP Org" {
		t.Fatalf("grants = %+v, %v", grants, err)
	}
	stranger := registerVerified(t, w.q, w.auth, "mcp-stranger@example.com", "Stranger")
	if err := w.svc.RevokeMyGrant(w.ctx, stranger.ID, grants[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoking someone else's grant: %v", err)
	}
	if err := w.svc.RevokeMyGrant(w.ctx, stranger.ID, "01NOSUCHGRANT00000000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unknown grant answers like someone else's: %v", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("a refused revoke changed the tokens: live = %d", n)
	}
	if err := w.svc.RevokeMyGrant(w.ctx, w.owner.ID, grants[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := w.svc.RevokeMyGrant(w.ctx, w.owner.ID, grants[0].ID); err != nil {
		t.Fatalf("revoke is idempotent: %v", err)
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens after revoke = %d", n)
	}
	if n := auditCount(t, w, audit.ActionMcpGrantRevoked); n != 1 {
		t.Fatalf("revoked audit rows = %d, want 1", n)
	}
	if grants, err := w.svc.ListMyGrants(w.ctx, w.owner.ID); err != nil || len(grants) != 0 {
		t.Fatalf("a revoked grant is still listed: %+v, %v", grants, err)
	}
}

func TestMcpGrantRevokeAuditRecordsWho(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-member-audit@example.com", "Member")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, _ = w.issueAs(t, member)
	grants, err := w.svc.ListOrgGrants(w.ctx, w.owner.ID, w.org.ID)
	if err != nil || len(grants) != 1 {
		t.Fatalf("grants = %+v, %v", grants, err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, w.owner.ID, w.org.ID, grants[0].ID); err != nil {
		t.Fatal(err)
	}
	var actorID, actorKind, resource string
	if err := w.pool.QueryRow(w.ctx, `SELECT actor_id, actor_kind, resource_id FROM audit_events WHERE action = $1 AND organization_id = $2`,
		audit.ActionMcpGrantRevoked, w.org.ID).Scan(&actorID, &actorKind, &resource); err != nil {
		t.Fatal(err)
	}
	if actorID != w.owner.ID || actorKind != string(audit.KindHuman) || resource != grants[0].ID {
		t.Fatalf("audit row = actor %s/%s resource %s: it must name the admin who revoked, not the grant's owner", actorKind, actorID, resource)
	}
	var by, kind string
	if err := w.pool.QueryRow(w.ctx, `SELECT revoked_by, revoked_by_kind FROM mcp_grants WHERE id = $1`, grants[0].ID).Scan(&by, &kind); err != nil {
		t.Fatal(err)
	}
	if by != w.owner.ID || kind != "human" {
		t.Fatalf("revoked_by = %s/%s", kind, by)
	}
}

func TestMcpOrgGrantsNeedAdmin(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-member2@example.com", "Member")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, _ = w.issueAs(t, member)
	if _, err := w.svc.ListOrgGrants(w.ctx, member.ID, w.org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member listing org grants: %v", err)
	}
	grants, err := w.svc.ListOrgGrants(w.ctx, w.owner.ID, w.org.ID)
	if err != nil || len(grants) != 1 || grants[0].UserID != member.ID || grants[0].UserName != "Member" {
		t.Fatalf("org grants = %+v, %v", grants, err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, member.ID, w.org.ID, grants[0].ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a plain member revoking through the organization route: %v", err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, w.owner.ID, "01OTHERORG0000000000000000", grants[0].ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a grant is revoked only through its own organization: %v", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("refused revokes changed the tokens: live = %d", n)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, w.owner.ID, w.org.ID, grants[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, w.owner.ID, w.org.ID, "01NOSUCHGRANT00000000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an unknown grant id: %v", err)
	}
}

// An admin of one organization sees and closes only that organization's
// grants, even for a person who belongs to both.
func TestMcpAdminOfAnotherOrganizationReachesNothing(t *testing.T) {
	w := newMcpWorld(t)
	_, pair := w.issue(t)
	grants, _ := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	orgB, adminB := w.otherOrg(t, "mcp-org-b1")

	if _, err := w.svc.ListOrgGrants(w.ctx, adminB.ID, w.org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B's admin listing A's grants: %v", err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, adminB.ID, w.org.ID, grants[0].ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B's admin revoking through A's route: %v", err)
	}
	// Through B's own route, A's grant id is simply not B's: no row, no oracle.
	if err := w.svc.RevokeOrgGrant(w.ctx, adminB.ID, orgB.ID, grants[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("B's admin revoking A's grant through B's route: %v", err)
	}
	if _, err := w.svc.Policy(w.ctx, adminB.ID, w.org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B's admin reading A's policy: %v", err)
	}
	if _, err := w.svc.SetPolicy(w.ctx, adminB.ID, w.org.ID, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("B's admin switching A off: %v", err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); err != nil {
		t.Fatalf("A's grant must be untouched: %v", err)
	}

	// The owner of A also sits in B: B's admin lists that grant, A's does not.
	addOrgMember(t, w.q, orgB.ID, w.owner.ID)
	gB := w.grantIn(t, orgB.ID, w.owner.ID)
	listed, err := w.svc.ListOrgGrants(w.ctx, adminB.ID, orgB.ID)
	if err != nil || len(listed) != 1 || listed[0].ID != gB.ID || listed[0].OrganizationID != orgB.ID {
		t.Fatalf("B's list = %+v, %v", listed, err)
	}
	listed, err = w.svc.ListOrgGrants(w.ctx, w.owner.ID, w.org.ID)
	if err != nil || len(listed) != 1 || listed[0].ID == gB.ID {
		t.Fatalf("A's list leaks B's grant: %+v, %v", listed, err)
	}
	if err := w.svc.RevokeOrgGrant(w.ctx, w.owner.ID, w.org.ID, gB.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("A's owner revoking B's grant through A's route: %v", err)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE id = $1 AND revoked_at IS NULL`, gB.ID); n != 1 {
		t.Fatal("B's grant was revoked through A's route")
	}
	mine, _ := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if len(mine) != 2 {
		t.Fatalf("a person sees all their own grants: %+v", mine)
	}
}

func TestMcpPolicyToggleAudits(t *testing.T) {
	w := newMcpWorld(t)
	p, err := w.svc.Policy(w.ctx, w.owner.ID, w.org.ID)
	if err != nil || p.Enabled || !p.Available {
		t.Fatalf("initial policy = %+v, %v", p, err)
	}
	p, err = w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true)
	if err != nil || !p.Enabled || p.EnabledBy != w.owner.ID || p.EnabledAt == nil {
		t.Fatalf("enable = %+v, %v", p, err)
	}
	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if n := auditCount(t, w, audit.ActionOrganizationMcpPolicyChanged); n != 1 {
		t.Fatalf("an unchanged switch writes no row: rows = %d, want 1", n)
	}
	w.svc.SetFlags(mcpFlags(false))
	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true); !errors.Is(err, ErrMcpConnectorDisabled) {
		t.Fatalf("the switch cannot turn on while the platform flag is off: %v", err)
	}
	member := registerVerified(t, w.q, w.auth, "mcp-member3@example.com", "Member")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	if _, err := w.svc.SetPolicy(w.ctx, member.ID, w.org.ID, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member toggling: %v", err)
	}
	if _, err := w.svc.Policy(w.ctx, member.ID, w.org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member reading the switch: %v", err)
	}
}

// Turning the switch off is always allowed, even with the platform flag off,
// clears who turned it on, and is one audit row with the new value.
func TestMcpPolicyDisableClearsAndAudits(t *testing.T) {
	w := newMcpWorld(t)
	admin := registerVerified(t, w.q, w.auth, "mcp-admin@example.com", "Admin")
	addOrgMemberRole(t, w.q, w.org.ID, admin.ID, OrgRoleAdmin)
	if p, err := w.svc.SetPolicy(w.ctx, admin.ID, w.org.ID, true); err != nil || p.EnabledBy != admin.ID {
		t.Fatalf("an admin may switch it on: %+v, %v", p, err)
	}
	w.svc.SetFlags(mcpFlags(false))
	p, err := w.svc.Policy(w.ctx, admin.ID, w.org.ID)
	if err != nil || !p.Enabled || p.Available {
		t.Fatalf("policy with the flag off = %+v, %v", p, err)
	}
	p, err = w.svc.SetPolicy(w.ctx, admin.ID, w.org.ID, false)
	if err != nil || p.Enabled || p.EnabledAt != nil || p.EnabledBy != "" {
		t.Fatalf("disable = %+v, %v", p, err)
	}
	if n := auditCount(t, w, audit.ActionOrganizationMcpPolicyChanged); n != 2 {
		t.Fatalf("policy audit rows = %d, want 2 (on, off)", n)
	}
	var changes string
	if err := w.pool.QueryRow(w.ctx, `SELECT changes FROM audit_events WHERE action = $1 AND organization_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
		audit.ActionOrganizationMcpPolicyChanged, w.org.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if changes == "" || changes == "{}" {
		t.Fatalf("the audit row records no change: %q", changes)
	}
}

func TestMcpLeavingOrganizationRevokesGrants(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-leaver@example.com", "Leaver")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, pair := w.issueAs(t, member)
	orgMem := NewOrganizationMemberService(w.pool, w.q, w.orgs)
	if err := orgMem.Leave(w.ctx, member.ID, w.org.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatalf("token after leaving: %v", err)
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens after leaving = %d", n)
	}
	// Coming back does not revive the old session: the grant stays revoked.
	addOrgMember(t, w.q, w.org.ID, member.ID)
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatalf("token after leaving and rejoining: %v", err)
	}
}

// Leaving one organization takes that organization's grants only.
func TestMcpLeavingOneOrganizationKeepsTheOthers(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-leaver2@example.com", "Leaver")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, _ = w.issueAs(t, member)
	orgB, _ := w.otherOrg(t, "mcp-org-b2")
	addOrgMember(t, w.q, orgB.ID, member.ID)
	gB := w.grantIn(t, orgB.ID, member.ID)

	orgMem := NewOrganizationMemberService(w.pool, w.q, w.orgs)
	if err := orgMem.Leave(w.ctx, member.ID, w.org.ID); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens in the organization left = %d", n)
	}
	mine, err := w.svc.ListMyGrants(w.ctx, member.ID)
	if err != nil || len(mine) != 1 || mine[0].ID != gB.ID {
		t.Fatalf("the other organization's grant must survive: %+v, %v", mine, err)
	}
	if n := w.liveTokensOf(t, member.ID); n != 2 {
		t.Fatalf("the other organization's tokens = %d, want 2", n)
	}
}

// Spec §8: deactivation keeps the grant and blocks at the membership gate.
func TestMcpDeactivationBlocksButKeepsGrants(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-deact@example.com", "Deact")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, pair := w.issueAs(t, member)
	orgMem := NewOrganizationMemberService(w.pool, w.q, w.orgs)
	if _, err := orgMem.Deactivate(w.ctx, w.owner.ID, w.org.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deactivated member: %v", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("deactivation revoked tokens: live = %d", n)
	}
	if mine, err := w.svc.ListMyGrants(w.ctx, member.ID); err != nil || len(mine) != 1 {
		t.Fatalf("deactivation revoked the grant: %+v, %v", mine, err)
	}
	if _, err := orgMem.Reactivate(w.ctx, w.owner.ID, w.org.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); err != nil {
		t.Fatalf("after reactivation: %v", err)
	}
}

func TestMcpRevokeAllGrantsForUser(t *testing.T) {
	w := newMcpWorld(t)
	_, pair := w.issue(t)
	if n, err := revokeAllMcpGrantsForUser(w.ctx, w.q, w.owner.ID); err != nil || n != 1 {
		t.Fatalf("revoked %d grants, %v; want 1", n, err)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatalf("token after account deletion revoke: %v", err)
	}
}

// Deleting an account closes the person's connector access in every
// organization they belong to, and leaves other people's alone.
func TestMcpDeleteAccountRevokesEveryGrant(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-gone@example.com", "Gone")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, pair := w.issueAs(t, member)
	_, ownerPair := w.issue(t)
	orgB, _ := w.otherOrg(t, "mcp-org-b3")
	addOrgMember(t, w.q, orgB.ID, member.ID)
	_ = w.grantIn(t, orgB.ID, member.ID)
	if n := w.liveTokensOf(t, member.ID); n != 4 {
		t.Fatalf("setup: live tokens = %d, want 4", n)
	}

	if err := w.auth.DeleteAccount(w.ctx, member.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokensOf(t, member.ID); n != 0 {
		t.Fatalf("live tokens after account deletion = %d", n)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE user_id = $1 AND revoked_at IS NULL`, member.ID); n != 0 {
		t.Fatalf("live grants after account deletion = %d", n)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatalf("token after account deletion: %v", err)
	}
	if _, err := w.svc.Authenticate(w.ctx, ownerPair.AccessToken); err != nil {
		t.Fatalf("someone else's token: %v", err)
	}
}

// Ruling 49: a password reset is the answer to a stolen password, and an AI
// app connected by whoever held it would outlive every session the reset
// kills. So the reset closes the person's grants in every organization, in
// the reset's own transaction, and records how many on its revocation row.
// Someone else's grant is untouched. (Desktop "sign out everywhere" keeps
// them: that is a session tool, not a credential reset.)
func TestMcpPasswordResetRevokesEveryGrant(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-reset@example.com", "Reset")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	connected, pair := w.issueAs(t, member)
	pending := w.publicClient(t, "https://x.test/cb")
	code := w.approveAs(t, member, pending, "https://x.test/cb") // approved before the reset, exchanged after
	orgB, _ := w.otherOrg(t, "mcp-org-reset")
	addOrgMember(t, w.q, orgB.ID, member.ID)
	_ = w.grantIn(t, orgB.ID, member.ID)
	_, ownerPair := w.issue(t)

	out := &fakeOutbox{}
	resets := NewPasswordResetService(w.pool, w.q, w.auth, mail.Renderer{AppURL: "https://app.example.test"}, out)
	if err := resets.Request(w.ctx, "mcp-reset@example.com"); err != nil || len(out.queued) != 1 {
		t.Fatalf("request: %v, %d mails", err, len(out.queued))
	}
	if _, err := resets.Reset(w.ctx, resetToken.FindStringSubmatch(out.queued[0].Text)[1], "newpassword1"); err != nil {
		t.Fatal(err)
	}

	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE user_id = $1 AND revoked_at IS NULL`, member.ID); n != 0 {
		t.Fatalf("live grants after the reset = %d, want 0", n)
	}
	if n := w.liveTokensOf(t, member.ID); n != 0 {
		t.Fatalf("live tokens after the reset = %d, want 0", n)
	}
	if _, err := w.svc.Authenticate(w.ctx, pair.AccessToken); !errors.Is(err, ErrMcpTokenInvalid) {
		t.Fatalf("access token minted before the reset: %v, want ErrMcpTokenInvalid (401 on /mcp)", err)
	}
	var oe OAuthError
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: connected.ClientID, RefreshToken: pair.RefreshToken}); !errors.As(err, &oe) || oe.Code != "invalid_grant" {
		t.Fatalf("refresh token minted before the reset: %v, want invalid_grant", err)
	}
	if _, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: pending.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}); !errors.As(err, &oe) || oe.Code != "invalid_grant" {
		t.Fatalf("code approved before the reset: %v, want invalid_grant", err)
	}
	if _, err := w.svc.Authenticate(w.ctx, ownerPair.AccessToken); err != nil {
		t.Fatalf("someone else's token: %v", err)
	}
	var revoked string
	if err := w.pool.QueryRow(w.ctx, `SELECT metadata::jsonb->>'mcp_grants_revoked' FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'reason' = 'password_reset'`, audit.ActionAuthSessionRevoked, member.ID).Scan(&revoked); err != nil || revoked != "3" {
		t.Fatalf("revocation row's mcp_grants_revoked = %q, %v; want 3", revoked, err)
	}
}

// updatedAt is the organization row's updated_at, which a real change bumps.
func (w *mcpWorld) orgUpdatedAt(t *testing.T) time.Time {
	t.Helper()
	var at time.Time
	if err := w.pool.QueryRow(w.ctx, `SELECT updated_at FROM organizations WHERE id = $1`, w.org.ID).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return at
}

// Switching on what is already on changes nothing: the row keeps the admin who
// really turned it on (the audit row says so), so a second admin's repeat does
// not rewrite who and when. The same holds for switching off what is off.
func TestMcpSetPolicyRepeatChangesNothing(t *testing.T) {
	w := newMcpWorld(t)
	admin := registerVerified(t, w.q, w.auth, "mcp-admin-repeat@example.com", "Admin")
	addOrgMemberRole(t, w.q, w.org.ID, admin.ID, OrgRoleAdmin)
	first, err := w.svc.SetPolicy(w.ctx, admin.ID, w.org.ID, true)
	if err != nil || first.EnabledBy != admin.ID || first.EnabledAt == nil {
		t.Fatalf("first enable = %+v, %v", first, err)
	}
	stamp := w.orgUpdatedAt(t)

	again, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Enabled || !again.Available || again.EnabledBy != admin.ID || again.EnabledAt == nil || !again.EnabledAt.Equal(*first.EnabledAt) {
		t.Fatalf("a repeated enable rewrote the row: first %+v, repeat %+v", first, again)
	}
	if p, err := w.svc.Policy(w.ctx, w.owner.ID, w.org.ID); err != nil || p.EnabledBy != admin.ID {
		t.Fatalf("policy after the repeat = %+v, %v", p, err)
	}
	if got := w.orgUpdatedAt(t); !got.Equal(stamp) {
		t.Fatalf("updated_at moved from %v to %v on a repeated enable", stamp, got)
	}
	if n := auditCount(t, w, audit.ActionOrganizationMcpPolicyChanged); n != 1 {
		t.Fatalf("policy audit rows = %d, want 1", n)
	}

	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	stamp = w.orgUpdatedAt(t)
	off, err := w.svc.SetPolicy(w.ctx, admin.ID, w.org.ID, false)
	if err != nil || off.Enabled || off.EnabledAt != nil || off.EnabledBy != "" {
		t.Fatalf("repeated disable = %+v, %v", off, err)
	}
	if got := w.orgUpdatedAt(t); !got.Equal(stamp) {
		t.Fatalf("updated_at moved from %v to %v on a repeated disable", stamp, got)
	}
	if n := auditCount(t, w, audit.ActionOrganizationMcpPolicyChanged); n != 2 {
		t.Fatalf("policy audit rows = %d, want 2 (on, off)", n)
	}
}

// An administrator who is deactivated, or whose organization is suspended, gets
// the membership gate's answer on every organization-level command, not a
// success: the gate is RequireMember and the role check comes after it.
func TestMcpOrgCommandsRefuseDeactivatedAdminAndSuspendedOrganization(t *testing.T) {
	w := newMcpWorld(t)
	admin := registerVerified(t, w.q, w.auth, "mcp-admin-gate@example.com", "Admin")
	addOrgMemberRole(t, w.q, w.org.ID, admin.ID, OrgRoleAdmin)
	_, _ = w.issue(t)
	grants, _ := w.svc.ListMyGrants(w.ctx, w.owner.ID)

	commands := map[string]func(actor string) error{
		"ListOrgGrants":  func(a string) error { _, err := w.svc.ListOrgGrants(w.ctx, a, w.org.ID); return err },
		"RevokeOrgGrant": func(a string) error { return w.svc.RevokeOrgGrant(w.ctx, a, w.org.ID, grants[0].ID) },
		"Policy":         func(a string) error { _, err := w.svc.Policy(w.ctx, a, w.org.ID); return err },
		"SetPolicy on":   func(a string) error { _, err := w.svc.SetPolicy(w.ctx, a, w.org.ID, true); return err },
		"SetPolicy off":  func(a string) error { _, err := w.svc.SetPolicy(w.ctx, a, w.org.ID, false); return err },
	}
	check := func(want error) {
		t.Helper()
		for name, run := range commands {
			if err := run(admin.ID); !errors.Is(err, want) {
				t.Errorf("%s: err = %v, want %v", name, err, want)
			}
		}
		if n := w.liveTokens(t); n != 2 {
			t.Errorf("a refused command changed the tokens: live = %d", n)
		}
	}

	if _, err := w.pool.Exec(w.ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.org.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	check(ErrMemberDeactivated)

	if _, err := w.pool.Exec(w.ctx, `UPDATE organization_members SET deactivated_at = NULL WHERE organization_id = $1 AND user_id = $2`, w.org.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.pool.Exec(w.ctx, `UPDATE organizations SET status = 'suspended' WHERE id = $1`, w.org.ID); err != nil {
		t.Fatal(err)
	}
	check(ErrOrganizationSuspended)
}
