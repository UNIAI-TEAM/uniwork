package service

// DOC-06 (UNI-2084) review r1 R1-2: the edit lock releaser and the office
// lease revoker re-check a holder's live ACL on the access-changing topics.
// An owner transfer demotes the previous owner without a share revoke, so the
// transfer's own topic has to reach both. Each event is the real outbox row
// the command wrote, handed to the consumer the way the dispatcher would.

import (
	"testing"
)

// TestEditLockReleasedOnOwnerTransfer: the previous owner holds the lock;
// a transfer that leaves them view or nothing ends the tenure (access_lost),
// one that leaves them edit keeps it.
func TestEditLockReleasedOnOwnerTransfer(t *testing.T) {
	for _, tc := range []struct {
		level   string
		ended   bool
		comment string
	}{
		{"none", true, "no access left"},
		{"view", true, "read only"},
		{"edit", false, "still edits"},
	} {
		t.Run(tc.level+" ("+tc.comment+")", func(t *testing.T) {
			w := newLockWorld(t)
			d := w.restricted(t)
			held := w.acquire(t, w.tn.aclOwner, d.ID, "editor-prev")

			if _, err := w.svc.TransferOwner(w.ctx, Human(w.tn.aclOwner.ID), d.ID, DocumentOwnerTransferInput{
				UserID: w.tn.member.ID, PreviousOwnerLevel: tc.level,
			}); err != nil {
				t.Fatalf("transfer: %v", err)
			}
			w.wantLive(t, held.Lock.ID) // nothing happens before the event is delivered
			w.handle(t, "document.owner_transferred", w.tn.orgID, `{"document_id":"`+d.ID+`","workspace_id":"`+w.tn.wsA+`"}`)
			if tc.ended {
				w.wantEnded(t, held.Lock.ID, "access_lost")
			} else {
				w.wantLive(t, held.Lock.ID)
			}
		})
	}
}

// TestOfficeLeaseRevokedOnOwnerTransfer: the previous owner holds an offline
// lease; a transfer that leaves them nothing revokes it (reason share_revoked:
// the lease's closed reason set has no owner reason and the CHECK on the
// column would need a migration), one that leaves them a share keeps it.
func TestOfficeLeaseRevokedOnOwnerTransfer(t *testing.T) {
	for _, tc := range []struct {
		level   string
		revoked bool
	}{
		{"none", true},
		{"edit", false},
	} {
		t.Run(tc.level, func(t *testing.T) {
			w := newLeaseWorld(t, "lease-ownertransfer-"+tc.level)
			d := w.file(t, documentVisibilityRestricted)
			prev, next := w.tn.aclOwner.ID, w.tn.member.ID
			lp := w.grant(t, prev, w.device(t, prev), d.ID)

			if _, err := w.f.svc.TransferOwner(w.ctx, Human(prev), d.ID, DocumentOwnerTransferInput{
				UserID: next, PreviousOwnerLevel: tc.level,
			}); err != nil {
				t.Fatalf("transfer: %v", err)
			}
			w.requireLive(t, lp.LeaseID) // nothing happens before the event is delivered
			w.deliver(t, "document.owner_transferred")
			if tc.revoked {
				w.requireRevoked(t, lp.LeaseID, OfficeLeaseRevokeShareRevoked)
			} else {
				w.requireLive(t, lp.LeaseID)
			}
		})
	}
}
