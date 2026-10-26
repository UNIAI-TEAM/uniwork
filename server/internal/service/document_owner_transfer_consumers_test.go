package service

// DOC-06 (UNI-2084) review r1 R1-2: the edit lock releaser and the office
// lease revoker re-check a holder's live ACL on the access-changing topics.
// An owner transfer demotes the previous owner without a share revoke, so the
// transfer's own topic has to reach both. Each event is the real outbox row
// the command wrote, handed to the consumer the way the dispatcher would.

import (
	"strings"
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

// bulkOwnerTransferPayload returns the outbox payload of the one
// document.owner_transferred row a bulk transfer wrote for documentID, and
// fails unless it carries the run's bulk_id.
func bulkOwnerTransferPayload(t *testing.T, f *docPermFixture, documentID, bulkID string) string {
	t.Helper()
	var payload string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT payload::text FROM outbox_events
		  WHERE topic = 'document.owner_transferred' AND payload::jsonb->>'document_id' = $1`,
		documentID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(payload, `"bulk_id":"`+bulkID+`"`) && !strings.Contains(payload, `"bulk_id": "`+bulkID+`"`) {
		t.Fatalf("outbox payload %s does not carry bulk_id %s", payload, bulkID)
	}
	return payload
}

// TestEditLockReleasedOnBulkOwnerTransfer (DOC-06b): the bulk route writes the
// same per-document document.owner_transferred row as the single route, plus a
// bulk_id the consumers must ignore. The previous owner of a restricted page
// is left with nothing, so the tenure ends.
func TestEditLockReleasedOnBulkOwnerTransfer(t *testing.T) {
	w := newLockWorld(t)
	d := w.restricted(t)
	held := w.acquire(t, w.tn.aclOwner, d.ID, "editor-prev")

	got, err := newMemberDocsService(w.env.f).TransferMemberDocuments(w.ctx, Human(w.tn.owner.ID), w.tn.orgID, w.tn.aclOwner.ID,
		MemberDocumentsTransferInput{ToUserID: w.tn.member.ID})
	if err != nil || got.Transferred != 1 {
		t.Fatalf("bulk transfer = %+v, %v, want 1 transferred", got, err)
	}
	w.wantLive(t, held.Lock.ID) // nothing happens before the event is delivered
	w.handle(t, "document.owner_transferred", w.tn.orgID, bulkOwnerTransferPayload(t, w.env.f, d.ID, got.BulkID))
	w.wantEnded(t, held.Lock.ID, "access_lost")
}

// TestOfficeLeaseRevokedOnBulkOwnerTransfer (DOC-06b): the lease revoker reads
// the per-document row of a bulk transfer, bulk_id and all, and revokes the
// previous owner's lease on a restricted file.
func TestOfficeLeaseRevokedOnBulkOwnerTransfer(t *testing.T) {
	w := newLeaseWorld(t, "lease-bulkownertransfer")
	d := w.file(t, documentVisibilityRestricted)
	prev := w.tn.aclOwner.ID
	lp := w.grant(t, prev, w.device(t, prev), d.ID)

	got, err := newMemberDocsService(w.f).TransferMemberDocuments(w.ctx, Human(w.tn.owner.ID), w.tn.orgID, prev,
		MemberDocumentsTransferInput{ToUserID: w.tn.member.ID})
	if err != nil || got.Transferred != 1 {
		t.Fatalf("bulk transfer = %+v, %v, want 1 transferred", got, err)
	}
	bulkOwnerTransferPayload(t, w.f, d.ID, got.BulkID)
	w.requireLive(t, lp.LeaseID) // nothing happens before the event is delivered
	w.deliver(t, "document.owner_transferred")
	w.requireRevoked(t, lp.LeaseID, OfficeLeaseRevokeShareRevoked)
}
