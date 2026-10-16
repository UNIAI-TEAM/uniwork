package service

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// codedFields returns the machine-readable details a CodedError carries, and
// fails the test when err is not the coded error named.
func codedFields(t *testing.T, err error, code string) map[string]any {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != code {
		t.Fatalf("got %v, want %s", err, code)
	}
	return ce.Fields
}

// inviteToOrg sends one organization-level invitation from the fixture's
// owner and returns its token; the seat cap is lifted so quota is not the
// subject of the tests that use it.
func (f *orgMembersFixture) inviteToOrg(t *testing.T, orgID, inviterID, email string) string {
	t.Helper()
	f.svc.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"members.max": null}'::jsonb WHERE organization_id = $1`, orgID); err != nil {
		t.Fatal(err)
	}
	invs, _, err := f.svc.InviteToOrg(f.ctx, inviterID, orgID, []string{email}, OrgRoleMember, nil)
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite %s: %v %d", email, err, len(invs))
	}
	return invs[0].Token
}

func (f *orgMembersFixture) setStatus(t *testing.T, orgID, status string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `UPDATE organizations SET status = $2 WHERE id = $1`, orgID, status); err != nil {
		t.Fatal(err)
	}
}

// TestOneActiveOrganizationPerAccount is the rule of ADR 0032: a person
// belongs to at most one active organization, and every path that adds a
// membership checks it inside its transaction.
func TestOneActiveOrganizationPerAccount(t *testing.T) {
	t.Run("a member cannot found a second organization", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		_, err := f.orgs.Create(f.ctx, f.member.ID, "Thứ hai", "thu-hai")
		fields := codedFields(t, err, "already_in_organization")
		ref, ok := fields["organization"].(OrganizationRef)
		if !ok || ref.ID != f.org.ID || ref.Slug != "unicom" || ref.Name != "Unicom" {
			t.Fatalf("details name the current organization: %+v", fields)
		}
		if _, err := f.q.GetOrganizationBySlug(f.ctx, "thu-hai"); err == nil {
			t.Fatal("the refused organization was written")
		}
		// The owner is refused the same way.
		if _, err := f.orgs.Create(f.ctx, f.owner.ID, "Thứ ba", "thu-ba"); !errors.Is(err, ErrAlreadyInOrganization) {
			t.Fatalf("owner founding a second organization: %v", err)
		}
	})

	t.Run("an archived organization or a deactivated row holds nobody", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.orgs.Create(f.ctx, f.member.ID, "Của tôi", "cua-toi"); err != nil {
			t.Fatalf("a deactivated member founding their own organization: %v", err)
		}
		f.setStatus(t, f.org.ID, "archived")
		if _, err := f.orgs.Create(f.ctx, f.admin.ID, "Mới", "moi"); err != nil {
			t.Fatalf("a member of an archived organization founding one: %v", err)
		}
	})

	t.Run("a suspended organization still counts", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		f.setStatus(t, f.org.ID, OrganizationSuspended)
		if _, err := f.orgs.Create(f.ctx, f.member.ID, "Lách", "lach"); !errors.Is(err, ErrAlreadyInOrganization) {
			t.Fatalf("suspension freed the member: %v", err)
		}
	})

	t.Run("accepting a second organization's invitation is refused", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		second, err := f.orgs.Create(f.ctx, f.other.ID, "Bên kia", "ben-kia")
		if err != nil {
			t.Fatal(err)
		}
		token := f.inviteToOrg(t, second.ID, f.other.ID, f.member.Email)
		_, err = f.ws.AcceptInvite(f.ctx, f.member.ID, token, nil)
		fields := codedFields(t, err, "organization_switch_required")
		conflicts, ok := fields["conflicts"].([]MembershipConflict)
		if !ok || len(conflicts) != 1 {
			t.Fatalf("conflicts: %+v", fields)
		}
		c := conflicts[0]
		if c.Organization.ID != f.org.ID || c.Role != OrgRoleMember || c.RequiredAction != "leave" {
			t.Fatalf("conflict: %+v", c)
		}
		if _, err := f.orgs.RequireMember(f.ctx, second.ID, f.member.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("the refused accept left a membership: %v", err)
		}
		// The invitation is still pending: refusing it must not spend it.
		if inv, err := f.q.GetInvitationByTokenAnyState(f.ctx, token); err != nil || inv.AcceptedAt.Valid {
			t.Fatalf("refused invitation was consumed: %v", err)
		}
		// Once they have left, the same link works.
		if err := f.svc.Leave(f.ctx, f.member.ID, f.org.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.ws.AcceptInvite(f.ctx, f.member.ID, token, nil); err != nil {
			t.Fatalf("accept after leaving: %v", err)
		}
	})

	t.Run("an existing member is not in conflict with their own organization", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, "Đội", "doi")
		if err != nil {
			t.Fatal(err)
		}
		invs, _, err := f.ws.InviteMany(f.ctx, f.owner.ID, v.Workspace.ID, []string{f.member.Email}, "member")
		if err != nil || len(invs) != 1 {
			t.Fatalf("invite: %v", err)
		}
		if _, err := f.ws.AcceptInvite(f.ctx, f.member.ID, invs[0].Token, nil); err != nil {
			t.Fatalf("joining a workspace of one's own organization: %v", err)
		}
	})

	t.Run("required_action follows role and status", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		target, err := f.orgs.Create(f.ctx, f.other.ID, "Đích", "dich")
		if err != nil {
			t.Fatal(err)
		}
		cases := []struct {
			name      string
			who       db.User
			setup     func()
			action    string
			reason    string
			remaining int64
		}{
			{"admin leaves", f.admin, func() {}, "leave", "", 2},
			{"owner with members transfers", f.owner, func() {}, "transfer", "", 2},
			{"owner of a suspended organization is blocked", f.owner, func() { f.setStatus(t, f.org.ID, OrganizationSuspended) }, "blocked", "owner_of_suspended_organization", 2},
			{"sole owner closes", f.owner, func() {
				f.setStatus(t, f.org.ID, OrganizationActive)
				for _, id := range []string{f.admin.ID, f.member.ID} {
					if err := f.svc.Leave(f.ctx, id, f.org.ID); err != nil {
						t.Fatal(err)
					}
				}
			}, "close", "", 0},
		}
		for _, c := range cases {
			c.setup()
			token := f.inviteToOrg(t, target.ID, f.other.ID, c.who.Email)
			_, err := f.ws.AcceptInvite(f.ctx, c.who.ID, token, nil)
			fields := codedFields(t, err, "organization_switch_required")
			got := fields["conflicts"].([]MembershipConflict)
			if len(got) != 1 || got[0].RequiredAction != c.action || got[0].BlockedReason != c.reason || got[0].TransferCandidatesCount != c.remaining {
				t.Fatalf("%s: %+v", c.name, got)
			}
		}
	})
}

