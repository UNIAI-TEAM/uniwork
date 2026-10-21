package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// linkPage creates a restricted page at the root of workspaceID owned by
// ownerID: the existing Documents file a link send attaches.
func (f *chatDocumentFixture) linkPage(t *testing.T, ownerID, workspaceID, title string) db.Document {
	t.Helper()
	v, err := f.docs.CreatePage(context.Background(), Human(ownerID), workspaceID, CreatePageInput{
		Title: title, Visibility: "restricted",
	})
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	return v.Document
}

// thirdMember adds one more org + workspace member to the fixture.
func (f *chatDocumentFixture) thirdMember(t *testing.T, email string) db.User {
	t.Helper()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, f.q, as, email, "Third")
	addOrgMember(t, f.q, f.orgID, u.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, u.ID)
	return u
}

// group opens a group room of the given members, created by ua.
func (f *chatDocumentFixture) group(t *testing.T, memberIDs ...string) db.ChatRoom {
	t.Helper()
	ctx := context.Background()
	sum, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "Nhóm tài liệu", MemberUserIDs: memberIDs})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	room, err := f.q.GetChatRoomByID(ctx, sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	return room
}

func linkInput(documentID, clientMsgID string) SendDocumentLinkInput {
	return SendDocumentLinkInput{DocumentID: documentID, ShareLevel: "comment", ClientMsgID: clientMsgID}
}

