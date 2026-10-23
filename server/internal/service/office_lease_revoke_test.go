package service

import (
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// G5-08s (UNI-1350): leases revoked by access changes (G5-D1 row 8, threat
// model T3-T5), the sweep (row 18) and the operator revoke. Each event is
// the real outbox row its command wrote, handed to OfficeLeaseRevoker the way
// the dispatcher would.

// T3: a share revoke takes the lease of whoever read through that share and
// leaves the others.
func TestOfficeLeaseRevokedOnShareRevoked(t *testing.T) {
	w := newLeaseWorld(t, "lease-sharerev")
	d := w.file(t, documentVisibilityWorkspace)
	b, m := w.tn.bMember.ID, w.tn.member.ID
	sh := w.f.share(t, d, DocumentPrincipalUser, b, DocumentLevelView, w.tn.aclOwner.ID)
	lb := w.grant(t, b, w.device(t, b), d.ID)
	lm := w.grant(t, m, w.device(t, m), d.ID)

	if err := w.f.svc.RevokeDocumentShare(w.ctx, Human(w.tn.aclOwner.ID), d.ID, sh.ID); err != nil {
		t.Fatal(err)
	}
	w.requireLive(t, lb.LeaseID) // nothing happens before the event is delivered
	w.deliver(t, "document.share_revoked")
	w.requireRevoked(t, lb.LeaseID, OfficeLeaseRevokeShareRevoked)
	w.requireLive(t, lm.LeaseID)
	// Delivered again: nothing more is written.
	w.deliver(t, "document.share_revoked")
	w.requireRevoked(t, lb.LeaseID, OfficeLeaseRevokeShareRevoked)
}

// T3: leaving a workspace revokes the leases granted there, except where the
// person still reads the document through a share.
func TestOfficeLeaseRevokedOnMemberRemoved(t *testing.T) {
	w := newLeaseWorld(t, "lease-removed")
	d1, d2 := w.file(t, documentVisibilityWorkspace), w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	w.f.share(t, d2, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)
	dev := w.device(t, m)
	l1, l2 := w.grant(t, m, dev, d1.ID), w.grant(t, m, dev, d2.ID)
	other := w.grant(t, w.tn.creator.ID, w.device(t, w.tn.creator.ID), d1.ID)

	if err := w.f.svc.ws.RemoveMember(w.ctx, w.tn.owner.ID, w.tn.wsA, m); err != nil {
		t.Fatal(err)
	}
	w.deliver(t, "member.removed")
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeMemberRemoved)
	w.requireLive(t, l2.LeaseID)
	w.requireLive(t, other.LeaseID)
}

// G508S-BE-2 (FIX-4): a document of workspace A shared to the workspace
// principal B reads for a member of B only, and its lease is stored under the
// document's workspace (A). A member.removed that enumerated only the removed
// workspace (B) therefore missed it and wrote no revoke; the enumeration is
// by organization now. A document the person still reads through their own
// share keeps its lease (the same re-check the grant's ACL uses).
func TestOfficeLeaseRevokedOnMemberRemovedAcrossWorkspaces(t *testing.T) {
	w := newLeaseWorld(t, "lease-removed-cross")
	b := w.tn.bMember.ID
	d1, d2 := w.file(t, documentVisibilityRestricted), w.file(t, documentVisibilityRestricted)
	w.f.share(t, d1, DocumentPrincipalWorkspace, w.tn.wsB, DocumentLevelView, w.tn.aclOwner.ID)
	w.f.share(t, d2, DocumentPrincipalUser, b, DocumentLevelView, w.tn.aclOwner.ID)
	dev := w.device(t, b)
	l1, l2 := w.grant(t, b, dev, d1.ID), w.grant(t, b, dev, d2.ID)
	if s := w.state(t, l1.LeaseID); !s.exists || s.revoked {
		t.Fatalf("the cross-workspace lease did not grant: %+v", s)
	}

	// The person is removed from workspace B, the workspace the share names;
	// the document lives in A.
	if err := w.f.svc.ws.RemoveMember(w.ctx, w.tn.owner.ID, w.tn.wsB, b); err != nil {
		t.Fatal(err)
	}
	w.deliver(t, "member.removed")
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeMemberRemoved)
	w.requireLive(t, l2.LeaseID)
}

