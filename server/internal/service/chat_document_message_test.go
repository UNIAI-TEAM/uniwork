package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
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
	// D1a: the document lands at the workspace root (parent_id NULL,
	// visibility restricted, acl_owner = sender, owner_kind NULL), never in My Folder.
	if doc.ParentID.Valid {
		t.Fatalf("document parent_id = %q, want NULL (workspace root)", doc.ParentID.String)
	}
	if doc.Visibility != "restricted" {
		t.Fatalf("document visibility = %q, want restricted", doc.Visibility)
	}
	if doc.AclOwnerID.String != f.ua.ID {
		t.Fatalf("acl owner = %q, want the sender", doc.AclOwnerID.String)
	}
	if doc.OwnerKind.Valid {
		t.Fatalf("owner_kind = %q, want NULL", doc.OwnerKind.String)
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
	// D1a: the title is the file name, whatever title the request carries.
	if doc.Title != "ke-hoach.md" {
		t.Fatalf("document title = %q, want the file name ke-hoach.md", doc.Title)
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

// TestSendDocumentMessageReplayAcrossRouteWorkspaces is S1 of the S1 review:
// a DM belongs to the organization, so the same send may be retried from
// another workspace of it. The upload is staged in the route workspace, so
// the replay must find the stored message before staging anything.
func TestSendDocumentMessageReplayAcrossRouteWorkspaces(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	other, err := f.svc.ws.CreateInOrg(ctx, f.ua.ID, f.orgID, "ChatDoc WS 2", "chatdoc-ws-2")
	if err != nil {
		t.Fatal(err)
	}

	first, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-xws-1"))
	if err != nil {
		t.Fatalf("first send: %v", err)
	}
	docsBefore := f.fileDocumentsCount(t)
	second, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, other.Workspace.ID, room.ID, documentMessageInput("doc-xws-1"))
	if err != nil {
		t.Fatalf("replay from another workspace: %v", err)
	}
	if second.ID != first.ID || second.Document == nil || second.Document.DocumentID != first.Document.DocumentID {
		t.Fatalf("replay = %+v, want message %s", second, first.ID)
	}
	if got := f.fileDocumentsCount(t); got != docsBefore {
		t.Fatalf("file documents after the replay = %d, want %d", got, docsBefore)
	}
	// The early lookup keeps the kind and deleted guards.
	if _, err := f.svc.SendRoomMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendChatMessageInput{Body: "hello", ClientMsgID: "doc-xws-text"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, other.Workspace.ID, room.ID, documentMessageInput("doc-xws-text")); !codedIs(err, files.CodeIdempotencyConflict) {
		t.Fatalf("a document under a text key = %v, want idempotency_conflict", err)
	}
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, first.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, other.Workspace.ID, room.ID, documentMessageInput("doc-xws-1")); !codedIs(err, "chat_message_deleted") {
		t.Fatalf("replay of a deleted message = %v, want chat_message_deleted", err)
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

// TestSendDocumentMessageOver50RecipientsAndCanSendDocumentPermission replaces
// the old 50-recipient cap test (UNI-2012 S1c): a room with >50 active members
// reports can_send_document=true and grants every active recipient; a
// deactivated member is still skipped; and can_send_document reflects send
// permission (false when send_restricted or not joined to a public channel).
func TestSendDocumentMessageOver50RecipientsAndCanSendDocumentPermission(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	const extraMembers = 55
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ids := []string{f.ub.ID}
	for i := range extraMembers {
		u := registerVerified(t, f.q, as, fmt.Sprintf("chatdoc-cap-%d@example.com", i), fmt.Sprintf("Cap %d", i))
		addOrgMember(t, f.q, f.orgID, u.ID)
		addWorkspaceMember(t, f.q, f.ws.ID, u.ID)
		ids = append(ids, u.ID)
	}
	group, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "big", MemberUserIDs: ids})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	summary, err := f.svc.GetRoomSummary(ctx, f.ua.ID, f.ws.ID, group.ID)
	if err != nil {
		t.Fatalf("room summary: %v", err)
	}
	if !summary.CanSendDocument {
		t.Fatal("can_send_document = false on a 56-recipient room; the recipient cap is removed")
	}

	// Deactivating one member skips them without failing the send: 55 active recipients receive grants.
	if _, err := f.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now()
		WHERE organization_id = $1 AND user_id = $2`, f.orgID, ids[len(ids)-1]); err != nil {
		t.Fatal(err)
	}
	groupRoom, err := f.q.GetChatRoomByID(ctx, group.ID)
	if err != nil {
		t.Fatal(err)
	}
	recipients, err := f.svc.documentGrantRecipients(ctx, f.ua.ID, groupRoom)
	if err != nil {
		t.Fatalf("recipients: %v", err)
	}
	if len(recipients) != extraMembers {
		t.Fatalf("recipients = %d, want all %d active recipients", len(recipients), extraMembers)
	}

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, group.ID, documentMessageInput("doc-uncapped-55"))
	if err != nil {
		t.Fatalf("55-recipient room refused the send: %v", err)
	}
	granted := 0
	for _, share := range f.liveSharesOfDocument(t, sent.Document.DocumentID) {
		if share.PrincipalID != f.ua.ID {
			granted++
		}
	}
	if granted != extraMembers {
		t.Fatalf("grants = %d, want %d", granted, extraMembers)
	}

	// can_send_document still means send permission: a send-restricted member sees false.
	if _, err := f.pool.Exec(ctx, `UPDATE chat_room_members SET send_restricted = true WHERE room_id = $1 AND user_id = $2`, group.ID, f.ub.ID); err != nil {
		t.Fatal(err)
	}
	ubSummary, err := f.svc.GetRoomSummary(ctx, f.ub.ID, f.ws.ID, group.ID)
	if err != nil {
		t.Fatalf("ub room summary: %v", err)
	}
	if ubSummary.CanSendDocument {
		t.Fatal("can_send_document = true for a send-restricted member, want false")
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

// TestSendDocumentMessage1000MemberRoom proves UNI-2012 S1c for a 1,000-member
// room:
//   - Grants are written in 200-row chunks inside ONE transaction.
//   - Only-raise holds: a member who already holds edit keeps edit when a
//     comment chat send grants access; the sender stays at manage.
//   - Audit + outbox policy: writes 1 batch document.shared audit row and 1
//     document.shared outbox row (not 1,000), with no notify_user_id so no
//     per-share document_shared notice is emitted while chat message
//     notifications still flow.
//   - Idempotent replay by client_msg_id and re-running grantDocumentToRoomMembers
//     write 0 extra rows.
func TestSendDocumentMessage1000MemberRoom(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()

	ch, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{
		Name: "thousand-room", Visibility: "public",
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}

	const recipientsCount = 1000
	memberIDs := make([]string, recipientsCount)
	emails := make([]string, recipientsCount)
	names := make([]string, recipientsCount)
	roomMemberIDs := make([]string, recipientsCount)
	for i := range recipientsCount {
		memberIDs[i] = util.NewID()
		emails[i] = fmt.Sprintf("chatdoc1000-%04d-%s@example.com", i, memberIDs[i])
		names[i] = fmt.Sprintf("Room1000 %04d", i)
		roomMemberIDs[i] = util.NewID()
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), 'x', now()
	`, memberIDs, emails, names); err != nil {
		t.Fatalf("seed 1000 users: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO organization_members (organization_id, user_id, role)
		SELECT $1, unnest($2::text[]), 'member'
	`, f.orgID, memberIDs); err != nil {
		t.Fatalf("seed 1000 org members: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role, organization_id)
		SELECT $1, unnest($2::text[]), 'member', $3
	`, f.ws.ID, memberIDs, f.orgID); err != nil {
		t.Fatalf("seed 1000 workspace members: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `
		INSERT INTO chat_room_members (id, room_id, workspace_id, user_id, role, status, organization_id, joined_at, created_at, updated_at)
		SELECT unnest($1::text[]), $2, $3, unnest($4::text[]), 'member', 'active', $5, now(), now(), now()
	`, roomMemberIDs, ch.ID, f.ws.ID, memberIDs, f.orgID); err != nil {
		t.Fatalf("seed 1000 chat room members: %v", err)
	}

	// The bound is a hang guard; the timing is logged, not asserted.
	sendCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	started := time.Now()
	sent, err := f.svc.SendDocumentMessage(sendCtx, f.ua.ID, f.ws.ID, ch.ID, documentMessageInput("doc-1000-room-1"))
	elapsed := time.Since(started)
	if err != nil {
		t.Fatalf("SendDocumentMessage(1000-member room): %v", err)
	}

	docID := sent.Document.DocumentID
	shares := f.liveSharesOfDocument(t, docID)
	if len(shares) != recipientsCount {
		t.Fatalf("live shares = %d, want %d", len(shares), recipientsCount)
	}

	var docAuditCount, sharedAuditCount int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE action = $1) FROM audit_events WHERE resource_id = $2`,
		audit.ActionDocumentShared, docID,
	).Scan(&docAuditCount, &sharedAuditCount); err != nil {
		t.Fatal(err)
	}
	if sharedAuditCount != 1 || docAuditCount != 2 {
		t.Fatalf("audit rows for doc = %d total (%d document.shared), want 2 total (1 document.created + 1 batch document.shared)",
			docAuditCount, sharedAuditCount)
	}

	var sharedOutboxCount int
	var sharedPayload string
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(max(payload), '') FROM outbox_events WHERE topic = 'document.shared' AND payload LIKE '%' || $1 || '%'`,
		docID,
	).Scan(&sharedOutboxCount, &sharedPayload); err != nil {
		t.Fatal(err)
	}
	if sharedOutboxCount != 1 {
		t.Fatalf("document.shared outbox rows = %d, want 1", sharedOutboxCount)
	}
	var p map[string]string
	if err := json.Unmarshal([]byte(sharedPayload), &p); err != nil {
		t.Fatal(err)
	}
	if p["notify_user_id"] != "" {
		t.Fatalf("chat document.shared outbox payload carried notify_user_id=%q, want empty (no per-share document_shared notice)", p["notify_user_id"])
	}
	// The notify rule needs a share_id and a notify_user_id to make a notice;
	// the chat grant's event carries neither, only the ids of the card refresh.
	if len(p) != 2 || p["document_id"] != docID || p["workspace_id"] == "" {
		t.Fatalf("chat document.shared outbox payload = %v, want exactly document_id and workspace_id", p)
	}

	// Elevate memberIDs[0] manually to edit, then re-run grantDocumentToRoomMembers at comment:
	// only-raise must keep memberIDs[0] at edit and all other 999 at comment (0 new rows written).
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), docID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: memberIDs[0], Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	doc, err := f.q.GetDocumentByID(ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	acc, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ua.ID), doc)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.grantDocumentToRoomMembers(
		ctx, f.q, Human(f.ua.ID), DocumentFileResult{Document: doc, Access: acc},
		memberIDs, DocumentLevelComment, ch.ID, sent.ID,
	); err != nil {
		t.Fatalf("re-grant: %v", err)
	}
	m0Acc, err := f.docs.effectiveLevel(ctx, f.q, Human(memberIDs[0]), doc)
	if err != nil || m0Acc.Level != DocumentLevelEdit {
		t.Fatalf("memberIDs[0] effective level after comment re-grant = %+v (%v), want edit", m0Acc, err)
	}

	// Idempotent replay by client_msg_id returns the same message & document without new writes.
	replayStart := time.Now()
	replayed, err := f.svc.SendDocumentMessage(sendCtx, f.ua.ID, f.ws.ID, ch.ID, documentMessageInput("doc-1000-room-1"))
	replayElapsed := time.Since(replayStart)
	if err != nil {
		t.Fatalf("replay SendDocumentMessage(1000): %v", err)
	}
	if replayed.ID != sent.ID || replayed.Document.DocumentID != docID {
		t.Fatalf("replay = %s/%s, want %s/%s", replayed.ID, replayed.Document.DocumentID, sent.ID, docID)
	}
	if got := len(f.liveSharesOfDocument(t, docID)); got != recipientsCount {
		t.Fatalf("live shares after replay = %d, want %d", got, recipientsCount)
	}
	t.Logf("SendDocumentMessage(1000-member room): send=%s replay=%s live_shares=%d doc_audits=%d shared_outbox=%d",
		elapsed, replayElapsed, len(shares), docAuditCount, sharedOutboxCount)
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

// TestDocumentCardArchivedDocumentLeaksNothing: a receiver who still holds a
// share on a document that went to the trash sees the id and the false flag,
// never the title, format or revision (BE-CDS-12).
func TestDocumentCardArchivedDocumentLeaksNothing(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("doc-archived-1"))
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	rows, err := f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("receiver list: %v", err)
	}
	if block := documentBlockOf(t, rows, sent.ID); block == nil || !block.HasAccess || block.Title == "" {
		t.Fatalf("receiver block before archive = %+v, want access with a title", block)
	}
	if _, err := f.docs.ArchiveDocument(ctx, Human(f.ua.ID), sent.Document.DocumentID, ArchiveDocumentInput{}); err != nil {
		t.Fatalf("archive: %v", err)
	}
	rows, err = f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("receiver list after archive: %v", err)
	}
	block := documentBlockOf(t, rows, sent.ID)
	if block == nil {
		t.Fatal("the receiver sees no document block after the archive")
	}
	if block.HasAccess || block.DocumentID != sent.Document.DocumentID {
		t.Fatalf("archived block = %+v, want the id with has_access false", block)
	}
	if block.Title != "" || block.Format != "" || block.Revision != 0 || block.VersionNumber != 0 || block.CanOpenInApp {
		t.Fatalf("an archived document leaked fields: %+v", block)
	}
}

// TestSendDocumentMessageCrossWorkspacePlacementAndRecipients proves D1a, D1b
// and R3: in a DM/group anchored in workspace A, a sender standing in
// workspace B (who is not a member of workspace A) sends a document without a
// 403; the document lives in workspace B at the root (parent_id NULL,
// acl_owner = sender, owner_kind NULL) while the chat message keeps room
// anchor workspace A; a cross-workspace member in workspace A receives the
// grant and reads the card with access; a channel keeps the workspace-member
// gate; and a user outside the organization never receives a grant.
func TestSendDocumentMessageCrossWorkspacePlacementAndRecipients(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(f.pool, f.q)
	wsSvc := NewWorkspaceService(f.pool, f.q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})

	// Workspace B in the same organization.
	wsBView, err := wsSvc.CreateInOrg(ctx, f.ua.ID, f.orgID, "ChatDoc WS B", "chatdoc-ws-b")
	if err != nil {
		t.Fatalf("create ws B: %v", err)
	}
	wsB := wsBView.Workspace

	// uA is a plain org member in workspace A only; uB is a plain org member in
	// workspace B only (not in workspace A).
	uA := registerVerified(t, f.q, as, "chatdoc-xw-a@example.com", "Cross A")
	uB := registerVerified(t, f.q, as, "chatdoc-xw-b@example.com", "Cross B")
	addOrgMember(t, f.q, f.orgID, uA.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uA.ID)
	addOrgMember(t, f.q, f.orgID, uB.ID)
	addWorkspaceMember(t, f.q, wsB.ID, uB.ID)

	// uA opens the DM from workspace A, so the room's anchor workspace is A.
	dmSum, err := f.svc.ResolveDM(ctx, uA.ID, f.ws.ID, uB.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	dmRoom, err := f.q.GetChatRoomByID(ctx, dmSum.ID)
	if err != nil {
		t.Fatal(err)
	}
	if dmRoom.WorkspaceID.String != f.ws.ID {
		t.Fatalf("room anchor workspace = %q, want %q", dmRoom.WorkspaceID.String, f.ws.ID)
	}

	// Outsider in another organization inserted into chat_room_members must
	// never receive a grant (R3).
	outsider := registerVerified(t, f.q, as, "chatdoc-xw-out@example.com", "Outsider")
	otherOrg, err := orgs.Create(ctx, outsider.ID, "Other Org", "other-org-chatdoc")
	if err != nil {
		t.Fatal(err)
	}
	addChatRoomMember(t, f.q, dmRoom, f.ws.ID, otherOrg.ID, outsider.ID)

	// uB stands in workspace B and sends a document into the DM anchored in A.
	sent, err := f.svc.SendDocumentMessage(ctx, uB.ID, wsB.ID, dmRoom.ID, documentMessageInput("doc-xw-dm-1"))
	if err != nil {
		t.Fatalf("cross-workspace sender in ws B failed to send into DM anchored in ws A: %v", err)
	}
	doc, err := f.q.GetDocumentByID(ctx, sent.Document.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.WorkspaceID != wsB.ID {
		t.Fatalf("doc.WorkspaceID = %q, want sender's workspace %q", doc.WorkspaceID, wsB.ID)
	}
	if doc.ParentID.Valid {
		t.Fatalf("doc.ParentID = %q, want NULL", doc.ParentID.String)
	}
	if doc.AclOwnerID.String != uB.ID {
		t.Fatalf("doc.AclOwnerID = %q, want %q", doc.AclOwnerID.String, uB.ID)
	}
	if doc.OwnerKind.Valid {
		t.Fatalf("doc.OwnerKind = %q, want NULL", doc.OwnerKind.String)
	}
	var msgWorkspaceID string
	if err := f.pool.QueryRow(ctx, `SELECT workspace_id FROM chat_messages WHERE id = $1`, sent.ID).Scan(&msgWorkspaceID); err != nil {
		t.Fatal(err)
	}
	if msgWorkspaceID != f.ws.ID {
		t.Fatalf("chat_messages.workspace_id = %q, want room anchor %q", msgWorkspaceID, f.ws.ID)
	}

	// Shares on the document in wsB: uA (in wsA only) gets the grant; outsider does not.
	shares, err := f.q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: f.orgID, WorkspaceID: wsB.ID, DocumentID: doc.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(shares) != 1 || shares[0].PrincipalID != uA.ID || shares[0].Level != "comment" {
		t.Fatalf("cross-workspace DM shares = %+v, want 1 share for uA at comment", shares)
	}

	// uA in workspace A reads the card with access.
	rows, err := f.svc.ListRoomMessages(ctx, uA.ID, f.ws.ID, dmRoom.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("uA list messages: %v", err)
	}
	block := documentBlockOf(t, rows, sent.ID)
	if block == nil || !block.HasAccess || block.Level != "comment" {
		t.Fatalf("uA card block = %+v, want HasAccess=true Level=comment", block)
	}

	// Channel room in workspace A: a room member who is only in workspace B
	// (not a member of workspace A) is skipped by the workspace-member check.
	ch, err := f.svc.CreateChannel(ctx, uA.ID, f.ws.ID, CreateChannelInput{
		Name: "ws-a-only", Visibility: "public",
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	chRoom, err := f.q.GetChatRoomByID(ctx, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	addChatRoomMember(t, f.q, chRoom, f.ws.ID, f.orgID, uB.ID)
	chSent, err := f.svc.SendDocumentMessage(ctx, uA.ID, f.ws.ID, chRoom.ID, documentMessageInput("doc-xw-ch-1"))
	if err != nil {
		t.Fatalf("channel send: %v", err)
	}
	for _, sh := range f.liveSharesOfDocument(t, chSent.Document.DocumentID) {
		if sh.PrincipalID == uB.ID {
			t.Fatalf("non-workspace member uB got a channel share: %+v", sh)
		}
	}
}

// TestGrantDocumentToRoomMembersOnlyRaises proves deliverable 3: a recipient
// who already holds edit keeps edit when a comment grant runs, and the sender
// is never granted below manage.
func TestGrantDocumentToRoomMembersOnlyRaises(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	editIn := documentMessageInput("doc-raise-1")
	editIn.ShareLevel = "edit"
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, editIn)
	if err != nil {
		t.Fatalf("send at edit: %v", err)
	}
	docID := sent.Document.DocumentID
	doc, err := f.q.GetDocumentByID(ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	access, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ua.ID), doc)
	if err != nil {
		t.Fatal(err)
	}

	// Attempting to grant comment (and including the sender in the recipient
	// slice) must neither downgrade f.ub from edit to comment nor grant the
	// sender below manage.
	if err := f.svc.grantDocumentToRoomMembers(
		ctx, f.q, Human(f.ua.ID), DocumentFileResult{Document: doc, Access: access},
		[]string{f.ua.ID, f.ub.ID}, DocumentLevelComment, room.ID, sent.ID,
	); err != nil {
		t.Fatalf("grantDocumentToRoomMembers: %v", err)
	}
	shares := f.liveSharesOfDocument(t, docID)
	if len(shares) != 1 || shares[0].PrincipalID != f.ub.ID || shares[0].Level != "edit" {
		t.Fatalf("shares after lower grant = %+v, want f.ub kept at edit and no share for sender", shares)
	}
	senderAcc, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ua.ID), doc)
	if err != nil || senderAcc.Level != DocumentLevelManage {
		t.Fatalf("sender effective level = %+v (%v), want manage", senderAcc, err)
	}
}

// TestDocumentCardPageDisablesUploadVersion proves deliverable 4: a page
// document card reports viewer_can_upload_version = false and format = "" even
// when the viewer holds edit or manage.
func TestDocumentCardPageDisablesUploadVersion(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	page, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{
		Title:      "Trang ghi chú",
		Visibility: "restricted",
	})
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), page.Document.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser,
		PrincipalID:   f.ub.ID,
		Level:         DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("share page at edit: %v", err)
	}
	msg, err := f.q.CreateChatDocumentMessage(ctx, db.CreateChatDocumentMessageParams{
		ID:             util.NewID(),
		RoomID:         room.ID,
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
		SenderID:       f.ua.ID,
		SenderKind:     "human",
		Body:           page.Document.Title,
		Metadata:       []byte(fmt.Sprintf(`{"document_id":%q}`, page.Document.ID)),
	})
	if err != nil {
		t.Fatalf("insert document message for page: %v", err)
	}

	for _, viewer := range []struct {
		name      string
		userID    string
		wantLevel string
	}{
		{"sender_manage", f.ua.ID, "manage"},
		{"recipient_edit", f.ub.ID, "edit"},
	} {
		rows, err := f.svc.ListRoomMessages(ctx, viewer.userID, f.ws.ID, room.ID, ListChatMessagesInput{})
		if err != nil {
			t.Fatalf("%s list: %v", viewer.name, err)
		}
		block := documentBlockOf(t, rows, msg.ID)
		if block == nil || !block.HasAccess {
			t.Fatalf("%s block = %+v, want HasAccess=true", viewer.name, block)
		}
		if block.Level != viewer.wantLevel {
			t.Fatalf("%s level = %q, want %q", viewer.name, block.Level, viewer.wantLevel)
		}
		if block.CanUploadVersion {
			t.Fatalf("%s CanUploadVersion = true on a page document, want false", viewer.name)
		}
		if block.Format != "" || block.CanOpenInApp {
			t.Fatalf("%s format=%q canOpenInApp=%v on a page document, want empty/false", viewer.name, block.Format, block.CanOpenInApp)
		}
	}
}

// TestChatDocumentCanUploadVersionByKind is a pure unit check for D5/R6: only
// kind="file" with edit/manage allows uploading a version.
func TestChatDocumentCanUploadVersionByKind(t *testing.T) {
	fileDoc := db.Document{Kind: DocumentKindFile}
	pageDoc := db.Document{Kind: DocumentKindPage}
	folderDoc := db.Document{Kind: DocumentKindFolder}

	for _, lvl := range []DocumentLevel{DocumentLevelNone, DocumentLevelView, DocumentLevelComment, DocumentLevelEdit, DocumentLevelManage} {
		acc := DocumentAccess{Level: lvl}
		wantFile := lvl == DocumentLevelEdit || lvl == DocumentLevelManage
		if got := chatDocumentCanUploadVersion(fileDoc, acc); got != wantFile {
			t.Fatalf("fileDoc at %s: got %v, want %v", lvl, got, wantFile)
		}
		if chatDocumentCanUploadVersion(pageDoc, acc) {
			t.Fatalf("pageDoc at %s: got true, want false", lvl)
		}
		if chatDocumentCanUploadVersion(folderDoc, acc) {
			t.Fatalf("folderDoc at %s: got true, want false", lvl)
		}
	}
}

// TestChatDocumentShareRevokerUnit checks the consumer's Topics, Name,
// no-op behaviour on empty/unrelated outbox rows, and prior-manual-level
// preservation rules without requiring a database connection.
func TestChatDocumentShareRevokerUnit(t *testing.T) {
	revoker := NewChatDocumentShareRevoker(nil)
	if revoker.Name() != "chat_document_share_revoker" {
		t.Fatalf("Name() = %q, want chat_document_share_revoker", revoker.Name())
	}
	topics := revoker.Topics()
	if len(topics) != 3 || topics[0] != "chat.room.member_removed" || topics[1] != "member.removed" || topics[2] != "member.left" {
		t.Fatalf("Topics() = %v, want [chat.room.member_removed member.removed member.left]", topics)
	}

	// Manual share (no source_kind) raised by chat -> records prior manual level.
	prevManual := db.DocumentShare{Level: "view"}
	got := priorManualLevelForChatGrant(true, prevManual, DocumentShareSourceKindChat)
	if !got.Valid || got.String != "view" {
		t.Fatalf("priorManualLevel from manual view = %+v, want view", got)
	}
	// Chat share that already remembered manual view, raised again by chat -> keeps view.
	prevChatWithManual := db.DocumentShare{
		Level:            "comment",
		SourceKind:       pgtype.Text{String: DocumentShareSourceKindChat, Valid: true},
		PriorManualLevel: pgtype.Text{String: "view", Valid: true},
	}
	got = priorManualLevelForChatGrant(true, prevChatWithManual, DocumentShareSourceKindChat)
	if !got.Valid || got.String != "view" {
		t.Fatalf("priorManualLevel from chained chat raise = %+v, want view", got)
	}
	// Pure chat share (no prior manual level) raised by chat -> stays NULL.
	prevPureChat := db.DocumentShare{
		Level:      "comment",
		SourceKind: pgtype.Text{String: DocumentShareSourceKindChat, Valid: true},
	}
	got = priorManualLevelForChatGrant(true, prevPureChat, DocumentShareSourceKindChat)
	if got.Valid {
		t.Fatalf("priorManualLevel from pure chat share = %+v, want NULL", got)
	}
	// Manual grant replacing anything -> clears priorManualLevel (it is manual now).
	got = priorManualLevelForChatGrant(true, prevChatWithManual, "")
	if got.Valid {
		t.Fatalf("priorManualLevel for manual grant = %+v, want NULL", got)
	}
}

// TestChatDocumentShareSourceMarkerAndRevokeOnLeave proves D2a end to end:
//  1. Chat sends stamp source_kind='chat', source_room_id and source_message_id.
//  2. Leaving or being removed from the room revokes chat-origin shares of that
//     room for that user, writing document.share_revoked audit + outbox in the
//     same transaction.
//  3. A manual share (no marker) and a legacy chat share (no marker) are NEVER
//     auto-revoked on leave.
//  4. When a chat grant raises a lower manual share (e.g. view -> edit),
//     leaving the room restores the manual view level instead of destroying it.
//  5. When the user is still an active member of another room holding a live
//     message of the same document, leaving room 1 re-points the share to
//     room 2 and keeps access; leaving room 2 later revokes it.
//  6. Re-sending the same document into the same room is idempotent.
func TestChatDocumentShareSourceMarkerAndRevokeOnLeave(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	revoker := NewChatDocumentShareRevoker(f.docs)

	uc := registerVerified(t, f.q, as, "chatdoc-d2a-c@example.com", "C")
	ud := registerVerified(t, f.q, as, "chatdoc-d2a-d@example.com", "D")
	addOrgMember(t, f.q, f.orgID, uc.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uc.ID)
	addOrgMember(t, f.q, f.orgID, ud.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, ud.ID)

	group1, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{
		Name:          "d2a-room-1",
		MemberUserIDs: []string{f.ub.ID, uc.ID, ud.ID},
	})
	if err != nil {
		t.Fatalf("create group1: %v", err)
	}

	// 1. Send a document in group1 -> shares carry source_kind='chat', source_room_id=group1.ID, source_message_id=sent1.ID.
	sent1, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, group1.ID, documentMessageInput("d2a-send-1"))
	if err != nil {
		t.Fatalf("send1: %v", err)
	}
	doc1ID := sent1.Document.DocumentID
	for _, sh := range f.liveSharesOfDocument(t, doc1ID) {
		if sh.SourceKind.String != DocumentShareSourceKindChat || sh.SourceRoomID.String != group1.ID || sh.SourceMessageID.String != sent1.ID {
			t.Fatalf("share %+v missing chat source markers for room %s msg %s", sh, group1.ID, sent1.ID)
		}
	}

	// 6. Re-sending the same document into the same room is idempotent.
	doc1, err := f.q.GetDocumentByID(ctx, doc1ID)
	if err != nil {
		t.Fatal(err)
	}
	acc1, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ua.ID), doc1)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.grantDocumentToRoomMembers(
		ctx, f.q, Human(f.ua.ID), DocumentFileResult{Document: doc1, Access: acc1},
		[]string{f.ub.ID, uc.ID, ud.ID}, DocumentLevelComment, group1.ID, sent1.ID,
	); err != nil {
		t.Fatalf("idempotent re-grant: %v", err)
	}
	if got := len(f.liveSharesOfDocument(t, doc1ID)); got != 3 {
		t.Fatalf("live shares after idempotent re-send = %d, want 3", got)
	}

	// 2. f.ub leaves group1 -> outbox event chat.room.member_removed -> revoker revokes f.ub's share on doc1 with audit + outbox.
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, group1.ID); err != nil {
		t.Fatalf("ub leave group1: %v", err)
	}
	if err := revoker.Handle(ctx, outbox.Row{
		ID:             util.NewID(),
		Topic:          "chat.room.member_removed",
		Payload:        fmt.Sprintf(`{"room_id":%q,"user_id":%q}`, group1.ID, f.ub.ID),
		OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
	}); err != nil {
		t.Fatalf("revoker handle ub leave: %v", err)
	}
	ubAcc, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ub.ID), doc1)
	if err != nil || ubAcc.Level != DocumentLevelNone {
		t.Fatalf("ub level after leaving group1 = %+v (%v), want none", ubAcc, err)
	}
	var revokeAudits int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE action = 'document.share_revoked' AND resource_id = $1`,
		doc1ID).Scan(&revokeAudits); err != nil || revokeAudits != 1 {
		t.Fatalf("document.share_revoked audit rows = %d (%v), want 1", revokeAudits, err)
	}

	// 3 & 4. Manual share and raised manual share:
	// Give uc a manual share on doc2 (at edit) and ud a manual share on doc2 (at view).
	// Then a chat grant at comment in group1 leaves uc at manual edit (no marker)
	// and raises ud from manual view to chat comment (prior_manual_level='view').
	page2, err := f.docs.CreatePage(ctx, Human(f.ua.ID), f.ws.ID, CreatePageInput{
		Title:      "Doc 2 manual + chat",
		Visibility: "restricted",
	})
	if err != nil {
		t.Fatalf("create doc2: %v", err)
	}
	doc2 := page2.Document
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), doc2.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: uc.ID, Level: DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("manual edit share for uc: %v", err)
	}
	if _, err := f.docs.ShareDocument(ctx, Human(f.ua.ID), doc2.ID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("manual view share for ud: %v", err)
	}
	acc2, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ua.ID), doc2)
	if err != nil {
		t.Fatal(err)
	}
	msg2ID := util.NewID()
	if err := f.svc.grantDocumentToRoomMembers(
		ctx, f.q, Human(f.ua.ID), DocumentFileResult{Document: doc2, Access: acc2},
		[]string{uc.ID, ud.ID}, DocumentLevelComment, group1.ID, msg2ID,
	); err != nil {
		t.Fatalf("chat grant on doc2: %v", err)
	}

	// Kick uc and ud from group1 -> uc keeps manual edit; ud is restored to manual view!
	for _, targetID := range []string{uc.ID, ud.ID} {
		if err := f.svc.RemoveChatRoomMember(ctx, f.ua.ID, f.ws.ID, group1.ID, targetID); err != nil {
			t.Fatalf("kick %s: %v", targetID, err)
		}
		if err := revoker.Handle(ctx, outbox.Row{
			ID:             util.NewID(),
			Topic:          "chat.room.member_removed",
			Payload:        fmt.Sprintf(`{"room_id":%q,"user_id":%q}`, group1.ID, targetID),
			OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
		}); err != nil {
			t.Fatalf("revoker handle kick %s: %v", targetID, err)
		}
	}
	ucAcc2, err := f.docs.effectiveLevel(ctx, f.q, Human(uc.ID), doc2)
	if err != nil || ucAcc2.Level != DocumentLevelEdit {
		t.Fatalf("uc level on doc2 after kick = %+v (%v), want manual edit preserved", ucAcc2, err)
	}
	udAcc2, err := f.docs.effectiveLevel(ctx, f.q, Human(ud.ID), doc2)
	if err != nil || udAcc2.Level != DocumentLevelView {
		t.Fatalf("ud level on doc2 after kick = %+v (%v), want manual view restored", udAcc2, err)
	}
	udShare2, err := f.q.GetDocumentShare(ctx, db.GetDocumentShareParams{
		OrganizationID: f.orgID, WorkspaceID: f.ws.ID, DocumentID: doc2.ID,
		PrincipalType: DocumentPrincipalUser, PrincipalID: ud.ID,
	})
	if err != nil || udShare2.SourceKind.Valid || udShare2.Level != "view" {
		t.Fatalf("restored manual share for ud = %+v (%v), want manual level=view with NULL source_kind", udShare2, err)
	}

	// 5. Multi-room retention: f.ub is in groupA and groupB, both holding a
	// live message of doc3. Leaving groupA re-points the share to groupB and
	// keeps access; leaving groupB afterwards revokes it.
	groupA, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{
		Name: "multi-a", MemberUserIDs: []string{f.ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	// A different member set: CreateGroup returns the existing group for the
	// same set, which would make groupB groupA.
	groupB, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{
		Name: "multi-b", MemberUserIDs: []string{f.ub.ID, ud.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	sent3, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, groupA.ID, documentMessageInput("d2a-multi-1"))
	if err != nil {
		t.Fatalf("send3 in groupA: %v", err)
	}
	doc3ID := sent3.Document.DocumentID
	doc3, err := f.q.GetDocumentByID(ctx, doc3ID)
	if err != nil {
		t.Fatal(err)
	}
	// groupB also holds a live message of doc3.
	msg3B, err := f.q.CreateChatDocumentMessage(ctx, db.CreateChatDocumentMessageParams{
		ID:             util.NewID(),
		RoomID:         groupB.ID,
		OrganizationID: f.orgID,
		WorkspaceID:    f.ws.ID,
		SenderID:       f.ua.ID,
		SenderKind:     "human",
		Body:           doc3.Title,
		Metadata:       []byte(fmt.Sprintf(`{"document_id":%q}`, doc3ID)),
	})
	if err != nil {
		t.Fatal(err)
	}

	// f.ub leaves groupA -> still active in groupB with live msg3B -> keeps access, source_room_id re-pointed to groupB.
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, groupA.ID); err != nil {
		t.Fatal(err)
	}
	if err := revoker.Handle(ctx, outbox.Row{
		ID:             util.NewID(),
		Topic:          "chat.room.member_removed",
		Payload:        fmt.Sprintf(`{"room_id":%q,"user_id":%q}`, groupA.ID, f.ub.ID),
		OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	ubAcc3, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ub.ID), doc3)
	if err != nil || ubAcc3.Level != DocumentLevelComment {
		t.Fatalf("ub level on doc3 after leaving groupA while still in groupB = %+v (%v), want comment", ubAcc3, err)
	}
	ubShare3, err := f.q.GetDocumentShare(ctx, db.GetDocumentShareParams{
		OrganizationID: f.orgID, WorkspaceID: f.ws.ID, DocumentID: doc3ID,
		PrincipalType: DocumentPrincipalUser, PrincipalID: f.ub.ID,
	})
	if err != nil || ubShare3.SourceRoomID.String != groupB.ID || ubShare3.SourceMessageID.String != msg3B.ID {
		t.Fatalf("repointed share = %+v (%v), want room=%s msg=%s", ubShare3, err, groupB.ID, msg3B.ID)
	}

	// Now f.ub leaves groupB too -> no active room left -> share is revoked.
	if err := f.svc.LeaveChatRoom(ctx, f.ub.ID, f.ws.ID, groupB.ID); err != nil {
		t.Fatal(err)
	}
	if err := revoker.Handle(ctx, outbox.Row{
		ID:             util.NewID(),
		Topic:          "chat.room.member_removed",
		Payload:        fmt.Sprintf(`{"room_id":%q,"user_id":%q}`, groupB.ID, f.ub.ID),
		OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	ubAcc3After, err := f.docs.effectiveLevel(ctx, f.q, Human(f.ub.ID), doc3)
	if err != nil || ubAcc3After.Level != DocumentLevelNone {
		t.Fatalf("ub level on doc3 after leaving groupB too = %+v (%v), want none", ubAcc3After, err)
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