func (f *chatDocumentFixture) countRows(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestSendDocumentLinkGrantsOnlyRaisesAndMarksOrigin is the S2 happy path: the
// existing document is not moved, renamed or copied; the room's recipients get
// share_level with only-raise against an existing higher manual share; the
// message is kind=document with metadata {document_id, origin:"link"}; one
// document.shared audit + outbox row, no notify_user_id.
func TestSendDocumentLinkGrantsOnlyRaisesAndMarksOrigin(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	uc := f.thirdMember(t, "chatdoc-link-c@example.com")
	room := f.group(t, f.ub.ID, uc.ID)
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Báo cáo tuần")
	before, err := f.q.GetDocumentByID(ctx, page.ID)
	if err != nil {
		t.Fatal(err)
	}
	// ub already holds edit by a manual share: a comment link keeps edit.
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), page.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("manual share: %v", err)
	}
	documentFiles := f.countRows(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, f.orgID)

	msg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(page.ID, "link-happy-1"))
	if err != nil {
		t.Fatalf("send link: %v", err)
	}
	if msg.Kind != chatMessageKindDocument || msg.Document == nil || msg.Document.DocumentID != page.ID {
		t.Fatalf("message = %+v, want kind=document naming %s", msg, page.ID)
	}
	if !msg.Document.HasAccess || msg.Document.Level != "manage" {
		t.Fatalf("sender block = %+v, want manage", msg.Document)
	}
	var raw []byte
	if err := f.pool.QueryRow(ctx, `SELECT metadata FROM chat_messages WHERE id = $1`, msg.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if meta["document_id"] != page.ID || meta["origin"] != chatDocumentOriginLink {
		t.Fatalf("metadata = %v, want document_id + origin=link", meta)
	}

	after, err := f.q.GetDocumentByID(ctx, page.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.WorkspaceID != before.WorkspaceID || after.ParentID != before.ParentID ||
		after.Title != before.Title || after.Revision != before.Revision || after.AclOwnerID != before.AclOwnerID {
		t.Fatalf("the document changed: before %+v after %+v", before, after)
	}
	if n := f.countRows(t, `SELECT count(*) FROM documents WHERE organization_id = $1`, f.orgID); n != documentFiles {
		t.Fatalf("documents in org = %d, want %d (no copy)", n, documentFiles)
	}

	levels := map[string]string{}
	for _, sh := range f.liveSharesOfDocument(t, page.ID) {
		if sh.PrincipalType == DocumentPrincipalUser {
			levels[sh.PrincipalID] = sh.Level
		}
	}
	if levels[f.ub.ID] != "edit" || levels[uc.ID] != "comment" || levels[f.ua.ID] != "" {
		t.Fatalf("user shares = %v, want ub edit (kept), uc comment, no sender share", levels)
	}
	var srcKind, srcRoom, srcMsg string
	if err := f.pool.QueryRow(ctx, `SELECT source_kind, source_room_id, source_message_id FROM document_shares
		WHERE document_id = $1 AND principal_id = $2 AND revoked_at IS NULL`, page.ID, uc.ID).Scan(&srcKind, &srcRoom, &srcMsg); err != nil {
		t.Fatal(err)
	}
	if srcKind != DocumentShareSourceKindChat || srcRoom != room.ID || srcMsg != msg.ID {
		t.Fatalf("source = %s/%s/%s, want chat/%s/%s", srcKind, srcRoom, srcMsg, room.ID, msg.ID)
	}

	if n := f.countRows(t, `SELECT count(*) FROM audit_events WHERE action = 'document.shared' AND resource_id = $1
		AND metadata::jsonb->>'source_message_id' = $2`, page.ID, msg.ID); n != 1 {
		t.Fatalf("chat document.shared audit rows = %d, want 1", n)
	}
	var payload string
	if err := f.pool.QueryRow(ctx, `SELECT payload FROM outbox_events WHERE topic = 'document.shared'
		AND payload LIKE '%' || $1 || '%' ORDER BY created_at DESC LIMIT 1`, page.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatal(err)
	}
	if p["notify_user_id"] != "" {
		t.Fatalf("link grant event carried notify_user_id=%q, want none", p["notify_user_id"])
	}

	// The receiver reads the card with the granted level.
	rows, err := f.svc.ListRoomMessages(ctx, uc.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if block := documentBlockOf(t, rows, msg.ID); block == nil || !block.HasAccess || block.Level != "comment" {
		t.Fatalf("receiver block = %+v, want comment access", block)
	}
}

// TestSendDocumentLinkReplayIsIdempotent: the same client_msg_id returns the
// same message and writes no second grant, audit or outbox row, whatever the
// second body names.
func TestSendDocumentLinkReplayIsIdempotent(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Kế hoạch")
	other := f.linkPage(t, f.ua.ID, f.ws.ID, "Khác")

	first, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(page.ID, "link-replay-1"))
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	audits := f.countRows(t, `SELECT count(*) FROM audit_events WHERE action = 'document.shared'`)
	events := f.countRows(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.shared'`)
	shares := f.countRows(t, `SELECT count(*) FROM document_shares WHERE organization_id = $1`, f.orgID)

	again := linkInput(other.ID, "link-replay-1")
	again.ShareLevel = "edit"
	second, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, again)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if second.ID != first.ID || second.Document == nil || second.Document.DocumentID != page.ID {
		t.Fatalf("replay = %+v, want the first message naming %s", second, page.ID)
	}
	if n := f.chatMessagesOfKind(t, room.ID, chatMessageKindDocument); n != 1 {
		t.Fatalf("document messages = %d, want 1", n)
	}
	if n := f.countRows(t, `SELECT count(*) FROM audit_events WHERE action = 'document.shared'`); n != audits {
		t.Fatalf("audit rows after replay = %d, want %d", n, audits)
	}
	if n := f.countRows(t, `SELECT count(*) FROM outbox_events WHERE topic = 'document.shared'`); n != events {
		t.Fatalf("outbox rows after replay = %d, want %d", n, events)
	}
	if n := f.countRows(t, `SELECT count(*) FROM document_shares WHERE organization_id = $1`, f.orgID); n != shares {
		t.Fatalf("share rows after replay = %d, want %d", n, shares)
	}
	// A key spent on a text message is a conflict, never a document replay.
	if _, err := f.svc.SendRoomMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendChatMessageInput{Body: "chào", ClientMsgID: "link-text-1"}); err != nil {
		t.Fatalf("text: %v", err)
	}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(page.ID, "link-text-1")); !errors.Is(err, ErrConflict) {
		t.Fatalf("link on a text key = %v, want conflict", err)
	}
}

