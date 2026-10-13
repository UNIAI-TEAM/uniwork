package service

import (
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// switchTarget is an organization founded by someone outside the fixture's
// organization, with one invitation for email waiting in it. It is the "B"
// of spec §4.4: the organization the person wants to move to.
func (f *orgMembersFixture) switchTarget(t *testing.T, slug, email string) (db.Organization, db.User, string) {
	t.Helper()
	founder := registerVerified(t, f.q, f.auth, slug+"-founder@example.com", "Founder "+slug)
	o, err := f.orgs.Create(f.ctx, founder.ID, "Tổ chức "+slug, slug)
	if err != nil {
		t.Fatal(err)
	}
	return o, founder, f.inviteToOrg(t, o.ID, founder.ID, email)
}

// activeOrgIDs is the organizations the account counts as belonging to (D1).
func (f *orgMembersFixture) activeOrgIDs(t *testing.T, userID string) []string {
	t.Helper()
	rows, err := f.q.ListActiveOrganizationsForUser(f.ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}

func (f *orgMembersFixture) memberLeftRows(t *testing.T, userID string) int {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM audit_events WHERE action = 'member.left' AND resource_id = $1`, userID)
}

// soleOwner leaves the fixture's owner alone in the organization, the shape
// whose conflict asks for a close.
func (f *orgMembersFixture) soleOwner(t *testing.T) {
	t.Helper()
	for _, id := range []string{f.admin.ID, f.member.ID} {
		if err := f.svc.Leave(f.ctx, id, f.org.ID); err != nil {
			t.Fatal(err)
		}
	}
}

func switchConflicts(t *testing.T, err error) []MembershipConflict {
	t.Helper()
	fields := codedFields(t, err, "organization_switch_required")
	got, ok := fields["conflicts"].([]MembershipConflict)
	if !ok {
		t.Fatalf("conflicts missing: %+v", fields)
	}
	return got
}

// TestInvitationPreview is spec §4.3: the invitee sees the invitation in any
// state, and what their current organizations need only while it is pending.
func TestInvitationPreview(t *testing.T) {
	t.Run("a pending invitation for somebody with no organization", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		joiner := registerVerified(t, f.q, f.auth, "joiner@example.com", "Người mới")
		token := f.inviteToOrg(t, f.org.ID, f.owner.ID, joiner.Email)
		p, err := f.ws.PreviewInvitation(f.ctx, joiner.ID, token)
		if err != nil {
			t.Fatal(err)
		}
		if p.Status != InvitationPending || p.Organization.ID != f.org.ID || p.Organization.Slug != "unicom" ||
			p.Organization.Name != "Unicom" || p.OrgRole != OrgRoleMember || p.InviterName != "Owner" ||
			p.Workspace != nil || p.ID == "" || !p.ExpiresAt.After(time.Now()) {
			t.Fatalf("preview: %+v", p)
		}
		if p.Conflicts == nil || len(p.Conflicts) != 0 {
			t.Fatalf("conflicts: %+v", p.Conflicts)
		}
	})

	t.Run("a workspace invitation names the workspace", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, "Đội", "doi")
		if err != nil {
			t.Fatal(err)
		}
		invs, _, err := f.ws.InviteMany(f.ctx, f.owner.ID, v.Workspace.ID, []string{f.member.Email}, "member")
		if err != nil || len(invs) != 1 {
			t.Fatalf("invite: %v", err)
		}
		p, err := f.ws.PreviewInvitation(f.ctx, f.member.ID, invs[0].Token)
		if err != nil {
			t.Fatal(err)
		}
		if p.Workspace == nil || p.Workspace.ID != v.Workspace.ID || p.Workspace.Slug != "doi" || p.Workspace.Name != "Đội" {
			t.Fatalf("workspace: %+v", p.Workspace)
		}
		// Already in the organization that invites: nothing stands in the way.
		if len(p.Conflicts) != 0 {
			t.Fatalf("own organization in conflict: %+v", p.Conflicts)
		}
	})

	t.Run("each required action", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		target, founder, _ := f.switchTarget(t, "dich", "nobody@example.com")
		cases := []struct {
			name   string
			who    db.User
			setup  func()
			action string
			reason string
			others int64
		}{
			{"member leaves", f.member, func() {}, SwitchActionLeave, "", 2},
			{"admin leaves", f.admin, func() {}, SwitchActionLeave, "", 2},
			{"owner with members transfers", f.owner, func() {}, SwitchActionTransfer, "", 2},
			{"owner of a suspended organization is blocked", f.owner, func() { f.setStatus(t, f.org.ID, OrganizationSuspended) },
				SwitchActionBlocked, "owner_of_suspended_organization", 2},
			{"sole owner closes", f.owner, func() { f.setStatus(t, f.org.ID, OrganizationActive); f.soleOwner(t) }, SwitchActionClose, "", 0},
		}
		for _, c := range cases {
			c.setup()
			token := f.inviteToOrg(t, target.ID, founder.ID, c.who.Email)
			p, err := f.ws.PreviewInvitation(f.ctx, c.who.ID, token)
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
			if len(p.Conflicts) != 1 {
				t.Fatalf("%s: %+v", c.name, p.Conflicts)
			}
			got := p.Conflicts[0]
			if got.Organization.ID != f.org.ID || got.RequiredAction != c.action || got.BlockedReason != c.reason || got.TransferCandidatesCount != c.others {
				t.Fatalf("%s: %+v", c.name, got)
			}
		}
	})

	t.Run("expired, revoked and accepted carry no conflicts", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		target, founder, _ := f.switchTarget(t, "dich", "nobody@example.com")
		states := map[string]string{
			InvitationExpired:  `UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE token = $1`,
			InvitationRevoked:  `UPDATE invitations SET revoked_at = now() WHERE token = $1`,
			InvitationAccepted: `UPDATE invitations SET accepted_at = now() WHERE token = $1`,
		}
		for status, sql := range states {
			// A fresh invitation each time: InviteToOrg skips an address that
			// already has one pending.
			if _, err := f.pool.Exec(f.ctx, `UPDATE invitations SET revoked_at = now() WHERE email = $1 AND revoked_at IS NULL AND accepted_at IS NULL`, f.member.Email); err != nil {
				t.Fatal(err)
			}
			token := f.inviteToOrg(t, target.ID, founder.ID, f.member.Email)
			if _, err := f.pool.Exec(f.ctx, sql, token); err != nil {
				t.Fatal(err)
			}
			p, err := f.ws.PreviewInvitation(f.ctx, f.member.ID, token)
			if err != nil || p.Status != status || len(p.Conflicts) != 0 || p.Organization.ID != target.ID {
				t.Fatalf("%s: %v %+v", status, err, p)
			}
		}
	})

	t.Run("only the invited mailbox, once proven, may read it", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		_, _, token := f.switchTarget(t, "dich", f.member.Email)
		if _, err := f.ws.PreviewInvitation(f.ctx, f.admin.ID, token); !codedIs(err, "invitation_email_mismatch") {
			t.Fatalf("another account: %v", err)
		}
		if _, err := f.ws.PreviewInvitation(f.ctx, f.member.ID, "no-such-token"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown token: %v", err)
		}
		if _, err := f.pool.Exec(f.ctx, `UPDATE users SET email_verified_at = NULL WHERE id = $1`, f.member.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.ws.PreviewInvitation(f.ctx, f.member.ID, token); !errors.Is(err, ErrEmailUnverified) {
			t.Fatalf("unverified: %v", err)
		}
	})
}

// TestSwitchOrganizationByInvitation is spec §4.4: the old organization is
// dealt with and the new one joined in one transaction.
func TestSwitchOrganizationByInvitation(t *testing.T) {
	t.Run("a member leaves", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		target, _, token := f.switchTarget(t, "dich", f.member.Email)
		res, err := f.ws.AcceptInvite(f.ctx, f.member.ID, token, []SwitchResolution{
			{OrganizationID: f.org.ID, Action: SwitchActionLeave},
		})
		if err != nil || res.Organization.ID != target.ID {
			t.Fatalf("switch: %v %+v", err, res)
		}
		if got := f.activeOrgIDs(t, f.member.ID); len(got) != 1 || got[0] != target.ID {
			t.Fatalf("active organizations: %v", got)
		}
		var invitationID, switchedTo string
		if err := f.pool.QueryRow(f.ctx, `SELECT metadata::jsonb->>'invitation_id', metadata::jsonb->>'switched_to_organization_id'
			FROM audit_events WHERE action = 'member.left' AND resource_id = $1 AND organization_id = $2`, f.member.ID, f.org.ID).
			Scan(&invitationID, &switchedTo); err != nil {
			t.Fatal(err)
		}
		inv, err := f.q.GetInvitationByTokenAnyState(f.ctx, token)
		if err != nil || invitationID != inv.ID || switchedTo != target.ID {
			t.Fatalf("member.left metadata: %q %q (%v)", invitationID, switchedTo, err)
		}
	})

	t.Run("an owner transfers and leaves", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		target, _, token := f.switchTarget(t, "dich", f.owner.Email)
		resolve := []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionTransfer, TransferToUserID: f.admin.ID, Password: "wrong-password"}}
		if _, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, resolve); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("wrong password: %v", err)
		}
		resolve[0].Password = "password123"
		if _, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, resolve); err != nil {
			t.Fatalf("switch: %v", err)
		}
		if m, err := f.svc.member(f.ctx, f.org.ID, f.admin.ID); err != nil || m.Role != OrgRoleOwner {
			t.Fatalf("new owner: %v %+v", err, m)
		}
		if _, err := f.svc.member(f.ctx, f.org.ID, f.owner.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("old owner still in the organization: %v", err)
		}
		if got := f.activeOrgIDs(t, f.owner.ID); len(got) != 1 || got[0] != target.ID {
			t.Fatalf("active organizations: %v", got)
		}
	})

	t.Run("a sole owner closes", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		f.soleOwner(t)
		target, _, token := f.switchTarget(t, "dich", f.owner.Email)
		resolve := []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionClose, ConfirmSlug: "sai"}}
		if _, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, resolve); !codedIs(err, "close_confirm_mismatch") {
			t.Fatalf("wrong slug: %v", err)
		}
		if o, _ := f.q.GetOrganizationByID(f.ctx, f.org.ID); o.Status != OrganizationActive {
			t.Fatalf("refused switch closed the organization: %s", o.Status)
		}
		resolve[0].ConfirmSlug = "unicom"
		if _, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, resolve); err != nil {
			t.Fatalf("switch: %v", err)
		}
		o, _ := f.q.GetOrganizationByID(f.ctx, f.org.ID)
		if o.Status != "archived" || o.SuspendedReason.String != "organization_closed" {
			t.Fatalf("old organization: %s %q", o.Status, o.SuspendedReason.String)
		}
		var switchedTo string
		if err := f.pool.QueryRow(f.ctx, `SELECT metadata::jsonb->>'switched_to_organization_id' FROM audit_events
			WHERE action = 'organization.closed' AND resource_id = $1`, f.org.ID).Scan(&switchedTo); err != nil || switchedTo != target.ID {
			t.Fatalf("organization.closed metadata: %q (%v)", switchedTo, err)
		}
		if got := f.activeOrgIDs(t, f.owner.ID); len(got) != 1 || got[0] != target.ID {
			t.Fatalf("active organizations: %v", got)
		}
	})

	t.Run("a legacy account resolves every organization", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		// Before ADR 0032 one account could hold several organizations (D2).
		legacy := createLegacyOrganization(t, f.orgs, f.member.ID, "Cũ", "cu")
		target, _, token := f.switchTarget(t, "dich", f.member.Email)
		_, err := f.ws.AcceptInvite(f.ctx, f.member.ID, token, []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionLeave}})
		if got := switchConflicts(t, err); len(got) != 2 {
			t.Fatalf("conflicts: %+v", got)
		}
		if _, err := f.ws.AcceptInvite(f.ctx, f.member.ID, token, []SwitchResolution{
			{OrganizationID: legacy.ID, Action: SwitchActionClose, ConfirmSlug: "cu"},
			{OrganizationID: f.org.ID, Action: SwitchActionLeave},
		}); err != nil {
			t.Fatalf("switch: %v", err)
		}
		if got := f.activeOrgIDs(t, f.member.ID); len(got) != 1 || got[0] != target.ID {
			t.Fatalf("active organizations: %v", got)
		}
	})
}

// The invitation is checked under its row lock before anything is touched:
// one that expired or was revoked while the person was in the wizard leaves
// them exactly where they were (AC-10, AC-11).
func TestSwitchKeepsTheOldOrganizationWhenTheInvitationIsGone(t *testing.T) {
	cases := map[string]string{
		"invitation_expired": `UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE token = $1`,
		"invitation_revoked": `UPDATE invitations SET revoked_at = now() WHERE token = $1`,
	}
	for code, sql := range cases {
		t.Run(code, func(t *testing.T) {
			f := newOrgMembersFixture(t)
			_, _, token := f.switchTarget(t, "dich", f.member.Email)
			if _, err := f.pool.Exec(f.ctx, sql, token); err != nil {
				t.Fatal(err)
			}
			_, err := f.ws.AcceptInvite(f.ctx, f.member.ID, token, []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionLeave}})
			var ce CodedError
			if !errors.As(err, &ce) || ce.Code != code || ce.Status != 410 || !errors.Is(err, ErrInvitationGone) {
				t.Fatalf("accept: %v", err)
			}
			if got := f.activeOrgIDs(t, f.member.ID); len(got) != 1 || got[0] != f.org.ID {
				t.Fatalf("old membership touched: %v", got)
			}
			if n := f.memberLeftRows(t, f.member.ID); n != 0 {
				t.Fatalf("member.left written: %d", n)
			}
		})
	}
}

// resolve must name exactly the conflicts with exactly their action; anything
// else answers the fresh conflicts and changes nothing.
func TestSwitchResolveMustMatchTheConflicts(t *testing.T) {
	f := newOrgMembersFixture(t)
	other, otherFounder, token := f.switchTarget(t, "dich", f.owner.Email)
	stranger, _, _ := f.switchTarget(t, "la", "nobody@example.com")
	cases := map[string][]SwitchResolution{
		"nothing":        nil,
		"wrong action":   {{OrganizationID: f.org.ID, Action: SwitchActionLeave}},
		"unknown action": {{OrganizationID: f.org.ID, Action: "abandon"}},
		"twice": {
			{OrganizationID: f.org.ID, Action: SwitchActionTransfer, TransferToUserID: f.admin.ID, Password: "password123"},
			{OrganizationID: f.org.ID, Action: SwitchActionTransfer, TransferToUserID: f.admin.ID, Password: "password123"},
		},
		"another tenant's organization": {
			{OrganizationID: f.org.ID, Action: SwitchActionTransfer, TransferToUserID: f.admin.ID, Password: "password123"},
			{OrganizationID: stranger.ID, Action: SwitchActionLeave},
		},
		"a transfer to somebody outside the organization": {
			{OrganizationID: f.org.ID, Action: SwitchActionTransfer, TransferToUserID: f.other.ID, Password: "password123"},
		},
	}
	for name, resolve := range cases {
		_, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, resolve)
		got := switchConflicts(t, err)
		if len(got) != 1 || got[0].Organization.ID != f.org.ID || got[0].RequiredAction != SwitchActionTransfer {
			t.Fatalf("%s: %+v", name, got)
		}
	}
	if got := f.activeOrgIDs(t, f.owner.ID); len(got) != 1 || got[0] != f.org.ID {
		t.Fatalf("a refused switch moved the owner: %v", got)
	}
	if m, _ := f.svc.member(f.ctx, f.org.ID, f.owner.ID); m.Role != OrgRoleOwner {
		t.Fatalf("a refused switch changed the owner's role: %s", m.Role)
	}
	if got := f.activeOrgIDs(t, f.other.ID); len(got) != 0 {
		t.Fatalf("an outsider was touched: %v", got)
	}
	if _, err := f.svc.member(f.ctx, stranger.ID, f.owner.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("joined the stranger: %v", err)
	}

	t.Run("blocked cannot be resolved", func(t *testing.T) {
		f.setStatus(t, f.org.ID, OrganizationSuspended)
		defer f.setStatus(t, f.org.ID, OrganizationActive)
		for _, action := range []string{SwitchActionTransfer, SwitchActionLeave, SwitchActionClose, SwitchActionBlocked} {
			_, err := f.ws.AcceptInvite(f.ctx, f.owner.ID, token, []SwitchResolution{
				{OrganizationID: f.org.ID, Action: action, TransferToUserID: f.admin.ID, Password: "password123", ConfirmSlug: "unicom"},
			})
			if got := switchConflicts(t, err); len(got) != 1 || got[0].RequiredAction != SwitchActionBlocked {
				t.Fatalf("%s: %+v", action, got)
			}
		}
	})

	t.Run("a resolve with nothing to resolve is stale", func(t *testing.T) {
		joiner := registerVerified(t, f.q, f.auth, "joiner@example.com", "Người mới")
		token := f.inviteToOrg(t, other.ID, otherFounder.ID, joiner.Email)
		_, err := f.ws.AcceptInvite(f.ctx, joiner.ID, token, []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionLeave}})
		if got := switchConflicts(t, err); len(got) != 0 {
			t.Fatalf("conflicts: %+v", got)
		}
	})
}

// EC-12: a retry after a lost response answers what the first call did.
func TestAcceptInvitationRetryIsIdempotent(t *testing.T) {
	f := newOrgMembersFixture(t)
	v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.org.ID, "Đội", "doi")
	if err != nil {
		t.Fatal(err)
	}
	joiner := registerVerified(t, f.q, f.auth, "joiner@example.com", "Người mới")
	invs, _, err := f.ws.InviteMany(f.ctx, f.owner.ID, v.Workspace.ID, []string{joiner.Email}, "member")
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite: %v", err)
	}
	first, err := f.ws.AcceptInvite(f.ctx, joiner.ID, invs[0].Token, nil)
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.ws.AcceptInvite(f.ctx, joiner.ID, invs[0].Token, nil)
	if err != nil || again.Organization.ID != first.Organization.ID || again.Workspace == nil || again.Workspace.ID != first.Workspace.ID {
		t.Fatalf("retry: %v %+v", err, again)
	}
	joined := f.count(t, `SELECT count(*) FROM audit_events WHERE action = 'member.joined' AND resource_id = $1`, joiner.ID)
	if joined != 1 {
		t.Fatalf("member.joined rows: %d", joined)
	}
	// Once they have left, the spent invitation is not a way back in.
	if err := f.svc.Leave(f.ctx, joiner.ID, f.org.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.ws.AcceptInvite(f.ctx, joiner.ID, invs[0].Token, nil)
	if !codedIs(err, "invitation_accepted") || !errors.Is(err, ErrInvitationGone) {
		t.Fatalf("accepted invitation after leaving: %v", err)
	}
}

// Two invitations switched to at once from the same organization: the second
// waits on the account's lock and finds the first one's organization in the
// way, which its resolve does not name (EC-07, AC-14).
func TestTwoSwitchesAtOnceJoinOne(t *testing.T) {
	f := newOrgMembersFixture(t)
	_, _, first := f.switchTarget(t, "mot", f.member.Email)
	_, _, second := f.switchTarget(t, "hai", f.member.Email)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, token := range []string{first, second} {
		wg.Add(1)
		go func(i int, token string) {
			defer wg.Done()
			_, errs[i] = f.ws.AcceptInvite(f.ctx, f.member.ID, token, []SwitchResolution{{OrganizationID: f.org.ID, Action: SwitchActionLeave}})
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
	if got := f.activeOrgIDs(t, f.member.ID); ok != 1 || len(got) != 1 || got[0] == f.org.ID {
		t.Fatalf("joined %d, active %v", ok, got)
	}
}

// Two owners moving into each other's organizations at once lock the same two
// organization rows; taken in id order they queue instead of deadlocking.
func TestOwnersSwappingOrganizationsDoNotDeadlock(t *testing.T) {
	for _, mode := range []string{SwitchActionTransfer, SwitchActionClose} {
		t.Run(mode, func(t *testing.T) {
			for round := 0; round < 3; round++ {
				t.Run(fmt.Sprintf("round %d", round), func(t *testing.T) {
					f := newOrgMembersFixture(t)
					x, y := f.owner, registerVerified(t, f.q, f.auth, fmt.Sprintf("y-%d@example.com", round), "Y")
					a := f.org
					b, err := f.orgs.Create(f.ctx, y.ID, "Bê", "be")
					if err != nil {
						t.Fatal(err)
					}
					heir := registerVerified(t, f.q, f.auth, fmt.Sprintf("heir-%d@example.com", round), "Heir")
					if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: b.ID, UserID: heir.ID, Role: OrgRoleMember}); err != nil {
						t.Fatal(err)
					}
					if mode == SwitchActionClose {
						f.soleOwner(t)
						if err := f.svc.Leave(f.ctx, heir.ID, b.ID); err != nil {
							t.Fatal(err)
						}
					}
					toB := f.inviteToOrg(t, b.ID, y.ID, x.Email)
					toA := f.inviteToOrg(t, a.ID, x.ID, y.Email)
					resolve := func(org db.Organization, heirID string) []SwitchResolution {
						if mode == SwitchActionClose {
							return []SwitchResolution{{OrganizationID: org.ID, Action: SwitchActionClose, ConfirmSlug: org.Slug}}
						}
						return []SwitchResolution{{OrganizationID: org.ID, Action: SwitchActionTransfer, TransferToUserID: heirID, Password: "password123"}}
					}
					// Holding both invitation rows parks each switch after it
					// has taken its organization rows and before it closes or
					// hands over anything, so the two always overlap.
					hold, err := f.pool.Begin(f.ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer hold.Rollback(f.ctx) //nolint:errcheck
					if _, err := hold.Exec(f.ctx, `SELECT 1 FROM invitations WHERE token IN ($1, $2) FOR UPDATE`, toA, toB); err != nil {
						t.Fatal(err)
					}
					errs := make([]error, 2)
					done := make(chan struct{})
					var wg sync.WaitGroup
					wg.Add(2)
					go func() { defer wg.Done(); _, errs[0] = f.ws.AcceptInvite(f.ctx, x.ID, toB, resolve(a, f.admin.ID)) }()
					go func() { defer wg.Done(); _, errs[1] = f.ws.AcceptInvite(f.ctx, y.ID, toA, resolve(b, heir.ID)) }()
					go func() { wg.Wait(); close(done) }()
					f.waitForRowLockWaiters(t, 2)
					if err := hold.Rollback(f.ctx); err != nil {
						t.Fatal(err)
					}
					select {
					case <-done:
					case <-time.After(30 * time.Second):
						t.Fatal("the two switches hung")
					}
					for i, err := range errs {
						// The second may find the other organization closed, its
						// invitation revoked with it. A deadlock Postgres had to
						// break would surface as membership_busy, and fails here.
						if err != nil && !errors.Is(err, ErrInvitationGone) {
							t.Fatalf("round %d switch %d: %v", round, i, err)
						}
					}
					for _, who := range []string{x.ID, y.ID} {
						if got := f.activeOrgIDs(t, who); len(got) != 1 {
							t.Fatalf("round %d: %s belongs to %v (errors %v)", round, who, got, errs)
						}
					}
					for _, org := range []string{a.ID, b.ID} {
						o, _ := f.q.GetOrganizationByID(f.ctx, org)
						owners := f.count(t, `SELECT count(*) FROM organization_members WHERE organization_id = $1 AND role = 'owner' AND deactivated_at IS NULL`, org)
						if o.Status == OrganizationActive && owners != 1 {
							t.Fatalf("round %d: active organization %s has %d owners (errors %v)", round, org, owners, errs)
						}
					}
					if mode == SwitchActionTransfer && (errs[0] != nil || errs[1] != nil) {
						t.Fatalf("round %d: transfers should both land: %v", round, errs)
					}
				})
			}
		})
	}
}
