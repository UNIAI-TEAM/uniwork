package service

import (
	"errors"
	"sync"
	"testing"
)

// FIX-1 (G508S-BE-1, threat model T3/T4, G5-D1 row 8, leader bridge-86): a
// member.removed, a member.deactivated or a member.left that commits between
// a grant's or renewal's ACL read and its commit is invisible to the outbox
// consumer, which runs after the removal committed and cannot see the lease
// row that had not committed yet. The lease would then stay live to the next
// renewal (<= 24 h), an online device never told to lock. Put re-runs the
// membership gate after its commit and revokes the row it just wrote when the
// gate now refuses, so both orderings end with no live lease: the removal
// either commits before the re-check (the re-check refuses and revokes) or
// after the lease commit (the consumer's enumeration sees the row and
// revokes it).
//
// A membership removal takes no document lock, which is why it - and not a
// share revoke, a move or a delete - can land inside the window: those take
// LockDocumentByID FOR UPDATE (document_permissions.go:414,
// document_tree.go:100, document_lifecycle.go) and wait for the lease
// transaction's FOR SHARE (office_offline_leases.sql:160). The seam below
// holds Put between its ACL read and its commit so a test can drive the
// removal into exactly that window.

// holdLeasePutForTheTest releases when Put has reached the seam, and holds
// every Put there until the returned release is called (or the test ends).
func holdLeasePutForTheTest(t *testing.T) (reached <-chan struct{}, release func()) {
	t.Helper()
	at, done := make(chan struct{}), make(chan struct{})
	var atOnce, doneOnce sync.Once
	release = func() { doneOnce.Do(func() { close(done) }) }
	officeLeasePutHold = func() {
		atOnce.Do(func() { close(at) })
		<-done
	}
	t.Cleanup(func() {
		officeLeasePutHold = nil
		release()
	})
	return at, release
}

type leasePutAnswer struct {
	lease OfficeLease
	err   error
}

func (w *leaseWorld) putAsync(userID, device, documentID, lease string) <-chan leasePutAnswer {
	done := make(chan leasePutAnswer, 1)
	go func() {
		l, err := w.put(w.leases, userID, device, documentID, lease)
		done <- leasePutAnswer{lease: l, err: err}
	}()
	return done
}

