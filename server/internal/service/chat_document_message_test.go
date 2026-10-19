package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatDocumentFixture is the chat fixture with the Documents service and a
// fake FileService wired, so a document send can run end to end at the
// service level.
type chatDocumentFixture struct {
	svc   *ChatService
	docs  *DocumentService
	files files.Service
	pub   *capturePublisher
	q     *db.Queries
	pool  *pgxpool.Pool
	ua    db.User
	ub    db.User
	ws    db.Workspace
	orgID string
}

func newChatDocumentFixture(t *testing.T) *chatDocumentFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "chatdoc-a@example.com", "A")
	ub := registerVerified(t, q, as, "chatdoc-b@example.com", "B")
	org, err := orgs.Create(ctx, ua.ID, "Org", "org-chatdoc")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "ChatDoc WS", "chatdoc-ws")
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, org.ID, ub.ID)
	addWorkspaceMember(t, q, v.Workspace.ID, ub.ID)

	fs := filesfake.New(filesfake.Options{})
	docs := NewDocumentService(pool, q, orgs, ws)
	docs.SetFiles(fs)
	pub := &capturePublisher{}
	svc := NewChatService(pool, q, ws, pub)
	svc.SetFiles(fs)
	svc.SetDocuments(docs)
	return &chatDocumentFixture{
		svc: svc, docs: docs, files: fs, pub: pub, q: q, pool: pool,
		ua: ua, ub: ub, ws: v.Workspace, orgID: org.ID,
	}
}