// T4: a person deactivated in one organization keeps their sessions while
// they belong to another (F9), so the leases of the first die by the event,
// not with the session; the other organization's leases stay.
func TestOfficeLeaseRevokedOnMemberDeactivatedWithOtherOrg(t *testing.T) {
	w := newLeaseWorld(t, "lease-deact")
	m := w.tn.member.ID
	// An account owns one organization at most, so the other one is founded
	// by a person who has none yet; the member joins it as a plain member.
	owner2 := w.f.user(t, "lease-deact", "other-owner").ID
	org2, err := w.f.svc.orgs.Create(w.ctx, owner2, "Org lease-deact other", "lease-deact-other")
	if err != nil {
		t.Fatal(err)
	}
	ws2, err := w.f.svc.ws.CreateInOrg(w.ctx, owner2, org2.ID, "Other", "lease-deact-other-a")
	if err != nil {
		t.Fatal(err)
	}
	w.f.orgMember(t, org2.ID, m, OrgRoleMember)
	w.f.wsMember(t, ws2.ID, m, "member")
	d1 := w.file(t, documentVisibilityWorkspace)
	d2 := w.fileIn(t, org2.ID, ws2.ID, owner2, documentVisibilityWorkspace)
	dev := w.device(t, m)
	l1, l2 := w.grant(t, m, dev, d1.ID), w.grant(t, m, dev, d2.ID)

	members := NewOrganizationMemberService(w.f.pool, w.f.q, w.f.svc.orgs)
	if _, err := members.Deactivate(w.ctx, w.tn.owner.ID, w.tn.orgID, m); err != nil {
		t.Fatal(err)
	}
	device, err := w.f.q.GetDeviceSession(w.ctx, dev)
	if err != nil || device.RevokedAt.Valid {
		t.Fatalf("the device of a person still in another organization was revoked: %v %+v", err, device.RevokedAt)
	}
	w.deliver(t, "member.deactivated")
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeMemberDeactivated)
	w.requireLive(t, l2.LeaseID)
	_, err = w.put(w.leases, m, dev, d1.ID, l1.Token)
	requireLeaseCode(t, err, "member_deactivated")
	if _, err := w.put(w.leases, m, dev, d2.ID, l2.Token); err != nil {
		t.Fatalf("renewal in the other organization: %v", err)
	}
}

// T5: suspending the organization bumps its policy epoch in the same
// transaction. While suspended the gate refuses; once unsuspended, a lease
// from before still does not renew, even before the event revokes its row,
// and the app gets a fresh grant under the new epoch.
func TestOfficeLeaseEpochBumpOnSuspendRefusesRenew(t *testing.T) {
	w := newLeaseWorld(t, "lease-suspend")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	if l.PolicyEpoch != 0 {
		t.Fatalf("first lease epoch = %d", l.PolicyEpoch)
	}
	admin := NewAdminService(w.f.pool, w.f.q, nil, nil)
	operator := w.f.user(t, "lease-suspend", "operator").ID

	if _, err := admin.SetOrganizationStatus(w.ctx, operator, w.tn.orgID, OrganizationSuspended, "synthetic suspension for the lease test"); err != nil {
		t.Fatal(err)
	}
	_, err := w.put(w.leases, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "organization_suspended")
	if _, err := admin.SetOrganizationStatus(w.ctx, operator, w.tn.orgID, OrganizationActive, "synthetic unsuspension for the lease test"); err != nil {
		t.Fatal(err)
	}
	w.requireLive(t, l.LeaseID)
	_, err = w.put(w.leases, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "offline_lease_revoked")

	w.deliver(t, "organization.suspended")
	w.requireRevoked(t, l.LeaseID, OfficeLeaseRevokePolicyEpoch)
	fresh := w.grant(t, m, dev, d.ID)
	if fresh.LeaseID == l.LeaseID || fresh.PolicyEpoch != 1 || fresh.Renewed {
		t.Fatalf("grant after the bump = %+v, want a new row at epoch 1", fresh)
	}
}

// A moved document is re-checked like a share revoke: whoever lost read
// access loses the lease.
func TestOfficeLeaseRevokedOnDocumentMoved(t *testing.T) {
	w := newLeaseWorld(t, "lease-moved")
	d := w.file(t, documentVisibilityWorkspace)
	m, owner := w.tn.member.ID, w.tn.aclOwner.ID
	lm := w.grant(t, m, w.device(t, m), d.ID)
	lo := w.grant(t, owner, w.device(t, owner), d.ID)
	// The move put the file where only its ACL owner reads it.
	if _, err := w.f.pool.Exec(w.ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, d.ID); err != nil {
		t.Fatal(err)
	}
	w.handle(t, "document.moved", `{"document_id":"`+d.ID+`","workspace_id":"`+d.WorkspaceID+`"}`)
	w.requireRevoked(t, lm.LeaseID, OfficeLeaseRevokeDocumentMoved)
	w.requireLive(t, lo.LeaseID)
}

// A deleted document's leases all go, whoever holds them.
func TestOfficeLeaseRevokedOnDocumentDeleted(t *testing.T) {
	w := newLeaseWorld(t, "lease-deleted")
	d, keep := w.file(t, documentVisibilityWorkspace), w.file(t, documentVisibilityWorkspace)
	m, owner := w.tn.member.ID, w.tn.aclOwner.ID
	lm := w.grant(t, m, w.device(t, m), d.ID)
	lo := w.grant(t, owner, w.device(t, owner), d.ID)
	lk := w.grant(t, m, w.device(t, m), keep.ID)
	// The purge's event, as documents.purge writes it.
	w.handle(t, "document.deleted", `{"document_id":"`+d.ID+`","workspace_id":"`+d.WorkspaceID+`"}`)
	w.requireRevoked(t, lm.LeaseID, OfficeLeaseRevokeDocumentDeleted)
	w.requireRevoked(t, lo.LeaseID, OfficeLeaseRevokeDocumentDeleted)
	w.requireLive(t, lk.LeaseID)
}

