package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countOutboxFor counts the outbox rows of topic naming documentID.
func (f *chatDocumentFixture) countOutboxFor(t *testing.T, topic, documentID string) int {
	t.Helper()
	return f.countRows(t,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`,
		topic, documentID)
}

// chatDeleteAuditMeta is the metadata of the chat.message_deleted row of one message.
func (f *chatDocumentFixture) chatDeleteAuditMeta(t *testing.T, messageID string) map[string]any {
	t.Helper()
	rows := f.auditRows(t, audit.ActionChatMessageDeleted, messageID)
	if len(rows) != 1 {
		t.Fatalf("chat.message_deleted rows for %s = %d, want 1", messageID, len(rows))
	}
	meta := map[string]any{}
	if err := json.Unmarshal([]byte(rows[0].Metadata), &meta); err != nil {
		t.Fatal(err)
	}
	return meta
}

// TestDeleteUploadDocumentMessageTrashesAndRevokes is S1d for an upload-origin
// message (replaces TestDeleteDocumentMessageKeepsAccess): the sender sees
// origin=upload and the other-editors count on their own card, the recipient
// sees the origin but no count; a version committed by the recipient counts;
// deleting the recipient's document_version line touches nothing; deleting
// the upload trashes the document for 30 days even though someone else
// committed a version, revokes every chat grant (including one a second live
// message of the same document backs), audits and emits in the delete's
// transaction, and a second delete changes nothing. The document can be
// restored from the trash.
func TestDeleteUploadDocumentMessageTrashesAndRevokes(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	uc := f.thirdMember(t, "chatdoc-delete-c@example.com")

	in := documentMessageInput("doc-delete-upload-1")
	in.ShareLevel = "edit"
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	docID := sent.Document.DocumentID
	// A second live card of the same document in a group backs uc's grant;
	// the USER rule still revokes it when the upload goes.
	grp := f.group(t, f.ub.ID, uc.ID)
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, linkInput(docID, "doc-delete-upload-link")); err != nil {
		t.Fatalf("link send: %v", err)
	}
	if _, ok := f.liveShareOf(t, uc.ID, docID); !ok {
		t.Fatal("uc has no chat grant from the group card")
	}

	senderBlock := func() *DocumentMessageInfo {
		rows, err := f.svc.ListRoomMessages(ctx, f.ua.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
		if err != nil {
			t.Fatal(err)
		}
		return documentBlockOf(t, rows, sent.ID)
	}
	if b := senderBlock(); b == nil || b.Origin != chatDocumentOriginUpload || !b.HasOtherEditorsCount || b.OtherEditorsCount != 0 {
		t.Fatalf("sender block = %+v, want origin upload and other editors 0", b)
	}

	// The recipient (edit) commits v2 from the card: one other editor, and a
	// document_version line in the room sent by the recipient.
	up, err := f.docs.UploadDocumentFile(ctx, Human(f.ub.ID), docID, DocumentUploadInput{
		Filename: "ke-hoach.md", Body: bytes.NewReader([]byte("# Kế hoạch v2\n")), IdempotencyKey: "del-up-v2",
	})
	if err != nil {
		t.Fatalf("upload v2: %v", err)
	}
	if _, err := f.docs.CommitFileVersion(ctx, Human(f.ub.ID), docID, CommitFileVersionInput{
		UploadID: up.UploadID, BaseRevision: 1, IdempotencyKey: "del-commit-v2", ChatRoomID: room.ID,
	}); err != nil {
		t.Fatalf("commit v2: %v", err)
	}
	if b := senderBlock(); b == nil || !b.HasOtherEditorsCount || b.OtherEditorsCount != 1 {
		t.Fatalf("sender block after ub's version = %+v, want other editors 1", b)
	}
	rows, err := f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if b := documentBlockOf(t, rows, sent.ID); b == nil || b.Origin != chatDocumentOriginUpload || b.HasOtherEditorsCount {
		t.Fatalf("recipient block = %+v, want origin upload and no count", b)
	}
	var versionLine ChatMessageRow
	for _, r := range rows {
		if r.Kind == chatMessageKindDocumentVersion {
			versionLine = r
		}
	}
	if versionLine.ID == "" || versionLine.SenderID != f.ub.ID {
		t.Fatalf("version line = %+v, want one sent by ub", versionLine)
	}
	if versionLine.Document == nil || versionLine.Document.Origin != "" || versionLine.Document.HasOtherEditorsCount {
		t.Fatalf("version line block = %+v, want no origin and no count", versionLine.Document)
	}

	// Deleting the version line leaves the document and every share alone.
	sharesBefore := len(f.liveSharesOfDocument(t, docID))
	if err := f.svc.DeleteChatMessage(ctx, f.ub.ID, f.ws.ID, room.ID, versionLine.ID); err != nil {
		t.Fatalf("delete version line: %v", err)
	}
	if doc, err := f.q.GetDocumentByID(ctx, docID); err != nil || doc.ArchivedAt.Valid {
		t.Fatalf("version line delete touched the document: %+v %v", doc, err)
	}
	if got := len(f.liveSharesOfDocument(t, docID)); got != sharesBefore {
		t.Fatalf("live shares after the version line delete = %d, want %d", got, sharesBefore)
	}
	if meta := f.chatDeleteAuditMeta(t, versionLine.ID); meta["document_id"] != nil {
		t.Fatalf("version line delete audit = %+v, want no document part", meta)
	}

	// Deleting the upload trashes the document and revokes every chat grant.
	before := time.Now()
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, sent.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	doc, err := f.q.GetDocumentByID(ctx, docID)
	if err != nil {
		t.Fatalf("the document was purged instead of trashed: %v", err)
	}
	if !doc.ArchivedAt.Valid || doc.ArchivedBy.String != f.ua.ID {
		t.Fatalf("document after the delete = archived %v by %q, want archived by the sender", doc.ArchivedAt, doc.ArchivedBy.String)
	}
	if want := before.Add(documentRetentionDays * 24 * time.Hour); !doc.PurgeAfter.Valid || doc.PurgeAfter.Time.Before(want.Add(-time.Minute)) {
		t.Fatalf("purge_after = %v, want about %v", doc.PurgeAfter.Time, want)
	}
	for _, sh := range f.liveSharesOfDocument(t, docID) {
		if sh.SourceKind.String == DocumentShareSourceKindChat {
			t.Fatalf("a chat grant survived the delete: %+v", sh)
		}
	}
	if n := len(f.auditRows(t, audit.ActionDocumentArchived, docID)); n != 1 {
		t.Fatalf("document.archived audit rows = %d, want 1", n)
	}
	if n := f.countOutboxFor(t, "document.archived", docID); n != 1 {
		t.Fatalf("document.archived outbox rows = %d, want 1", n)
	}
	revokedAudit := len(f.auditRows(t, audit.ActionDocumentShareRevoked, docID))
	if revokedAudit != 2 {
		t.Fatalf("document.share_revoked audit rows = %d, want 2 (ub, uc)", revokedAudit)
	}
	if n := f.countOutboxFor(t, "document.share_revoked", docID); n != 2 {
		t.Fatalf("document.share_revoked outbox rows = %d, want 2", n)
	}
	meta := f.chatDeleteAuditMeta(t, sent.ID)
	if meta["document_id"] != docID || meta["document_origin"] != chatDocumentOriginUpload ||
		meta["document_archived"] != true || meta["document_shares_revoked"] != float64(2) {
		t.Fatalf("chat.message_deleted metadata = %+v", meta)
	}
	if lv := f.levelOf(t, uc.ID, docID); lv != DocumentLevelNone {
		t.Fatalf("uc level after the delete = %q, want none", lv)
	}

	// A second delete is refused as today and writes nothing.
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, sent.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("second delete = %v, want ErrForbidden", err)
	}
	if n := len(f.auditRows(t, audit.ActionDocumentArchived, docID)); n != 1 {
		t.Fatalf("document.archived audit rows after a second delete = %d, want 1", n)
	}
	if n := len(f.auditRows(t, audit.ActionDocumentShareRevoked, docID)); n != revokedAudit {
		t.Fatalf("share_revoked rows after a second delete = %d, want %d", n, revokedAudit)
	}

	// The trash keeps it restorable for 30 days; the grants do not come back.
	if _, err := f.docs.RestoreDocument(ctx, Human(f.ua.ID), docID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, docID); ok {
		t.Fatal("a chat grant came back with the restore")
	}
}

// TestDeleteUploadDocumentMessageInAReply is S1d for a reply: a document
// message that replies to another message is deleted the same way.
func TestDeleteUploadDocumentMessageInAReply(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	root, err := f.svc.SendRoomMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendChatMessageInput{Body: "gốc"})
	if err != nil {
		t.Fatal(err)
	}
	in := documentMessageInput("doc-delete-reply-1")
	in.ReplyToMessageID = &root.ID
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("send reply: %v", err)
	}
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, sent.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	doc, err := f.q.GetDocumentByID(ctx, sent.Document.DocumentID)
	if err != nil || !doc.ArchivedAt.Valid {
		t.Fatalf("reply document after the delete = %+v %v, want archived", doc, err)
	}
	if _, ok := f.liveShareOf(t, f.ub.ID, doc.ID); ok {
		t.Fatal("the reply's chat grant survived")
	}
}

// TestDeleteLinkDocumentMessageRevokesOnlyItsGrants is S1d for a link-origin
// message: the document is never touched; only the shares whose source is
// the deleted message are decided again. ub's grant is backed by a second
// live card in a group, so it is re-pointed, not revoked; deleting that card
// too revokes it and restores the manual view it had raised; a manual share
// of someone else is never touched.
func TestDeleteLinkDocumentMessageRevokesOnlyItsGrants(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	uc := f.thirdMember(t, "chatdoc-dlink-c@example.com")
	ud := f.thirdMember(t, "chatdoc-dlink-d@example.com")
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Tài liệu có sẵn")
	docID := page.ID
	for _, sh := range []struct {
		user  string
		level DocumentLevel
	}{{f.ub.ID, DocumentLevelView}, {ud.ID, DocumentLevelEdit}} {
		if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
			PrincipalType: DocumentPrincipalUser, PrincipalID: sh.user, Level: sh.level,
		}); err != nil {
			t.Fatal(err)
		}
	}
	dmIn := linkInput(docID, "doc-dlink-dm")
	dmIn.ShareLevel = "edit"
	dmMsg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, dmIn)
	if err != nil {
		t.Fatalf("dm link: %v", err)
	}
	grp := f.group(t, f.ub.ID, uc.ID)
	grpMsg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, linkInput(docID, "doc-dlink-grp"))
	if err != nil {
		t.Fatalf("group link: %v", err)
	}
	ubShare, ok := f.liveShareOf(t, f.ub.ID, docID)
	if !ok || ubShare.SourceMessageID.String != dmMsg.ID || ubShare.PriorManualLevel.String != string(DocumentLevelView) {
		t.Fatalf("ub share = %+v, want the DM grant over a manual view", ubShare)
	}
	if b := documentBlockOf(t, []ChatMessageRow{dmMsg}, dmMsg.ID); b == nil || b.Origin != chatDocumentOriginLink || b.HasOtherEditorsCount {
		t.Fatalf("link block = %+v, want origin link and no editors count", b)
	}

	// Delete the DM card: the document stays live, ub's grant moves to the group card.
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, dmMsg.ID); err != nil {
		t.Fatalf("delete dm card: %v", err)
	}
	if doc, err := f.q.GetDocumentByID(ctx, docID); err != nil || doc.ArchivedAt.Valid {
		t.Fatalf("a link delete touched the document: %+v %v", doc, err)
	}
	if n := len(f.auditRows(t, audit.ActionDocumentArchived, docID)); n != 0 {
		t.Fatalf("document.archived rows = %d, want 0", n)
	}
	moved, ok := f.liveShareOf(t, f.ub.ID, docID)
	if !ok || moved.ID != ubShare.ID || moved.SourceMessageID.String != grpMsg.ID || moved.Level != string(DocumentLevelEdit) {
		t.Fatalf("ub share after the DM delete = %+v, want the same grant re-pointed to the group card", moved)
	}
	if meta := f.chatDeleteAuditMeta(t, dmMsg.ID); meta["document_origin"] != chatDocumentOriginLink ||
		meta["document_archived"] != false || meta["document_shares_revoked"] != float64(0) {
		t.Fatalf("dm delete audit = %+v", meta)
	}

	// Delete the group card: ub back to the manual view, uc loses the chat grant, ud untouched.
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, grp.ID, grpMsg.ID); err != nil {
		t.Fatalf("delete group card: %v", err)
	}
	if lv := f.levelOf(t, f.ub.ID, docID); lv != DocumentLevelView {
		t.Fatalf("ub level = %q, want the restored manual view", lv)
	}
	if restored, ok := f.liveShareOf(t, f.ub.ID, docID); !ok || restored.SourceKind.Valid {
		t.Fatalf("ub share = %+v, want a manual row", restored)
	}
	if _, ok := f.liveShareOf(t, uc.ID, docID); ok {
		t.Fatal("uc's chat grant survived the group card delete")
	}
	if sh, ok := f.liveShareOf(t, ud.ID, docID); !ok || sh.Level != string(DocumentLevelEdit) || sh.SourceKind.Valid {
		t.Fatalf("ud manual share = %+v, want untouched", sh)
	}
	if meta := f.chatDeleteAuditMeta(t, grpMsg.ID); meta["document_shares_revoked"] != float64(2) {
		t.Fatalf("group delete audit = %+v, want 2 revoked", meta)
	}
	if doc, err := f.q.GetDocumentByID(ctx, docID); err != nil || doc.ArchivedAt.Valid {
		t.Fatalf("the document left after the link deletes: %+v %v", doc, err)
	}
}

// TestChatUploadArchiveGate pins the delete's root gate: the human creator
// passes without manage; owned documents and My Folder refuse; anyone else
// takes the archive command's own gate.
func TestChatUploadArchiveGate(t *testing.T) {
	creator := Human("creator")
	doc := db.Document{ID: "d", CreatedBy: "creator", CreatedByKind: string(audit.KindHuman), Kind: DocumentKindFile}
	none := DocumentAccess{Level: DocumentLevelNone}
	if rootOnly, err := chatUploadArchiveGate(creator, doc, none); err != nil || !rootOnly {
		t.Fatalf("creator without manage = %v %v, want pass", rootOnly, err)
	}
	owned := doc
	owned.OwnerKind = nullText("work_product")
	if _, err := chatUploadArchiveGate(creator, owned, none); !isDocumentRefusal(err) {
		t.Fatalf("owned = %v, want a refusal", err)
	}
	mine := doc
	mine.SystemKind = nullText(DocumentSystemKindMyFolder)
	if _, err := chatUploadArchiveGate(creator, mine, none); !isDocumentRefusal(err) {
		t.Fatalf("my folder = %v, want a refusal", err)
	}
	other := Human("other")
	if _, err := chatUploadArchiveGate(other, doc, DocumentAccess{Level: DocumentLevelEdit}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-creator with edit = %v, want ErrForbidden", err)
	}
	if rootOnly, err := chatUploadArchiveGate(other, doc, DocumentAccess{Level: DocumentLevelManage}); err != nil || rootOnly {
		t.Fatalf("non-creator with manage = %v %v, want the full gate", rootOnly, err)
	}
	if got := chatDocumentOriginOf([]byte(`{"document_id":"d"}`)); got != chatDocumentOriginUpload {
		t.Fatalf("absent origin = %q, want upload", got)
	}
	if got := chatDocumentOriginOf([]byte(`{"document_id":"d","origin":"link"}`)); got != chatDocumentOriginLink {
		t.Fatalf("link origin = %q", got)
	}
	if got := chatDocumentOriginOf([]byte(`{"origin":"weird"}`)); got != chatDocumentOriginUpload {
		t.Fatalf("unknown origin = %q, want upload", got)
	}
}