// leaseIDFor is the one lease row of a person on a document, whatever the
// request answered.
func (w *leaseWorld) leaseIDFor(t *testing.T, userID, documentID string) string {
	t.Helper()
	var id string
	if err := w.f.pool.QueryRow(w.ctx,
		`SELECT id FROM office_offline_leases WHERE user_id = $1 AND document_id = $2`, userID, documentID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// requireNoLiveLease is the heart of FIX-1: after both the removal and the
// grant committed, nothing of that person's may stay readable.
func (w *leaseWorld) requireNoLiveLease(t *testing.T, userID, documentID string) {
	t.Helper()
	var live int
	if err := w.f.pool.QueryRow(w.ctx,
		`SELECT count(*) FROM office_offline_leases WHERE user_id = $1 AND document_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
		userID, documentID).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 0 {
		t.Fatalf("%d live leases for %s on %s, want none", live, userID, documentID)
	}
}

// A grant racing a removal from the workspace: the removal commits inside the
// window, so the consumer (if it ran at all) enumerated before the lease row
// existed. The post-commit re-check refuses and revokes.
func TestOfficeLeaseGrantRacingMemberRemovedLeavesNoLease(t *testing.T) {
	w := newLeaseWorld(t, "lease-race-grant")
	d := w.file(t, documentVisibilityWorkspace)
	m, dev := w.tn.member.ID, w.device(t, w.tn.member.ID)
	held, release := holdLeasePutForTheTest(t)

	answer := w.putAsync(m, dev, d.ID, "")
	<-held
	if err := w.f.svc.ws.RemoveMember(w.ctx, w.tn.owner.ID, w.tn.wsA, m); err != nil {
		t.Fatal(err)
	}
	release()

	got := <-answer
	if !errors.Is(got.err, ErrNotFound) {
		t.Fatalf("grant racing the removal = %v, want the gate's not-found", got.err)
	}
	if got.lease.LeaseID != "" {
		t.Fatalf("a refused grant returned a lease: %+v", got.lease)
	}
	w.requireNoLiveLease(t, m, d.ID)
	w.requireRevoked(t, w.leaseIDFor(t, m, d.ID), OfficeLeaseRevokeMemberRemoved)
}

// The renewal twin: the row exists and the renewal rewrites it in place, so
// the re-check must revoke the row the renewal just committed.
func TestOfficeLeaseRenewalRacingMemberRemovedLeavesNoLease(t *testing.T) {
	w := newLeaseWorld(t, "lease-race-renew")
	d := w.file(t, documentVisibilityWorkspace)
	m, dev := w.tn.member.ID, w.device(t, w.tn.member.ID)
	l := w.grant(t, m, dev, d.ID)
	held, release := holdLeasePutForTheTest(t)

	answer := w.putAsync(m, dev, d.ID, l.Token)
	<-held
	if err := w.f.svc.ws.RemoveMember(w.ctx, w.tn.owner.ID, w.tn.wsA, m); err != nil {
		t.Fatal(err)
	}
	release()

	got := <-answer
	if !errors.Is(got.err, ErrNotFound) {
		t.Fatalf("renewal racing the removal = %v, want the gate's not-found", got.err)
	}
	w.requireNoLiveLease(t, m, d.ID)
	w.requireRevoked(t, l.LeaseID, OfficeLeaseRevokeMemberRemoved)
}

// bridge-86: LeaveOrganization (member.left) runs the same removal through
// the same gate and the same revoke path, so the re-check covers it; this is
// the leave twin of the grant case.
func TestOfficeLeaseGrantRacingLeaveLeavesNoLease(t *testing.T) {
	w := newLeaseWorld(t, "lease-race-leave")
	d := w.file(t, documentVisibilityWorkspace)
	m, dev := w.tn.member.ID, w.device(t, w.tn.member.ID)
	held, release := holdLeasePutForTheTest(t)

	answer := w.putAsync(m, dev, d.ID, "")
	<-held
	members := NewOrganizationMemberService(w.f.pool, w.f.q, w.f.svc.orgs)
	if err := members.Leave(w.ctx, m, w.tn.orgID); err != nil {
		t.Fatal(err)
	}
	release()

	got := <-answer
	if !errors.Is(got.err, ErrNotFound) {
		t.Fatalf("grant racing the leave = %v, want the gate's not-found", got.err)
	}
	w.requireNoLiveLease(t, m, d.ID)
	// A plain non-member answers member_removed, the consumer's member.left
	// branch reason (office_lease_consumer.go).
	w.requireRevoked(t, w.leaseIDFor(t, m, d.ID), OfficeLeaseRevokeMemberRemoved)
}

// A deactivation is the other refusal the re-check must tell apart: the answer
// is the gate's own member_deactivated and the revoke carries that reason.
// The person also belongs to another organization, so Deactivate does not
// revoke their device sessions (F9) and the grant's device lock is not held
// against it.
func TestOfficeLeaseGrantRacingDeactivationLeavesNoLease(t *testing.T) {
	w := newLeaseWorld(t, "lease-race-deact")
	m := w.tn.member.ID
	other, err := w.f.svc.orgs.Create(w.ctx, w.tn.owner.ID, "Org lease-race-deact other", "lease-race-deact-other")
	if err != nil {
		t.Fatal(err)
	}
	w.f.orgMember(t, other.ID, m, OrgRoleMember)
	d := w.file(t, documentVisibilityWorkspace)
	dev := w.device(t, m)
	held, release := holdLeasePutForTheTest(t)

	answer := w.putAsync(m, dev, d.ID, "")
	<-held
	members := NewOrganizationMemberService(w.f.pool, w.f.q, w.f.svc.orgs)
	if _, err := members.Deactivate(w.ctx, w.tn.owner.ID, w.tn.orgID, m); err != nil {
		t.Fatal(err)
	}
	release()

	got := <-answer
	if !codedIs(got.err, "member_deactivated") {
		t.Fatalf("grant racing the deactivation = %v, want member_deactivated", got.err)
	}
	w.requireNoLiveLease(t, m, d.ID)
	w.requireRevoked(t, w.leaseIDFor(t, m, d.ID), OfficeLeaseRevokeMemberDeactivated)
	// The gate stays closed: a fresh request answers the same refusal the
	// re-check used, and the other organization's membership changes nothing.
	if _, err := w.put(w.leases, m, dev, d.ID, ""); !codedIs(err, "member_deactivated") {
		t.Fatalf("a put after the deactivation = %v, want member_deactivated", err)
	}
}
