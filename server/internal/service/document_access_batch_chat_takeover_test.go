package service

import (
	"context"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// accessBatchTakeoverFixture is a restricted document whose chat grants sit on
// live user shares: ub and uc hold comment from a chat room, ud held manual
// view that the chat raised to edit.
type accessBatchTakeoverFixture struct {
	*chatDocumentFixture
	docID  string
	room   db.ChatRoom
	uc, ud db.User
}

func newAccessBatchTakeoverFixture(t *testing.T, tag string) *accessBatchTakeoverFixture {
	t.Helper()
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.reconcileMember(t, "access-b4-c-"+tag+"@example.com", "C")
	ud := f.reconcileMember(t, "access-b4-d-"+tag+"@example.com", "D")
	room := f.reconcileGroup(t, "access-b4-"+tag, f.ub.ID, uc.ID, ud.ID)
	page, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{Title: "B4 access", Visibility: "restricted"})
	if err != nil {
		t.Fatal(err)
	}
	docID := page.Document.ID
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	msg := f.documentMessageIn(t, room, docID)
	chatGrant := func(level DocumentLevel, recipients ...string) {
		t.Helper()
		doc, err := f.q.GetDocumentByID(ctx, docID)
		if err != nil {
			t.Fatal(err)
		}
		if err := f.svc.grantDocumentToRoomMembers(ctx, f.q, Human(f.ua.ID),
			DocumentFileResult{Document: doc}, recipients, level, room.ID, msg.ID); err != nil {
			t.Fatalf("chat grant at %s: %v", level, err)
		}
	}
	chatGrant(DocumentLevelComment, f.ub.ID, uc.ID)
	chatGrant(DocumentLevelEdit, ud.ID)
	for _, id := range []string{f.ub.ID, uc.ID, ud.ID} {
		if sh, ok := f.liveShareOf(t, id, docID); !ok || sh.SourceKind.String != DocumentShareSourceKindChat {
			t.Fatalf("share of %s = %+v, want chat-origin", id, sh)
		}
	}
	return &accessBatchTakeoverFixture{chatDocumentFixture: f, docID: docID, room: room, uc: uc, ud: ud}
}

func (f *accessBatchTakeoverFixture) put(t *testing.T, dryRun bool, items ...DocumentAccessBatchItem) DocumentAccessBatchResult {
	t.Helper()
	res, err := f.docs.UpdateDocumentAccess(context.Background(), Human(f.ua.ID), f.docID,
		UpdateDocumentAccessInput{Items: items, DryRun: dryRun})
	if err != nil {
		t.Fatalf("UpdateDocumentAccess: %v", err)
	}
	return res
}

func (f *accessBatchTakeoverFixture) leaveRoom(t *testing.T, userIDs ...string) {
	t.Helper()
	revoker := NewChatDocumentShareRevoker(f.docs)
	for _, id := range userIDs {
		if err := f.svc.RemoveChatRoomMember(context.Background(), f.ua.ID, f.ws.ID, f.room.ID, id); err != nil {
			t.Fatal(err)
		}
		deliver(t, revoker, f.orgID, "chat.room.member_removed", map[string]string{"room_id": f.room.ID, "user_id": id})
	}
}

func userAccessItem(userID string, level DocumentLevel) DocumentAccessBatchItem {
	return DocumentAccessBatchItem{
		PrincipalType: DocumentPrincipalUser, PrincipalID: userID,
		Level: docLevelPtr(level), OnExisting: DocumentAccessOnExistingUpdate,
	}
}

// TestAccessBatchSameLevelManualItemTakesOverChatShare is B4 on PUT
// /documents/{id}/access: a manual item at the level a chat grant already
// gave takes the row over (manual provenance, the remembered manual level
// cleared), so a later leave keeps what the manager set in the Share dialog.
// The item's RESULT stays "unchanged" (the level did not change, which is what
// the dialog reports); only the row's provenance converts.
func TestAccessBatchSameLevelManualItemTakesOverChatShare(t *testing.T) {
	f := newAccessBatchTakeoverFixture(t, "takeover")

	res := f.put(t, false,
		userAccessItem(f.ub.ID, DocumentLevelComment),
		userAccessItem(f.uc.ID, DocumentLevelComment),
		userAccessItem(f.ud.ID, DocumentLevelEdit),
	)
	for i, r := range res.Results {
		if r.Status != DocumentAccessStatusUnchanged || r.Level == nil || r.PreviousLevel == nil || *r.Level != *r.PreviousLevel {
			t.Fatalf("result %d = %+v, want unchanged at the same level", i, r)
		}
	}
	for _, id := range []string{f.ub.ID, f.uc.ID, f.ud.ID} {
		sh, ok := f.liveShareOf(t, id, f.docID)
		if !ok || sh.SourceKind.Valid || sh.SourceRoomID.Valid || sh.SourceMessageID.Valid || sh.PriorManualLevel.Valid {
			t.Fatalf("share of %s after the manual item = %+v, want manual provenance", id, sh)
		}
	}

	f.leaveRoom(t, f.ub.ID, f.uc.ID, f.ud.ID)
	for id, want := range map[string]DocumentLevel{f.ub.ID: DocumentLevelComment, f.uc.ID: DocumentLevelComment, f.ud.ID: DocumentLevelEdit} {
		if got := f.levelOf(t, id, f.docID); got != want {
			t.Fatalf("level of %s after leaving = %q, want the manual %q", id, got, want)
		}
	}
}