// TestSendDocumentLinkRefusals: a sender who cannot share the document, a
// foreign-organization document, an archived, shelved, owned or folder
// document, and the manage level are all refused, and none writes a message
// or a grant. Not-shareable answers never reveal a document the sender cannot
// read.
func TestSendDocumentLinkRefusals(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// ub reads the page at edit but cannot manage it: forbidden.
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Của A")
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), page.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ub.ID, f.ws.ID, room.ID, linkInput(page.ID, "link-ref-edit")); !errors.Is(err, ErrForbidden) {
		t.Fatalf("editor send = %v, want forbidden", err)
	}
	// ub cannot read this one at all: not found.
	hidden := f.linkPage(t, f.ua.ID, f.ws.ID, "Bí mật")
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ub.ID, f.ws.ID, room.ID, linkInput(hidden.ID, "link-ref-hidden")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unreadable send = %v, want not found", err)
	}
	// An unknown id answers exactly like the unreadable one.
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ub.ID, f.ws.ID, room.ID, linkInput("01J0000000000000000000NONE", "link-ref-none")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown id = %v, want not found", err)
	}

	// A document of another organization, owned by its own owner who is
	// also... not a member here: not found, never the foreign title.
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(f.pool, f.q)
	outsider := registerVerified(t, f.q, as, "chatdoc-link-out@example.com", "Out")
	otherOrg, err := orgs.Create(ctx, outsider.ID, "Org khác", "org-chatdoc-link-other")
	if err != nil {
		t.Fatal(err)
	}
	otherWS, err := f.svc.ws.CreateInOrg(ctx, outsider.ID, otherOrg.ID, "WS khác", "ws-chatdoc-link-other")
	if err != nil {
		t.Fatal(err)
	}
	foreign := f.linkPage(t, outsider.ID, otherWS.Workspace.ID, "Tài liệu ngoài")
	_, err = f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(foreign.ID, "link-ref-foreign"))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign document = %v, want not found", err)
	}

	// Archived (in the trash), shelved, owned and folder documents.
	archived := f.linkPage(t, f.ua.ID, f.ws.ID, "Thùng rác")
	if _, err := f.docs.ArchiveDocument(ctx, Human(f.ua.ID), archived.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	shelved := f.linkPage(t, f.ua.ID, f.ws.ID, "Lưu trữ")
	if _, err := f.docs.ShelveDocument(ctx, Human(f.ua.ID), shelved.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	owned := f.linkPage(t, f.ua.ID, f.ws.ID, "Sản phẩm")
	if _, err := f.pool.Exec(ctx, `UPDATE documents SET owner_kind = 'work_product', owner_id = 'wp-1' WHERE id = $1`, owned.ID); err != nil {
		t.Fatal(err)
	}
	folder, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	if err != nil {
		t.Fatal(err)
	}
	for name, tc := range map[string]struct{ id, code string }{
		"archived": {archived.ID, "document_archived"},
		"shelved":  {shelved.ID, "document_shelved"},
		"folder":   {folder.Document.ID, "folder_not_shareable"},
		// The owner resolver decides an owned document: the sender reads it
		// not at all (not found) or is refused by the ACL head (409).
		"owned": {owned.ID, "document_owned_by_work_product"},
	} {
		_, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput(tc.id, "link-ref-"+name))
		var ce CodedError
		if errors.As(err, &ce) && ce.Code == tc.code {
			continue
		}
		if name == "owned" && errors.Is(err, ErrNotFound) {
			continue
		}
		t.Fatalf("%s document = %v, want %s", name, err, tc.code)
	}

	// manage and an unknown level are request errors.
	for _, level := range []string{"manage", "owner"} {
		in := linkInput(page.ID, "link-ref-level-"+level)
		in.ShareLevel = level
		if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in); !isValidationError(err) {
			t.Fatalf("level %s = %v, want invalid", level, err)
		}
	}
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, linkInput("", "link-ref-empty")); !isValidationError(err) {
		t.Fatalf("empty document_id = %v, want invalid", err)
	}

	if n := f.chatMessagesOfKind(t, room.ID, chatMessageKindDocument); n != 0 {
		t.Fatalf("a refused send left %d document messages", n)
	}
	if n := f.countRows(t, `SELECT count(*) FROM document_shares WHERE source_kind = 'chat'`); n != 0 {
		t.Fatalf("a refused send left %d chat grants", n)
	}
	if n := f.countRows(t, `SELECT count(*) FROM document_shares WHERE document_id = $1`, foreign.ID); n != 0 {
		t.Fatalf("the foreign document got %d shares", n)
	}
}

