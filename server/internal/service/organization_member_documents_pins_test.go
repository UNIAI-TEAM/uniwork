package service

// DOC-06b (UNI-2092) review r1: tests that pin what the bulk transfer decided
// and what a plausible "simplification" would break. BE-R1-2 holds has_more as
// an EXISTS past the batch, never "the page was full" (R1-10); BE-R1-4 holds
// the decisions the lane accepted (shelved and archived documents move, an
// organization admin recipient needs no workspace row).

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func lowerTransferBatch(t *testing.T, n int32) {
	t.Helper()
	prev := memberDocumentsTransferBatch
	memberDocumentsTransferBatch = n
	t.Cleanup(func() { memberDocumentsTransferBatch = prev })
}

// TestMemberDocumentsTransferHasMoreIsAnExistsNotAFullPage: batch of two over
// exactly four movable documents. Call 1 lists {d0, d1}, something is left
// after d1, so has_more and cursor d1. Call 2 lists {d2, d3}: a FULL page, but
// nothing of the source's is left after d3, so has_more is false and the
// cursor empty, and the loop ends in two calls. A has_more read off the page
// size (len(batch) == page) returns true with cursor d3 on call 2 and needs a
// third, empty call.
func TestMemberDocumentsTransferHasMoreIsAnExistsNotAFullPage(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt11")
	svc := newMemberDocsService(f)
	lowerTransferBatch(t, 2)
	src := tn.aclOwner.ID
	ids := ascendingIDs(4)
	for _, id := range ids {
		f.ownedDoc(t, tn, id, tn.wsA, src, "workspace", nil)
	}

	first, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if first.Transferred != 2 || !first.HasMore || first.Cursor != ids[1] {
		t.Fatalf("call 1 = %+v, want 2 transferred, has_more, cursor %s", first, ids[1])
	}
	second, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{
		ToUserID: tn.member.ID, BulkID: first.BulkID, Cursor: first.Cursor,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Transferred != 2 || second.HasMore || second.Cursor != "" {
		t.Fatalf("call 2 = %+v, want 2 transferred, has_more false, cursor empty (a full page is not has_more)", second)
	}
	for _, id := range ids {
		if owner := aclOwner(t, f, id); owner != tn.member.ID {
			t.Fatalf("%s owner = %q, want the recipient", id, owner)
		}
	}
}

// TestMemberDocumentsTransferFullPageFollowedByAnotherOwnersRows: the batch is
// full ({d0, d1}) and rows with greater ids exist, but they belong to someone
// else, so nothing of the source's is left: has_more false in one call. A page
// size rule says true.
func TestMemberDocumentsTransferFullPageFollowedByAnotherOwnersRows(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt12")
	svc := newMemberDocsService(f)
	lowerTransferBatch(t, 2)
	src := tn.aclOwner.ID
	ids := ascendingIDs(4)
	f.ownedDoc(t, tn, ids[0], tn.wsA, src, "workspace", nil)
	f.ownedDoc(t, tn, ids[1], tn.wsA, src, "workspace", nil)
	f.ownedDoc(t, tn, ids[2], tn.wsA, tn.creator.ID, "workspace", nil)
	f.ownedDoc(t, tn, ids[3], tn.wsA, tn.creator.ID, "workspace", nil)

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 2 || got.HasMore || got.Cursor != "" {
		t.Fatalf("result = %+v, want 2 transferred and done (the rows after belong to another owner)", got)
	}
	for _, id := range ids[2:] {
		if owner := aclOwner(t, f, id); owner != tn.creator.ID {
			t.Fatalf("%s owner = %q, want the other owner kept", id, owner)
		}
	}
}

// TestMemberDocumentsTransferMovesShelvedAndArchived pins two accepted
// decisions: a shelved document moves (the single route refuses it with
// document_shelved, the bulk route is metadata only and does not), and so does
// an archived one not yet purged, so a successor can restore it.
func TestMemberDocumentsTransferMovesShelvedAndArchived(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt13")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	now := time.Now().UTC()
	shelved := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", map[string]any{
		"shelved_at": now, "shelved_by": src, "shelved_by_kind": "human", "shelve_batch_id": util.NewID(),
	})
	archived := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "restricted", map[string]any{
		"archived_at": now, "archived_by": src, "purge_after": now.Add(30 * 24 * time.Hour),
	})

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 2 || got.SkippedRecipientNotMember != 0 || got.SkippedSelfRestricted != 0 {
		t.Fatalf("result = %+v, want the shelved and the archived document both moved", got)
	}
	for name, id := range map[string]string{"shelved": shelved.ID, "archived": archived.ID} {
		if owner := aclOwner(t, f, id); owner != tn.member.ID {
			t.Fatalf("%s document owner = %q, want the recipient", name, owner)
		}
		if a := ownerTransferAudits(t, f, id); len(a) != 1 {
			t.Fatalf("%s document audit rows = %d, want 1", name, len(a))
		}
	}
	if after := reloadDoc(t, f, shelved.ID); !after.ShelvedAt.Valid {
		t.Fatal("the transfer must not unshelve the document")
	}
	if after := reloadDoc(t, f, archived.ID); !after.ArchivedAt.Valid {
		t.Fatal("the transfer must not restore the archived document")
	}
}

// TestMemberDocumentsTransferToAnOrganizationAdminWithoutAWorkspaceRow: an
// organization owner or admin is an implicit admin of every workspace
// (RequireMemberQ), so a recipient who is one is not recipient_not_member
// where they hold no explicit workspace row. tn.orgAdmin has none.
func TestMemberDocumentsTransferToAnOrganizationAdminWithoutAWorkspaceRow(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mdt14")
	svc := newMemberDocsService(f)
	src := tn.aclOwner.ID
	var rows int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM workspace_members WHERE user_id = $1`, tn.orgAdmin.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Fatalf("the fixture's organization admin has %d workspace rows, want none", rows)
	}
	a := f.ownedDoc(t, tn, util.NewID(), tn.wsA, src, "workspace", nil)
	b := f.ownedDoc(t, tn, util.NewID(), tn.wsB, src, "workspace", nil)

	got, err := svc.TransferMemberDocuments(f.ctx, Human(tn.owner.ID), tn.orgID, src, MemberDocumentsTransferInput{ToUserID: tn.orgAdmin.ID})
	if err != nil {
		t.Fatal(err)
	}
	if got.Transferred != 2 || got.SkippedRecipientNotMember != 0 || got.SkippedSelfRestricted != 0 {
		t.Fatalf("result = %+v, want both documents moved to the organization admin", got)
	}
	for _, id := range []string{a.ID, b.ID} {
		if owner := aclOwner(t, f, id); owner != tn.orgAdmin.ID {
			t.Fatalf("%s owner = %q, want the organization admin", id, owner)
		}
	}
}