// TestAccessBatchTakeoverIsIdempotentAndAudited: the takeover is one revoke
// and one grant, audited like any other write of the batch; replaying the
// same batch finds a manual row and writes nothing.
func TestAccessBatchTakeoverIsIdempotentAndAudited(t *testing.T) {
	f := newAccessBatchTakeoverFixture(t, "audit")
	item := userAccessItem(f.ub.ID, DocumentLevelComment)

	sharedBefore := len(f.auditRows(t, "document.shared", f.docID))
	revokedBefore := len(f.auditRows(t, "document.share_revoked", f.docID))
	first := f.put(t, false, item)
	if got := len(f.auditRows(t, "document.shared", f.docID)) - sharedBefore; got != 1 {
		t.Fatalf("takeover wrote %d document.shared rows, want 1", got)
	}
	if got := len(f.auditRows(t, "document.share_revoked", f.docID)) - revokedBefore; got != 0 {
		// The replaced row is revoked silently, exactly as a level change is
		// (applyDocumentShareWithBatch writes no share_revoked row for it).
		t.Fatalf("takeover wrote %d document.share_revoked rows, want 0", got)
	}
	if first.Results[0].Status != DocumentAccessStatusUnchanged {
		t.Fatalf("takeover result = %+v, want unchanged", first.Results[0])
	}
	taken, _ := f.liveShareOf(t, f.ub.ID, f.docID)

	sharedBefore = len(f.auditRows(t, "document.shared", f.docID))
	f.put(t, false, item)
	if got := len(f.auditRows(t, "document.shared", f.docID)) - sharedBefore; got != 0 {
		t.Fatalf("replay wrote %d document.shared rows, want 0", got)
	}
	if again, _ := f.liveShareOf(t, f.ub.ID, f.docID); again.ID != taken.ID {
		t.Fatalf("replay replaced the manual row %s with %s", taken.ID, again.ID)
	}
}

// TestAccessBatchPreviewAndKeepDoNotTakeOver: a dry run writes nothing, and an
// item that asks to keep the existing share is a promise not to touch it.
func TestAccessBatchPreviewAndKeepDoNotTakeOver(t *testing.T) {
	f := newAccessBatchTakeoverFixture(t, "preview")
	before, _ := f.liveShareOf(t, f.ub.ID, f.docID)

	res := f.put(t, true, userAccessItem(f.ub.ID, DocumentLevelComment))
	if res.Results[0].Status != DocumentAccessStatusUnchanged {
		t.Fatalf("preview result = %+v, want unchanged", res.Results[0])
	}
	keep := userAccessItem(f.ub.ID, DocumentLevelComment)
	keep.OnExisting = DocumentAccessOnExistingKeep
	if res := f.put(t, false, keep); res.Results[0].Status != DocumentAccessStatusKept {
		t.Fatalf("keep result = %+v, want kept", res.Results[0])
	}
	after, _ := f.liveShareOf(t, f.ub.ID, f.docID)
	if after.ID != before.ID || after.SourceKind.String != DocumentShareSourceKindChat {
		t.Fatalf("share after preview and keep = %+v, want the untouched chat row %s", after, before.ID)
	}
}

// TestAccessBatchTakeoverStaysChatForOtherLevels: a raise or a lower is the
// existing level change (a manual row, as before); an item at the chat level
// next to ordinary manual rows leaves those rows alone.
func TestAccessBatchTakeoverLeavesOrdinaryManualRowsAlone(t *testing.T) {
	f := newAccessBatchTakeoverFixture(t, "mixed")
	ctx := context.Background()
	outsider := f.reconcileMember(t, "access-b4-e-mixed@example.com", "E")
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), f.docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: outsider.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	manualBefore, _ := f.liveShareOf(t, outsider.ID, f.docID)

	res := f.put(t, false,
		userAccessItem(outsider.ID, DocumentLevelView),
		userAccessItem(f.ub.ID, DocumentLevelComment),
		userAccessItem(f.uc.ID, DocumentLevelEdit),
	)
	want := []string{DocumentAccessStatusUnchanged, DocumentAccessStatusUnchanged, DocumentAccessStatusUpdated}
	for i, r := range res.Results {
		if r.Status != want[i] {
			t.Fatalf("result %d = %+v, want %s", i, r, want[i])
		}
	}
	if manualAfter, _ := f.liveShareOf(t, outsider.ID, f.docID); manualAfter.ID != manualBefore.ID {
		t.Fatalf("an unchanged manual row was rewritten: %s -> %s", manualBefore.ID, manualAfter.ID)
	}
	for _, id := range []string{f.ub.ID, f.uc.ID} {
		if sh, _ := f.liveShareOf(t, id, f.docID); sh.SourceKind.Valid {
			t.Fatalf("share of %s = %+v, want manual provenance", id, sh)
		}
	}
}