// dm opens the DM between the fixture's two users and returns its room.
func (f *chatDocumentFixture) dm(t *testing.T) db.ChatRoom {
	t.Helper()
	ctx := context.Background()
	sum, err := f.svc.ResolveDM(ctx, f.ua.ID, f.ws.ID, f.ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	room, err := f.q.GetChatRoomByID(ctx, sum.ID)
	if err != nil {
		t.Fatalf("get room: %v", err)
	}
	return room
}

// documentMessageInput is one send with a small Markdown document.
func documentMessageInput(clientMsgID string) SendDocumentMessageInput {
	return SendDocumentMessageInput{
		ShareLevel:  "comment",
		Filename:    "ke-hoach.md",
		Title:       "Kế hoạch",
		Body:        bytes.NewReader([]byte("# Kế hoạch\n\n- một\n- hai\n")),
		ClientMsgID: clientMsgID,
	}
}

// liveSharesOfDocument lists the live share rows of one document.
func (f *chatDocumentFixture) liveSharesOfDocument(t *testing.T, documentID string) []db.DocumentShare {
	t.Helper()
	rows, err := f.q.ListDocumentShares(context.Background(), db.ListDocumentSharesParams{
		OrganizationID: f.orgID, WorkspaceID: f.ws.ID, DocumentID: documentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// chatMessagesOfKind counts the room's messages of one kind.
func (f *chatDocumentFixture) chatMessagesOfKind(t *testing.T, roomID, kind string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM chat_messages WHERE room_id = $1 AND kind = $2 AND deleted_at IS NULL`,
		roomID, kind).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestSendDocumentMessageCreatesDocumentGrantsAndOneMessage is §7.1 test 1.
func TestSendDocumentMessageCreatesDocumentGrantsAndOneMessage(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-one-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if msg.Kind != "document" {
		t.Fatalf("kind = %q, want document", msg.Kind)
	}
	if msg.Document == nil || msg.Document.DocumentID == "" {
		t.Fatalf("document block = %+v", msg.Document)
	}
	doc, err := f.q.GetDocumentByID(ctx, msg.Document.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	// The document lands in the sender's My Folder, and nowhere else: the
	// folder is a parent, never a grant target.
	if !doc.ParentID.Valid {
		t.Fatal("document has no parent; want the sender's My Folder")
	}
	folder, err := f.q.GetDocumentByID(ctx, doc.ParentID.String)
	if err != nil {
		t.Fatal(err)
	}
	if !isMyFolder(folder) {
		t.Fatalf("parent = %+v, want the sender's My Folder", folder)
	}
	if doc.AclOwnerID.String != f.ua.ID {
		t.Fatalf("acl owner = %q, want the sender", doc.AclOwnerID.String)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document"); got != 1 {
		t.Fatalf("document messages = %d, want 1", got)
	}
	// Exactly one live grant: the other member, at the requested level.
	shares := f.liveSharesOfDocument(t, doc.ID)
	if len(shares) != 1 {
		t.Fatalf("live shares = %d, want 1: %+v", len(shares), shares)
	}
	if shares[0].PrincipalID != f.ub.ID || shares[0].Level != "comment" {
		t.Fatalf("share = %+v, want the other member at comment", shares[0])
	}
	// The sender holds manage through the ACL owner path, and the card says so.
	if msg.Document.Level != string(DocumentLevelManage) || !msg.Document.CanManage {
		t.Fatalf("sender block = %+v, want manage", msg.Document)
	}
	if !msg.Document.CanUploadVersion {
		t.Fatalf("sender cannot upload a version: %+v", msg.Document)
	}
	// UNI-1974: only the document is shared. No share row may name the My
	// Folder or any folder, now or after the read carries no parent_id.
	// TODO(UNI-1974): the receiver's read of this card must carry no parent_id,
	// so a later "folder share" cannot be inferred from the block.
	for _, sh := range shares {
		if sh.DocumentID == folder.ID {
			t.Fatalf("the My Folder got a share row: %+v", sh)
		}
	}
	if got := f.liveSharesOfDocument(t, folder.ID); len(got) != 0 {
		t.Fatalf("My Folder shares = %+v, want none", got)
	}
}

// TestSendDocumentMessageReplay is §7.1 test 2.
func TestSendDocumentMessageReplay(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	first, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-replay-1"))
	if err != nil {
		t.Fatalf("first send: %v", err)
	}
	second, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-replay-1"))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if second.ID != first.ID || second.Document.DocumentID != first.Document.DocumentID {
		t.Fatalf("replay = %s/%s, want %s/%s", second.ID, second.Document.DocumentID, first.ID, first.Document.DocumentID)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document"); got != 1 {
		t.Fatalf("document messages = %d, want 1", got)
	}
	if shares := f.liveSharesOfDocument(t, first.Document.DocumentID); len(shares) != 1 {
		t.Fatalf("live shares = %d, want 1", len(shares))
	}
	// A different share_level is not a different command: the key names the
	// message and its document, and the replay grants nothing new.
	in := documentMessageInput("doc-replay-1")
	in.ShareLevel = "view"
	third, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("replay under another level: %v", err)
	}
	if third.ID != first.ID {
		t.Fatalf("replay under another level = %s, want %s", third.ID, first.ID)
	}
	if shares := f.liveSharesOfDocument(t, first.Document.DocumentID); len(shares) != 1 || shares[0].Level != "comment" {
		t.Fatalf("shares after the replay = %+v, want the original comment grant", shares)
	}
	// A different command under the same key is idempotency_conflict: the key
	// already names a text message.
	if _, err := f.svc.SendRoomMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendChatMessageInput{Body: "hello", ClientMsgID: "doc-conflict-1"}); err != nil {
		t.Fatalf("text send: %v", err)
	}
	conflict := documentMessageInput("doc-conflict-1")
	if _, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, conflict); !codedIs(err, files.CodeIdempotencyConflict) {
		t.Fatalf("a document under a text key = %v, want idempotency_conflict", err)
	}
}

// TestSendDocumentMessageRefusesNonMemberAndAgent is §7.1 test 3.
func TestSendDocumentMessageRefusesNonMemberAndAgent(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	outsider := registerVerified(t, f.q, NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chatdoc-out@example.com", "Out")
	if _, err := f.svc.SendDocumentMessage(ctx, outsider.ID, f.ws.ID, room.ID, documentMessageInput("doc-outside-1")); err == nil {
		t.Fatal("a non-member sent a document into the room")
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document"); got != 0 {
		t.Fatalf("document messages after the refusal = %d, want 0", got)
	}
}

// TestSendDocumentMessageExcludesSenderAndSkippedMembers is §7.1 test 4.
func TestSendDocumentMessageExcludesSenderAndSkippedMembers(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// A third member who is deactivated in the organization: the grant skips
	// them without failing the send.
	uc := registerVerified(t, f.q, NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chatdoc-c@example.com", "C")
	addOrgMember(t, f.q, f.orgID, uc.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uc.ID)
	addChatRoomMember(t, f.q, room, f.ws.ID, f.orgID, uc.ID)
	if _, err := f.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, f.orgID, uc.ID); err != nil {
		t.Fatal(err)
	}

	msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-skip-1"))
	if err != nil {
		t.Fatalf("send with a deactivated member: %v", err)
	}
	shares := f.liveSharesOfDocument(t, msg.Document.DocumentID)
	for _, sh := range shares {
		if sh.PrincipalID == f.ua.ID {
			t.Fatalf("the sender got a share row: %+v", sh)
		}
		if sh.PrincipalID == uc.ID {
			t.Fatalf("a deactivated member got a share row: %+v", sh)
		}
	}
	if len(shares) != 1 || shares[0].PrincipalID != f.ub.ID {
		t.Fatalf("shares = %+v, want only the active other member", shares)
	}
}

// TestSendDocumentMessageLevelValidation is §7.1 test 5.
func TestSendDocumentMessageLevelValidation(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// manage is refused: a chat send never hands out administration.
	in := documentMessageInput("doc-manage-1")
	in.ShareLevel = "manage"
	if _, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in); err == nil {
		t.Fatal("manage was accepted as a share level")
	}
	// Empty defaults to comment.
	in = documentMessageInput("doc-default-1")
	in.ShareLevel = ""
	msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("default level send: %v", err)
	}
	shares := f.liveSharesOfDocument(t, msg.Document.DocumentID)
	if len(shares) != 1 || shares[0].Level != "comment" {
		t.Fatalf("default level = %+v, want comment", shares)
	}
	// view and edit as asked.
	for _, level := range []string{"view", "edit"} {
		in = documentMessageInput("doc-level-" + level)
		in.ShareLevel = level
		msg, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
		if err != nil {
			t.Fatalf("%s send: %v", level, err)
		}
		shares := f.liveSharesOfDocument(t, msg.Document.DocumentID)
		if len(shares) != 1 || shares[0].Level != level {
			t.Fatalf("%s shares = %+v", level, shares)
		}
	}
}

// TestSendDocumentMessageRefusesOverCapRoom is §7.1 test 6.
func TestSendDocumentMessageRefusesOverCapRoom(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// 51 grantable recipients: the sender plus 51 others, so the batch cap is
	// exceeded by one.
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ids := []string{f.ub.ID}
	for i := range maxDocumentShareBatch {
		u := registerVerified(t, f.q, as, fmt.Sprintf("chatdoc-cap-%d@example.com", i), fmt.Sprintf("Cap %d", i))
		addOrgMember(t, f.q, f.orgID, u.ID)
		addWorkspaceMember(t, f.q, f.ws.ID, u.ID)
		ids = append(ids, u.ID)
	}
	group, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "big", MemberUserIDs: ids})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, group.ID, documentMessageInput("doc-capacity-1")); err == nil {
		t.Fatal("an over-cap room accepted a document send")
	} else if ce := wantCode(t, err, "share_batch_too_large"); ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}
	if got := f.chatMessagesOfKind(t, group.ID, "document"); got != 0 {
		t.Fatalf("document messages after the refusal = %d, want 0", got)
	}
	// The room detail read advertises the same refusal (L5).
	summary, err := f.svc.GetRoomSummary(ctx, f.ua.ID, f.ws.ID, group.ID)
	if err != nil {
		t.Fatalf("room summary: %v", err)
	}
	if summary.CanSendDocument {
		t.Fatal("can_send_document = true on an over-cap room")
	}
	// A deactivated member is not a grantable recipient, so deactivating one
	// of the 51 brings the room back under the cap and the flag flips: the
	// count is the audience the send would actually reach (L5).
	if _, err := f.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, f.orgID, ids[len(ids)-1]); err != nil {
		t.Fatal(err)
	}
	summary, err = f.svc.GetRoomSummary(ctx, f.ua.ID, f.ws.ID, group.ID)
	if err != nil {
		t.Fatalf("room summary after deactivation: %v", err)
	}
	if !summary.CanSendDocument {
		t.Fatal("can_send_document = false after a member was deactivated; the skipped member is not a recipient")
	}
	// The DM stays sendable.
	dmSummary, err := f.svc.GetRoomSummary(ctx, f.ua.ID, f.ws.ID, room.ID)
	if err != nil {
		t.Fatalf("dm summary: %v", err)
	}
	if !dmSummary.CanSendDocument {
		t.Fatal("can_send_document = false on a two-person DM")
	}
}

// TestSendDocumentMessageQuota is §7.1 test 7.
func TestSendDocumentMessageQuota(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// A forced failure between the document and the message must roll the
	// document back with it: the message never names a document that does not
	// exist, and the staged upload is cancelled.
	chatDocumentShareFault = func() error { return errors.New("forced fault after the document") }
	t.Cleanup(func() { chatDocumentShareFault = nil })

	_, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-fault-1"))
	if err == nil {
		t.Fatal("the forced fault did not fail the send")
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document"); got != 0 {
		t.Fatalf("document messages after the rollback = %d, want 0", got)
	}
	var docs int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'file' AND system_kind IS NULL`,
		f.ws.ID).Scan(&docs); err != nil {
		t.Fatal(err)
	}
	if docs != 0 {
		t.Fatalf("documents after the rollback = %d, want 0", docs)
	}
}

// TestSendDocumentMessageRefusesTypeOutsideSubset is the L8 test.
func TestSendDocumentMessageRefusesTypeOutsideSubset(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	// A PNG and a CSS file: on documentMIMETypes (the UNI-1232 assets), off
	// ChatDocumentMIMETypes.
	for _, tc := range []struct {
		name        string
		filename    string
		contentType string
		body        []byte
	}{
		{"png", "pixel.png", "image/png", pngHeaderBytes()},
		{"css", "site.css", "text/css", []byte("body { color: #222; }\n")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := documentMessageInput("doc-type-" + tc.name)
			in.Filename = tc.filename
			in.Body = bytes.NewReader(tc.body)
			_, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
			if err == nil {
				t.Fatalf("%s was accepted as a document", tc.name)
			}
			ce := wantCode(t, err, "unsupported_media_type")
			if ce.Status != http.StatusUnsupportedMediaType {
				t.Fatalf("status = %d, want 415", ce.Status)
			}
			if got, ok := ce.Fields["reason"]; !ok || got != "format" {
				t.Fatalf("fields = %+v, want reason=format", ce.Fields)
			}
			if got := f.chatMessagesOfKind(t, room.ID, "document"); got != 0 {
				t.Fatalf("document messages = %d, want 0", got)
			}
			var docs int
			if err := f.pool.QueryRow(ctx,
				`SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'file' AND system_kind IS NULL`,
				f.ws.ID).Scan(&docs); err != nil {
				t.Fatal(err)
			}
			if docs != 0 {
				t.Fatalf("documents = %d, want 0", docs)
			}
		})
	}
}

// TestDocumentCardViewerFields is §7.1 test 11.
func TestDocumentCardViewerFields(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-viewer-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	// The receiver holds comment: access, no manage, no version upload.
	rows, err := f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("receiver list: %v", err)
	}
	block := documentBlockOf(t, rows, sent.ID)
	if block == nil || !block.HasAccess {
		t.Fatalf("receiver block = %+v, want access", block)
	}
	if block.Level != string(DocumentLevelComment) {
		t.Fatalf("receiver level = %q, want comment", block.Level)
	}
	if block.CanManage || block.CanUploadVersion {
		t.Fatalf("receiver block = %+v, want neither manage nor version upload", block)
	}
	if block.Title == "" || block.Format != "md" || block.VersionNumber != 1 || block.Revision == 0 {
		t.Fatalf("receiver block = %+v, want the resolved document fields", block)
	}
	if block.HasRecipientCount {
		t.Fatalf("a receiver sees recipient_count: %+v", block)
	}

	// The sender holds manage and sees the audience.
	rows, err = f.svc.ListRoomMessages(ctx, f.ua.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("sender list: %v", err)
	}
	senderBlock := documentBlockOf(t, rows, sent.ID)
	if senderBlock == nil || !senderBlock.CanManage {
		t.Fatalf("sender block = %+v, want manage", senderBlock)
	}
	if !senderBlock.HasRecipientCount || senderBlock.RecipientCount != 1 {
		t.Fatalf("sender recipient_count = %+v, want 1", senderBlock)
	}

	// A member who joins after the send sees the id and the false flag and
	// nothing else. A DM's member set is fixed, so this uses a group.
	ud := registerVerified(t, f.q, NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chatdoc-late-d@example.com", "Late D")
	addOrgMember(t, f.q, f.orgID, ud.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, ud.ID)
	group, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "late", MemberUserIDs: []string{f.ub.ID, ud.ID}})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	groupRoom, err := f.q.GetChatRoomByID(ctx, group.ID)
	if err != nil {
		t.Fatal(err)
	}
	groupSent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, groupRoom.ID, documentMessageInput("doc-group-1"))
	if err != nil {
		t.Fatalf("group send: %v", err)
	}
	uc := registerVerified(t, f.q, NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chatdoc-late@example.com", "Late")
	addOrgMember(t, f.q, f.orgID, uc.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uc.ID)
	addChatRoomMember(t, f.q, groupRoom, f.ws.ID, f.orgID, uc.ID)
	rows, err = f.svc.ListRoomMessages(ctx, uc.ID, f.ws.ID, groupRoom.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("late joiner list: %v", err)
	}
	lateBlock := documentBlockOf(t, rows, groupSent.ID)
	if lateBlock == nil {
		t.Fatal("the late joiner sees no document block")
	}
	if lateBlock.HasAccess {
		t.Fatalf("late joiner has access: %+v", lateBlock)
	}
	if lateBlock.DocumentID != groupSent.Document.DocumentID {
		t.Fatalf("late joiner document_id = %q, want %q", lateBlock.DocumentID, groupSent.Document.DocumentID)
	}
	if lateBlock.Title != "" || lateBlock.Format != "" || lateBlock.Revision != 0 || lateBlock.VersionNumber != 0 || lateBlock.CanOpenInApp {
		t.Fatalf("a block without access leaked fields: %+v", lateBlock)
	}
}