// handle delivers one event built by hand for a command whose own path the
// test does not run (a move, a purge); the payload is the command's.
func (w *leaseWorld) handle(t *testing.T, topic, payload string) {
	t.Helper()
	if err := w.revoker.Handle(w.ctx, outbox.Row{
		ID: util.NewID(), Topic: topic, Payload: payload,
		OrganizationID: pgtype.Text{String: w.tn.orgID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
}

// Row 18: the sweep deletes rows expired or revoked more than 7 days ago and
// nothing younger.
func TestOfficeLeaseSweepDeletesDeadRows(t *testing.T) {
	w := newLeaseWorld(t, "lease-sweep")
	m := w.tn.member.ID
	now := time.Now()
	fixedLeaseClock(w.leases, now.Add(-10*24*time.Hour))
	oldExpired := w.grant(t, m, w.device(t, m), w.file(t, documentVisibilityWorkspace).ID)
	fixedLeaseClock(w.leases, now.Add(-2*24*time.Hour))
	recentExpired := w.grant(t, m, w.device(t, m), w.file(t, documentVisibilityWorkspace).ID)
	fixedLeaseClock(w.leases, now)
	live := w.grant(t, m, w.device(t, m), w.file(t, documentVisibilityWorkspace).ID)
	oldRevoked := w.grant(t, m, w.device(t, m), w.file(t, documentVisibilityWorkspace).ID)
	if _, err := w.f.pool.Exec(w.ctx, `UPDATE office_offline_leases SET revoked_at = now() - interval '8 days', revoke_reason = 'admin' WHERE id = $1`, oldRevoked.LeaseID); err != nil {
		t.Fatal(err)
	}

	sweeper := w.leases.NewSweeper(nil)
	sweeper.SetClock(func() time.Time { return now })
	n, err := sweeper.Sweep(w.ctx)
	if err != nil || n != 2 {
		t.Fatalf("sweep = %d, %v; want 2", n, err)
	}
	for _, gone := range []string{oldExpired.LeaseID, oldRevoked.LeaseID} {
		if w.state(t, gone).exists {
			t.Fatalf("dead lease %s survived the sweep", gone)
		}
	}
	for _, kept := range []string{recentExpired.LeaseID, live.LeaseID} {
		if !w.state(t, kept).exists {
			t.Fatalf("lease %s inside retention was swept", kept)
		}
	}
}

// The operator's org-wide revoke (uniwork-admin revoke-offline-leases) bumps
// the epoch and revokes every live lease of that organization only.
func TestAdminRevokesOrganizationOfflineLeases(t *testing.T) {
	w := newLeaseWorld(t, "lease-admin")
	other := w.f.tenant(t, "lease-admin-b")
	m := w.tn.member.ID
	d := w.file(t, documentVisibilityWorkspace)
	l1 := w.grant(t, m, w.device(t, m), d.ID)
	l2 := w.grant(t, w.tn.creator.ID, w.device(t, w.tn.creator.ID), d.ID)
	od := w.fileIn(t, other.orgID, other.wsA, other.aclOwner.ID, documentVisibilityWorkspace)
	lo := w.grant(t, other.member.ID, w.device(t, other.member.ID), od.ID)
	admin := NewAdminService(w.f.pool, w.f.q, nil, nil)

	if _, err := admin.RevokeOrganizationOfflineLeases(w.ctx, CLIActor, w.tn.orgID, "short"); err == nil {
		t.Fatal("a reason under 10 characters was accepted")
	}
	if _, err := admin.RevokeOrganizationOfflineLeases(w.ctx, CLIActor, util.NewID(), "synthetic operator revoke"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown organization = %v, want not found", err)
	}
	got, err := admin.RevokeOrganizationOfflineLeases(w.ctx, CLIActor, w.tn.orgID, "synthetic operator revoke")
	if err != nil {
		t.Fatal(err)
	}
	if got.Revoked != 2 || got.Epoch != 1 || got.OrganizationID != w.tn.orgID {
		t.Fatalf("revoke = %+v, want 2 leases at epoch 1", got)
	}
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeAdmin)
	w.requireRevoked(t, l2.LeaseID, OfficeLeaseRevokeAdmin)
	w.requireLive(t, lo.LeaseID)
	var actions int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM admin_actions WHERE target_id = $1 AND action = 'office.offline_policy_bumped'`, w.tn.orgID).Scan(&actions); err != nil {
		t.Fatal(err)
	}
	if actions != 1 {
		t.Fatalf("admin_actions rows = %d, want 1", actions)
	}
}
