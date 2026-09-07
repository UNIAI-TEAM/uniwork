package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type orgInviteFixture struct {
	ctx     context.Context
	q       *db.Queries
	orgs    *OrganizationService
	svc     *OrganizationMemberService
	ws      *WorkspaceService
	outbox  *fakeOutbox
	org     db.Organization
	owner   db.User
	admin   db.User
	member  db.User
	invitee db.User
}

func newOrgInviteFixture(t *testing.T) *orgInviteFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	out := &fakeOutbox{}
	renderer := mail.Renderer{AppURL: "http://localhost:3000"}
	f := &orgInviteFixture{
		ctx: context.Background(), q: q, orgs: orgs, outbox: out,
		svc: NewOrganizationMemberService(pool, q, orgs),
		ws:  NewWorkspaceService(pool, q, orgs, renderer, out),
	}
	f.svc.SetMail(renderer, out)
	f.owner = registerVerified(t, q, as, "inv-owner@example.com", "Chủ")
	f.admin = registerVerified(t, q, as, "inv-admin@example.com", "Quản trị")
	f.member = registerVerified(t, q, as, "inv-member@example.com", "Thành viên")
	f.invitee = registerVerified(t, q, as, "inv-new@example.com", "Người mới")
	o, err := orgs.Create(f.ctx, f.owner.ID, "Unicom", "unicom-invite")
	if err != nil {
		t.Fatal(err)
	}
	f.org = o
	for _, m := range []struct{ id, role string }{{f.admin.ID, OrgRoleAdmin}, {f.member.ID, OrgRoleMember}} {
		if err := q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
			OrganizationID: o.ID, UserID: m.id, Role: m.role,
		}); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func TestInviteToOrganizationSkipsMembersAndReusesPendingTokens(t *testing.T) {
	f := newOrgInviteFixture(t)
	invs, skipped, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID,
		[]string{"inv-new@example.com", "inv-member@example.com", "not-an-email", "INV-NEW@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if len(invs) != 1 {
		t.Fatalf("invitations: %d, want 1", len(invs))
	}
	if len(skipped) != 2 { // an existing member, and an address that is not one
		t.Fatalf("skipped: %v", skipped)
	}
	first := invs[0].Token
	// Inviting the same address again must not mint a second token: the link
	// already in their inbox would stop working.
	again, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-new@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 1 || again[0].Token != first {
		t.Fatalf("second invite minted a new token: %+v", again)
	}
	if _, _, err := f.svc.InviteToOrg(f.ctx, f.member.ID, f.org.ID, []string{"someone@example.com"}, OrgRoleMember); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member inviting: got %v", err)
	}
	if _, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"x@example.com"}, "owner"); err == nil {
		t.Fatal("an invitation to the owner role was accepted")
	}
}

func TestAcceptOrganizationInviteAddsMemberWithoutAWorkspace(t *testing.T) {
	f := newOrgInviteFixture(t)
	invs, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-new@example.com"}, OrgRoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token)
	if err != nil {
		t.Fatal(err)
	}
	if result.Workspace != nil {
		t.Fatal("an organization-level invitation must not put anyone in a workspace")
	}
	if result.Organization.ID != f.org.ID {
		t.Fatalf("organization: %+v", result.Organization)
	}
	m, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.invitee.ID)
	if err != nil || m.Role != OrgRoleAdmin {
		t.Fatalf("membership: %v role=%s", err, m.Role)
	}
	// Accepting also onboards, so there is never a member who cannot enter.
	u, err := f.q.GetUserByID(f.ctx, f.invitee.ID)
	if err != nil || !u.OnboardedAt.Valid {
		t.Fatalf("onboarded: %v", err)
	}
	// The token is single use.
	if _, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reused token: %v", err)
	}
}

func TestADeactivatedMemberIsNotReAdmittedByAnInvitation(t *testing.T) {
	f := newOrgInviteFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	// Inviting somebody who was switched off is a mistake: the row is still
	// there, and the fix is to reactivate them. So the address is skipped
	// rather than sent a link that would fail on accept.
	invs, skipped, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-member@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if len(invs) != 0 || len(skipped) != 1 {
		t.Fatalf("invitations %d, skipped %v", len(invs), skipped)
	}
	// And an invitation issued before the deactivation cannot be used as a way
	// back in either.
	other, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-new@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.invitee.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the invitee is not a member yet: %v", err)
	}
	if _, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, other[0].Token); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.invitee.ID); err != nil {
		t.Fatal(err)
	}
	second, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-new@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 0 {
		t.Fatal("a deactivated member was invited back in instead of being reactivated")
	}
}

func TestRevokeInvitationStopsTheToken(t *testing.T) {
	f := newOrgInviteFixture(t)
	invs, _, err := f.svc.InviteToOrg(f.ctx, f.owner.ID, f.org.ID, []string{"inv-new@example.com"}, OrgRoleMember)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RevokeInvitation(f.ctx, f.admin.ID, f.org.ID, invs[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.AcceptInvite(f.ctx, f.invitee.ID, invs[0].Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked token still works: %v", err)
	}
	pending, err := f.svc.PendingInvitations(f.ctx, f.owner.ID, f.org.ID)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending after revoke: %v %d", err, len(pending))
	}
	if err := f.svc.RevokeInvitation(f.ctx, f.owner.ID, f.org.ID, invs[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoking twice: %v", err)
	}
	if err := f.svc.RevokeInvitation(f.ctx, f.member.ID, f.org.ID, invs[0].ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member revoking: %v", err)
	}
}

func TestTransferOwnershipIsAtomicAndNeedsThePassword(t *testing.T) {
	f := newOrgInviteFixture(t)
	if _, err := f.svc.TransferOwnership(f.ctx, f.owner.ID, f.org.ID, f.admin.ID, "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("wrong password: got %v", err)
	}
	if _, err := f.svc.TransferOwnership(f.ctx, f.admin.ID, f.org.ID, f.member.ID, "password123"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin transferring: got %v", err)
	}
	updated, err := f.svc.TransferOwnership(f.ctx, f.owner.ID, f.org.ID, f.admin.ID, "password123")
	if err != nil || updated.Role != OrgRoleOwner {
		t.Fatalf("transfer: %v role=%s", err, updated.Role)
	}
	// Exactly one owner, and the old one is an admin — not a member, not gone.
	old, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.owner.ID)
	if err != nil || old.Role != OrgRoleAdmin {
		t.Fatalf("previous owner: %v role=%s", err, old.Role)
	}
	page, err := f.svc.Members(f.ctx, f.admin.ID, f.org.ID, MemberStatusAll, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	owners := 0
	for _, m := range page.Members {
		if m.Role == OrgRoleOwner {
			owners++
		}
	}
	if owners != 1 {
		t.Fatalf("owners after transfer: %d", owners)
	}
	// The new owner can now leave nobody behind: they must transfer first.
	if err := f.svc.Leave(f.ctx, f.admin.ID, f.org.ID); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("new owner leaving: %v", err)
	}
	// And the previous owner, now an admin, can.
	if err := f.svc.Leave(f.ctx, f.owner.ID, f.org.ID); err != nil {
		t.Fatalf("previous owner leaving: %v", err)
	}
}

func TestTransferOwnershipRefusesADeactivatedTarget(t *testing.T) {
	f := newOrgInviteFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.TransferOwnership(f.ctx, f.owner.ID, f.org.ID, f.member.ID, "password123"); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deactivated target: got %v", err)
	}
}