// Two tabs founding an organization at once: the per-account lock lets one
// through and the other sees it.
func TestCreateOrganizationTwiceAtOnceCreatesOne(t *testing.T) {
	f := newOrgMembersFixture(t)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = f.orgs.Create(f.ctx, f.other.ID, "Song song", fmt.Sprintf("song-song-%d", i))
		}(i)
	}
	wg.Wait()
	ok, refused := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrAlreadyInOrganization):
			refused++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if ok != 1 || refused != 1 {
		t.Fatalf("created %d, refused %d", ok, refused)
	}
	active, err := f.q.ListActiveOrganizationsForUser(f.ctx, f.other.ID)
	if err != nil || len(active) != 1 {
		t.Fatalf("active organizations: %v %d", err, len(active))
	}
}

// Leave checks the leaver's role under the row lock, so an ownership transfer
// to the leaver that lands first turns the leave into last_owner instead of
// deleting the new owner's row.
func TestLeaveRacingTransferNeverLeavesTheOrganizationOwnerless(t *testing.T) {
	f := newOrgMembersFixture(t)
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"members.max": null}'::jsonb WHERE organization_id = $1`, f.org.ID); err != nil {
		t.Fatal(err)
	}
	owner := f.owner
	for round := 0; round < 10; round++ {
		leaver := registerVerified(t, f.q, f.auth, fmt.Sprintf("race-%d@example.com", round), "Đua")
		if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
			OrganizationID: f.org.ID, UserID: leaver.ID, Role: OrgRoleMember,
		}); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		var transferErr, leaveErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, transferErr = f.svc.TransferOwnership(f.ctx, owner.ID, f.org.ID, leaver.ID, "password123")
		}()
		go func() {
			defer wg.Done()
			leaveErr = f.svc.Leave(f.ctx, leaver.ID, f.org.ID)
		}()
		wg.Wait()
		var owners int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM organization_members
			WHERE organization_id = $1 AND role = 'owner' AND deactivated_at IS NULL`, f.org.ID).Scan(&owners); err != nil {
			t.Fatal(err)
		}
		if owners != 1 {
			t.Fatalf("round %d: %d owners (transfer: %v, leave: %v)", round, owners, transferErr, leaveErr)
		}
		switch {
		case transferErr == nil && errors.Is(leaveErr, ErrLastOwner):
			owner = leaver // the transfer won; the next round starts from the new owner
		case leaveErr == nil && transferErr != nil:
		default:
			t.Fatalf("round %d: transfer %v, leave %v", round, transferErr, leaveErr)
		}
	}
}

// A person who moved on is not pulled back by a reactivation (ADR 0032).
func TestReactivateRefusesAMemberWhoJoinedAnotherOrganization(t *testing.T) {
	f := newOrgMembersFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.orgs.Create(f.ctx, f.member.ID, "Của tôi", "cua-toi"); err != nil {
		t.Fatal(err)
	}
	_, err := f.svc.Reactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID)
	fields := codedFields(t, err, "member_in_other_organization")
	if len(fields) != 0 {
		t.Fatalf("the refusal names the other organization: %+v", fields)
	}
	if m, err := f.svc.member(f.ctx, f.org.ID, f.member.ID); err != nil || !m.DeactivatedAt.Valid {
		t.Fatalf("membership after refusal: %v %+v", err, m)
	}
}

// D9: a member of a tenant they can no longer use may still leave it.
func TestMemberOfASuspendedOrganizationCanLeave(t *testing.T) {
	f := newOrgMembersFixture(t)
	f.setStatus(t, f.org.ID, OrganizationSuspended)
	if err := f.svc.Leave(f.ctx, f.member.ID, f.org.ID); err != nil {
		t.Fatalf("member leaving a suspended organization: %v", err)
	}
	if err := f.svc.Leave(f.ctx, f.owner.ID, f.org.ID); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("owner leaving a suspended organization: %v", err)
	}
	f.setStatus(t, f.org.ID, OrganizationActive)
	if _, err := f.pool.Exec(f.ctx, `UPDATE organizations SET deletion_scheduled_at = now() + interval '5 days' WHERE id = $1`, f.org.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Leave(f.ctx, f.admin.ID, f.org.ID); err != nil {
		t.Fatalf("admin leaving an organization waiting for deletion: %v", err)
	}
	if err := f.svc.Leave(f.ctx, f.other.ID, f.org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider leaving: %v", err)
	}
}

func TestADeactivatedMemberCannotLeave(t *testing.T) {
	f := newOrgMembersFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Leave(f.ctx, f.member.ID, f.org.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("deactivated member leaving: %v", err)
	}
}

func TestListOrganizationsHidesArchived(t *testing.T) {
	f := newOrgMembersFixture(t)
	f.setStatus(t, f.org.ID, "archived")
	list, err := f.orgs.ListForUser(f.ctx, f.member.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("archived organization listed: %v %+v", err, list)
	}
	f.setStatus(t, f.org.ID, OrganizationSuspended)
	if list, err := f.orgs.ListForUser(f.ctx, f.member.ID); err != nil || len(list) != 1 {
		t.Fatalf("suspended organization hidden: %v %+v", err, list)
	}
}

// Two invitations from two organizations accepted at once: the second waits on
// the account's lock and then finds the first organization in the way.
func TestTwoInvitationsAcceptedAtOnceJoinOne(t *testing.T) {
	f := newOrgMembersFixture(t)
	second, err := f.orgs.Create(f.ctx, f.other.ID, "Bên kia", "ben-kia")
	if err != nil {
		t.Fatal(err)
	}
	joiner := registerVerified(t, f.q, f.auth, "joiner@example.com", "Người mới")
	tokens := []string{
		f.inviteToOrg(t, f.org.ID, f.owner.ID, joiner.Email),
		f.inviteToOrg(t, second.ID, f.other.ID, joiner.Email),
	}
	var wg sync.WaitGroup
	errs := make([]error, len(tokens))
	for i, token := range tokens {
		wg.Add(1)
		go func(i int, token string) {
			defer wg.Done()
			_, errs[i] = f.ws.AcceptInvite(f.ctx, joiner.ID, token, nil)
		}(i, token)
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrOrganizationSwitchRequired):
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	active, err := f.q.ListActiveOrganizationsForUser(f.ctx, joiner.ID)
	if ok != 1 || err != nil || len(active) != 1 {
		t.Fatalf("joined %d, active %d (%v)", ok, len(active), err)
	}
}