// TestDeleteDocumentMessageKeepsAccess is §7.1 test 8.
func TestDeleteDocumentMessageKeepsAccess(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-delete-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, sent.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := f.q.GetDocumentByID(ctx, sent.Document.DocumentID); err != nil {
		t.Fatalf("the document went with the message: %v", err)
	}
	if shares := f.liveSharesOfDocument(t, sent.Document.DocumentID); len(shares) != 1 {
		t.Fatalf("live shares after the delete = %+v, want 1", shares)
	}
}

// addChatRoomMember puts one more member into a room the fixture owns.
func addChatRoomMember(t *testing.T, q *db.Queries, room db.ChatRoom, workspaceID, orgID, userID string) {
	t.Helper()
	if _, err := q.InsertChatRoomMember(context.Background(), db.InsertChatRoomMemberParams{
		ID: util.NewID(), RoomID: room.ID, WorkspaceID: workspaceID,
		UserID: userID, Role: "member", Status: "active", OrganizationID: orgID,
	}); err != nil {
		t.Fatal(err)
	}
}

// documentBlockOf finds one message's document block in a page.
func documentBlockOf(t *testing.T, rows []ChatMessageRow, messageID string) *DocumentMessageInfo {
	t.Helper()
	for _, row := range rows {
		if row.ID == messageID {
			return row.Document
		}
	}
	t.Fatalf("message %s is not in the page", messageID)
	return nil
}

// pngHeaderBytes is a one-pixel PNG, the sample the file contract suite uses.
func pngHeaderBytes() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	}
}