// TestSendDocumentLinkCrossWorkspaceRecipient: a DM member who is not in the
// document's workspace reads it through the link grant, and the document's
// workspace stays the sender's.
func TestSendDocumentLinkCrossWorkspaceRecipient(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	wsB, err := f.svc.ws.CreateInOrg(ctx, f.ua.ID, f.orgID, "ChatDoc Link B", "chatdoc-link-b")
	if err != nil {
		t.Fatal(err)
	}
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uB := registerVerified(t, f.q, as, "chatdoc-link-xw@example.com", "Cross")
	addOrgMember(t, f.q, f.orgID, uB.ID)
	addWorkspaceMember(t, f.q, wsB.Workspace.ID, uB.ID)

	// The DM is anchored in workspace A; the page lives in workspace A, and
	// uB is only in workspace B.
	sum, err := f.svc.ResolveDM(ctx, f.ua.ID, f.ws.ID, uB.ID)
	if err != nil {
		t.Fatal(err)
	}
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Liên workspace")
	msg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, sum.ID, linkInput(page.ID, "link-xw-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	doc, err := f.q.GetDocumentByID(ctx, page.ID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.WorkspaceID != f.ws.ID {
		t.Fatalf("document moved to %s", doc.WorkspaceID)
	}
	acc, err := f.docs.effectiveLevel(ctx, f.q, Human(uB.ID), doc)
	if err != nil || acc.Level != DocumentLevelComment {
		t.Fatalf("cross-workspace level = %+v (%v), want comment", acc, err)
	}
	rows, err := f.svc.ListRoomMessages(ctx, uB.ID, wsB.Workspace.ID, sum.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("uB list: %v", err)
	}
	if block := documentBlockOf(t, rows, msg.ID); block == nil || !block.HasAccess {
		t.Fatalf("uB block = %+v, want access", block)
	}
}

// TestSendDocumentLinkReplyMustBeInTheRoom: reply_to_message_id names a live
// message of the same room, as on the other message routes.
func TestSendDocumentLinkReplyMustBeInTheRoom(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	page := f.linkPage(t, f.ua.ID, f.ws.ID, "Trả lời")
	parent, err := f.svc.SendRoomMessage(ctx, f.ub.ID, f.ws.ID, room.ID, SendChatMessageInput{Body: "gửi mình tài liệu nhé"})
	if err != nil {
		t.Fatal(err)
	}
	in := linkInput(page.ID, "link-reply-1")
	in.ReplyToMessageID = &parent.ID
	msg, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("reply send: %v", err)
	}
	if msg.ReplyToMessageID == nil || *msg.ReplyToMessageID != parent.ID {
		t.Fatalf("reply_to = %v, want %s", msg.ReplyToMessageID, parent.ID)
	}
	bogus := "01J0000000000000000000NONE"
	in = linkInput(page.ID, "link-reply-2")
	in.ReplyToMessageID = &bogus
	if _, err := f.svc.SendDocumentLinkMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in); !isValidationError(err) {
		t.Fatalf("bogus reply = %v, want invalid", err)
	}
}

func isValidationError(err error) bool {
	var ve ValidationError
	return errors.As(err, &ve)
}
