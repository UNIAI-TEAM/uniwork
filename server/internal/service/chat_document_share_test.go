package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// releaseRecordingFiles records every ReleaseInTx the chat service makes, so a
// test can see which references a command dropped; the files fake only keeps
// that bit privately.
type releaseRecordingFiles struct {
	files.Service
	mu  sync.Mutex
	ids []files.FileID
}

func (r *releaseRecordingFiles) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	r.mu.Lock()
	r.ids = append(r.ids, ids...)
	r.mu.Unlock()
	return r.Service.ReleaseInTx(ctx, q, ids)
}

func (r *releaseRecordingFiles) released() []files.FileID {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]files.FileID(nil), r.ids...)
}

// TestCanShareAsDocumentViewerFlag is the L6 read test: can_share_as_document
// is true only for the sender on an allowlisted live file message that has not
// been converted yet; another member sees false, a PNG sees false, and after
// conversion the message is kind="document" and the flag is false.
func TestCanShareAsDocumentViewerFlag(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	mdBody := []byte("# Kế hoạch\n\n- một\n- hai\n")
	mdMsg, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "ke-hoach.md",
		Body:        bytes.NewReader(mdBody),
		ClientMsgID: "l6-file-md-1",
	})
	if err != nil {
		t.Fatalf("send md file: %v", err)
	}
	pngMsg, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "pixel.png",
		Body:        bytes.NewReader(pngHeaderBytes()),
		ClientMsgID: "l6-file-png-1",
	})
	if err != nil {
		t.Fatalf("send png file: %v", err)
	}

	// Sender sees true on the allowlisted Markdown attachment and false on the PNG.
	senderRows, err := f.svc.ListRoomMessages(ctx, f.ua.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("sender list: %v", err)
	}
	senderMD := messageRowOf(t, senderRows, mdMsg.ID)
	if !senderMD.CanShareAsDocument {
		t.Fatalf("sender can_share_as_document on md = false, want true")
	}
	senderPNG := messageRowOf(t, senderRows, pngMsg.ID)
	if senderPNG.CanShareAsDocument {
		t.Fatalf("sender can_share_as_document on png = true, want false (L8)")
	}

	// Another room member sees false on both.
	receiverRows, err := f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("receiver list: %v", err)
	}
	receiverMD := messageRowOf(t, receiverRows, mdMsg.ID)
	if receiverMD.CanShareAsDocument {
		t.Fatalf("receiver can_share_as_document = true, want false")
	}

	// After conversion, the message is kind="document" and can_share_as_document is false.
	converted, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, mdMsg.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "l6-convert-1",
	})
	if err != nil {
		t.Fatalf("convert: %v", err)
	}
	if converted.Kind != "document" || converted.CanShareAsDocument {
		t.Fatalf("converted = %+v, want kind=document and CanShareAsDocument=false", converted)
	}
	senderRows, err = f.svc.ListRoomMessages(ctx, f.ua.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("sender list after convert: %v", err)
	}
	afterMD := messageRowOf(t, senderRows, mdMsg.ID)
	if afterMD.Kind != "document" || afterMD.CanShareAsDocument {
		t.Fatalf("after convert row = %+v, want kind=document and CanShareAsDocument=false", afterMD)
	}
}

// TestShareAttachmentAsDocument is §7.1 test 9 + UNI-2012 D1a: an old
// kind='file' message is converted by its sender into a Document at the
// root of the sender's workspace from a copy of the bytes, grants the room's
// members, flips the message to kind='document' in place keeping the same
// message id, body and client_msg_id, releases the old chat_attachment
// reference, and emits chat.message.updated.
func TestShareAttachmentAsDocument(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)
	rel := &releaseRecordingFiles{Service: f.files}
	f.svc.SetFiles(rel)

	rawBody := []byte("# Báo cáo quý 4\n\nNội dung chi tiết.\n")
	orig, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "bao-cao-q4.md",
		Body:        bytes.NewReader(rawBody),
		ClientMsgID: "orig-file-msg-1",
	})
	if err != nil {
		t.Fatalf("send file: %v", err)
	}
	if orig.Kind != "file" || orig.File == nil || orig.File.FileID == "" {
		t.Fatalf("orig = %+v, want file message with file_id", orig)
	}
	origFileID := orig.File.FileID
	// A reaction from the receiver and a pin from the sender live in the
	// message metadata; converting the attachment must not drop them (BE-CDS-1).
	if _, err := f.svc.ToggleChatMessageReaction(ctx, f.ub.ID, f.ws.ID, room.ID, orig.ID, "👍"); err != nil {
		t.Fatalf("react: %v", err)
	}
	if _, err := f.svc.ToggleChatMessagePin(ctx, f.ua.ID, f.ws.ID, room.ID, orig.ID); err != nil {
		t.Fatalf("pin: %v", err)
	}
	f.pub.events = nil

	converted, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "share-as-doc-1",
	})
	if err != nil {
		t.Fatalf("share as document: %v", err)
	}
	if converted.ID != orig.ID {
		t.Fatalf("message id = %q, want %q (in-place update)", converted.ID, orig.ID)
	}
	if converted.ClientMsgID != "orig-file-msg-1" {
		t.Fatalf("client_msg_id = %q, want orig-file-msg-1 untouched", converted.ClientMsgID)
	}
	if converted.Body != orig.Body {
		t.Fatalf("body = %q, want %q untouched", converted.Body, orig.Body)
	}
	if converted.Kind != "document" || converted.File != nil || converted.CanShareAsDocument {
		t.Fatalf("converted = %+v, want kind=document with no File block", converted)
	}
	if converted.Document == nil || converted.Document.DocumentID == "" {
		t.Fatalf("document block = %+v", converted.Document)
	}
	if converted.Document.Level != string(DocumentLevelManage) || !converted.Document.CanManage {
		t.Fatalf("sender block = %+v, want manage", converted.Document)
	}

	if converted.Reactions["👍"] != 1 || len(converted.MyReactions) != 0 || !converted.Pinned {
		t.Fatalf("converted reactions = %v mine = %v pinned = %v, want the reaction and the pin kept",
			converted.Reactions, converted.MyReactions, converted.Pinned)
	}
	var metaRaw []byte
	if err := f.pool.QueryRow(ctx, `SELECT metadata FROM chat_messages WHERE id = $1`, orig.ID).Scan(&metaRaw); err != nil {
		t.Fatal(err)
	}
	var meta map[string]json.RawMessage
	if err := json.Unmarshal(metaRaw, &meta); err != nil {
		t.Fatalf("metadata %s: %v", metaRaw, err)
	}
	for _, key := range []string{"filename", "file_id", "object_key", "content_type", "size_bytes"} {
		if _, ok := meta[key]; ok {
			t.Fatalf("metadata still carries file key %q: %s", key, metaRaw)
		}
	}
	for _, key := range []string{"document_id", "reactions", "pinned"} {
		if _, ok := meta[key]; !ok {
			t.Fatalf("metadata lost %q: %s", key, metaRaw)
		}
	}

	doc, err := f.q.GetDocumentByID(ctx, converted.Document.DocumentID)
	if err != nil {
		t.Fatalf("get document: %v", err)
	}
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

	// Bytes are copied into a new document_file object, and the old
	// chat_attachment reference on chat_messages is dropped.
	ver, err := f.docs.currentFileVersion(ctx, f.q, doc)
	if err != nil || ver == nil || !ver.FileID.Valid {
		t.Fatalf("currentFileVersion = %+v, %v", ver, err)
	}
	if ver.FileID.String == origFileID {
		t.Fatalf("document version reuses chat_attachment file_id %q; want a copy", origFileID)
	}
	rd, err := f.files.Open(ctx, files.OpenInput{
		Scope:  documentScope(f.orgID, f.ws.ID),
		FileID: files.FileID(ver.FileID.String),
	})
	if err != nil {
		t.Fatalf("open copied document file: %v", err)
	}
	copiedBytes, err := io.ReadAll(rd.Body)
	_ = rd.Close()
	if err != nil || !bytes.Equal(copiedBytes, rawBody) {
		t.Fatalf("copied bytes = %q (%v), want %q", copiedBytes, err, rawBody)
	}
	var storedFileID *string
	if err := f.pool.QueryRow(ctx, `SELECT file_id FROM chat_messages WHERE id = $1`, orig.ID).Scan(&storedFileID); err != nil {
		t.Fatal(err)
	}
	if storedFileID != nil {
		t.Fatalf("chat_messages.file_id = %q after conversion, want NULL", *storedFileID)
	}
	// The chat reference is released for the attachment's own object and never
	// for the document's copy (BE-CDS-10, Q2).
	if got := rel.released(); len(got) != 1 || got[0] != files.FileID(origFileID) {
		t.Fatalf("released file ids = %v, want exactly [%s]", got, origFileID)
	}

	// Grants: only the other human member at comment; never the sender; never a folder (UNI-1974).
	shares := f.liveSharesOfDocument(t, doc.ID)
	if len(shares) != 1 || shares[0].PrincipalID != f.ub.ID || shares[0].Level != "comment" {
		t.Fatalf("shares = %+v, want 1 share for ub at comment", shares)
	}
	for _, sh := range shares {
		if sh.DocumentID != doc.ID {
			t.Fatalf("unexpected share target: %+v", sh)
		}
	}

	// Emits chat.message.updated after commit.
	if countEvents(f.pub.events, "chat.message.updated") < 1 {
		t.Fatalf("published events = %+v, want chat.message.updated", f.pub.events)
	}
}

// TestShareAttachmentAsDocumentReplayAndErrors is §7.1 test 10 + L1:
// any second call by the sender on an already converted message answers 200
// with the same message + document (whatever client_msg_id or share_level, no
// 409 already_linked, one document per attachment ever); non-sender -> 403;
// non-allowlisted attachment -> 422 source_not_saveable; deleted message -> 404;
// forced failure in tx leaves the message as kind='file' with 0 documents.
func TestShareAttachmentAsDocumentReplayAndErrors(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	orig, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "ke-hoach.md",
		Body:        bytes.NewReader([]byte("# Kế hoạch\n")),
		ClientMsgID: "replay-file-1",
	})
	if err != nil {
		t.Fatalf("send file: %v", err)
	}

	first, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "share-key-1",
	})
	if err != nil {
		t.Fatalf("first conversion: %v", err)
	}

	// Replay with the same client_msg_id -> 200, same message + document.
	second, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "share-key-1",
	})
	if err != nil {
		t.Fatalf("replay same key: %v", err)
	}
	if second.ID != first.ID || second.Document == nil || second.Document.DocumentID != first.Document.DocumentID {
		t.Fatalf("replay same key = %+v, want %s/%s", second, first.ID, first.Document.DocumentID)
	}

	// L1: a second call with a new client_msg_id and a different share_level
	// answers 200 with the same message + document, ignoring the new level.
	third, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "view",
		ClientMsgID: "share-key-2",
	})
	if err != nil {
		t.Fatalf("replay new key: %v", err)
	}
	if third.ID != first.ID || third.Document == nil || third.Document.DocumentID != first.Document.DocumentID {
		t.Fatalf("replay new key = %+v, want %s/%s", third, first.ID, first.Document.DocumentID)
	}
	if shares := f.liveSharesOfDocument(t, first.Document.DocumentID); len(shares) != 1 || shares[0].Level != "comment" {
		t.Fatalf("shares after L1 replay = %+v, want original comment level preserved", shares)
	}
	if got := f.fileDocumentsCount(t); got != 1 {
		t.Fatalf("documents after sequential replays = %d, want 1", got)
	}

	// Concurrent/in-flight second call on one attachment: both pass the pre-upload
	// read while the row is still kind='file'; the row lock + in-tx replay guard
	// ensures only one document is created for the attachment.
	raceFile, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "race.md",
		Body:        bytes.NewReader([]byte("# Race\n")),
		ClientMsgID: "race-file-1",
	})
	if err != nil {
		t.Fatalf("send race file: %v", err)
	}
	var winner ChatMessageRow
	hookRan := false
	chatAttachmentShareBeforeLock = func() {
		if hookRan {
			return
		}
		hookRan = true
		var werr error
		winner, werr = f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, raceFile.ID, ShareAttachmentAsDocumentInput{
			ShareLevel:  "edit",
			ClientMsgID: "race-key-winner",
		})
		if werr != nil {
			t.Errorf("concurrent winner failed: %v", werr)
		}
	}
	loser, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, raceFile.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "view",
		ClientMsgID: "race-key-loser",
	})
	chatAttachmentShareBeforeLock = nil
	if err != nil {
		t.Fatalf("concurrent loser: %v", err)
	}
	if loser.Document == nil || winner.Document == nil || loser.Document.DocumentID != winner.Document.DocumentID {
		t.Fatalf("concurrent calls produced different documents: winner=%+v loser=%+v", winner.Document, loser.Document)
	}
	if got := f.fileDocumentsCount(t); got != 2 {
		t.Fatalf("total file documents after 2 attachments = %d, want 2 (one per attachment)", got)
	}

	// Non-sender -> 403.
	otherFile, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "other.md",
		Body:        bytes.NewReader([]byte("# Other\n")),
		ClientMsgID: "other-file-1",
	})
	if err != nil {
		t.Fatalf("send other file: %v", err)
	}
	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ub.ID, f.ws.ID, room.ID, otherFile.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "non-sender-1",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-sender conversion = %v, want ErrForbidden", err)
	}

	// Non-allowlisted attachment (PNG is off L8's ChatDocumentMIMETypes) -> 422 source_not_saveable.
	pngFile, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "pixel.png",
		Body:        bytes.NewReader(pngHeaderBytes()),
		ClientMsgID: "png-file-1",
	})
	if err != nil {
		t.Fatalf("send png: %v", err)
	}
	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, pngFile.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "png-share-1",
	}); err == nil {
		t.Fatal("PNG attachment was converted to a document")
	} else if ce := wantCode(t, err, "source_not_saveable"); ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("png status = %d, want 422", ce.Status)
	}

	// Deleted message -> 404.
	delFile, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, room.ID, SendFileMessageInput{
		Filename:    "delete-me.md",
		Body:        bytes.NewReader([]byte("# Delete\n")),
		ClientMsgID: "del-file-1",
	})
	if err != nil {
		t.Fatalf("send del file: %v", err)
	}
	if err := f.svc.DeleteChatMessage(ctx, f.ua.ID, f.ws.ID, room.ID, delFile.ID); err != nil {
		t.Fatalf("delete file message: %v", err)
	}
	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, delFile.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "del-share-1",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted message conversion = %v, want ErrNotFound", err)
	}

	// Forced failure inside the transaction leaves the message as kind='file'
	// and creates no document (Red proof a).
	chatDocumentShareFault = func() error { return errors.New("forced fault after document create") }
	defer func() { chatDocumentShareFault = nil }()
	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, room.ID, otherFile.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "fault-share-1",
	}); err == nil {
		t.Fatal("forced fault did not fail ShareAttachmentAsDocument")
	}
	chatDocumentShareFault = nil
	msgAfterFault, err := f.svc.GetRoomMessage(ctx, f.ua.ID, f.ws.ID, room.ID, otherFile.ID)
	if err != nil {
		t.Fatalf("get message after fault: %v", err)
	}
	if msgAfterFault.Kind != "file" {
		t.Fatalf("message kind after rollback = %q, want file", msgAfterFault.Kind)
	}
	if got := f.fileDocumentsCount(t); got != 2 {
		t.Fatalf("documents after fault rollback = %d, want 2", got)
	}
}

// TestDocumentVersionLineOnlyFromTheCard is §7.1 test 12: a commit with
// chat_room_id writes one document_version message in that room in the commit's
// transaction; a commit without it writes none; a commit naming a room with no
// live card for this document commits and writes none; a commit naming a room
// the caller may not send in commits and writes none; a failed commit writes none.
func TestDocumentVersionLineOnlyFromTheCard(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	in := documentMessageInput("ver-doc-1")
	in.ShareLevel = "edit"
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, in)
	if err != nil {
		t.Fatalf("send document: %v", err)
	}
	docID := sent.Document.DocumentID
	f.pub.events = nil

	// 1. Commit with chat_room_id naming the room that holds the card -> writes
	// one document_version message in the commit tx and publishes chat.message.created.
	up2, err := f.docs.UploadDocumentFile(ctx, Human(f.ua.ID), docID, DocumentUploadInput{
		Filename:       "ke-hoach.md",
		Body:           bytes.NewReader([]byte("# Kế hoạch v2\n")),
		IdempotencyKey: "up-v2",
	})
	if err != nil {
		t.Fatalf("upload v2: %v", err)
	}
	v2, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, CommitFileVersionInput{
		UploadID:       up2.UploadID,
		BaseRevision:   1,
		IdempotencyKey: "commit-v2",
		ChatRoomID:     room.ID,
	})
	if err != nil {
		t.Fatalf("commit v2: %v", err)
	}
	if v2.Version.Version != 2 {
		t.Fatalf("version = %d, want 2", v2.Version.Version)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document_version"); got != 1 {
		t.Fatalf("document_version messages in room = %d, want 1", got)
	}
	if countEvents(f.pub.events, "chat.message.created") < 1 {
		t.Fatalf("published events = %+v, want chat.message.created for the version line", f.pub.events)
	}
	rows, err := f.svc.ListRoomMessages(ctx, f.ub.ID, f.ws.ID, room.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("list room messages: %v", err)
	}
	var verRow *ChatMessageRow
	for i := range rows {
		if rows[i].Kind == "document_version" {
			verRow = &rows[i]
			break
		}
	}
	if verRow == nil {
		t.Fatal("document_version row missing from room messages")
	}
	if verRow.Body != "2" {
		t.Fatalf("version line body = %q, want \"2\"", verRow.Body)
	}
	if verRow.Document == nil || verRow.Document.DocumentID != docID || verRow.Document.VersionID != v2.Version.ID || verRow.Document.VersionNumber != 2 {
		t.Fatalf("version line document block = %+v, want doc=%s ver=%s no=2", verRow.Document, docID, v2.Version.ID)
	}

	// 2. Commit without chat_room_id -> writes no version line.
	up3, err := f.docs.UploadDocumentFile(ctx, Human(f.ua.ID), docID, DocumentUploadInput{
		Filename:       "ke-hoach.md",
		Body:           bytes.NewReader([]byte("# Kế hoạch v3\n")),
		IdempotencyKey: "up-v3",
	})
	if err != nil {
		t.Fatalf("upload v3: %v", err)
	}
	v3, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, CommitFileVersionInput{
		UploadID:       up3.UploadID,
		BaseRevision:   v2.Document.Revision,
		IdempotencyKey: "commit-v3",
	})
	if err != nil {
		t.Fatalf("commit v3: %v", err)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document_version"); got != 1 {
		t.Fatalf("document_version messages after commit without chat_room_id = %d, want 1", got)
	}

	// 3. Commit naming another room the caller CAN send in, but which holds NO
	// live document card for this document -> commits normally and writes no line (Red proof b).
	uc := registerVerified(t, f.q, NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chatdoc-ver-c@example.com", "C")
	addOrgMember(t, f.q, f.orgID, uc.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uc.ID)
	otherRoom, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{
		Name:          "no-card-room",
		MemberUserIDs: []string{f.ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	up4, err := f.docs.UploadDocumentFile(ctx, Human(f.ua.ID), docID, DocumentUploadInput{
		Filename:       "ke-hoach.md",
		Body:           bytes.NewReader([]byte("# Kế hoạch v4\n")),
		IdempotencyKey: "up-v4",
	})
	if err != nil {
		t.Fatalf("upload v4: %v", err)
	}
	v4, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, CommitFileVersionInput{
		UploadID:       up4.UploadID,
		BaseRevision:   v3.Document.Revision,
		IdempotencyKey: "commit-v4",
		ChatRoomID:     otherRoom.ID,
	})
	if err != nil {
		t.Fatalf("commit v4 with no-card room: %v", err)
	}
	if got := f.chatMessagesOfKind(t, otherRoom.ID, "document_version"); got != 0 {
		t.Fatalf("document_version messages in room without card = %d, want 0", got)
	}

	// 4. Commit naming a room the caller may NOT send in -> commits normally and writes no line.
	if _, err := f.pool.Exec(ctx, `UPDATE chat_room_members SET send_restricted = true WHERE room_id = $1 AND user_id = $2`, room.ID, f.ub.ID); err != nil {
		t.Fatal(err)
	}
	up5, err := f.docs.UploadDocumentFile(ctx, Human(f.ub.ID), docID, DocumentUploadInput{
		Filename:       "ke-hoach.md",
		Body:           bytes.NewReader([]byte("# Kế hoạch v5\n")),
		IdempotencyKey: "up-v5",
	})
	if err != nil {
		t.Fatalf("upload v5: %v", err)
	}
	if _, err := f.docs.CommitFileVersion(ctx, Human(f.ub.ID), docID, CommitFileVersionInput{
		UploadID:       up5.UploadID,
		BaseRevision:   v4.Document.Revision,
		IdempotencyKey: "commit-v5",
		ChatRoomID:     room.ID,
	}); err != nil {
		t.Fatalf("commit v5 by send-restricted member failed save: %v", err)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document_version"); got != 1 {
		t.Fatalf("document_version messages after send-restricted commit = %d, want 1", got)
	}
}

// TestDocumentVersionLineReplaySafe is §7.1 test 13: a replayed commit
// (Idempotency-Key) writes no second document_version line.
func TestDocumentVersionLineReplaySafe(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	room := f.dm(t)

	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, room.ID, documentMessageInput("ver-replay-doc-1"))
	if err != nil {
		t.Fatalf("send document: %v", err)
	}
	docID := sent.Document.DocumentID

	up2, err := f.docs.UploadDocumentFile(ctx, Human(f.ua.ID), docID, DocumentUploadInput{
		Filename:       "ke-hoach.md",
		Body:           bytes.NewReader([]byte("# Kế hoạch v2 replay\n")),
		IdempotencyKey: "up-replay-v2",
	})
	if err != nil {
		t.Fatalf("upload v2: %v", err)
	}
	commitIn := CommitFileVersionInput{
		UploadID:       up2.UploadID,
		BaseRevision:   1,
		IdempotencyKey: "commit-replay-v2",
		ChatRoomID:     room.ID,
	}
	first, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, commitIn)
	if err != nil {
		t.Fatalf("first commit: %v", err)
	}
	second, err := f.docs.CommitFileVersion(ctx, Human(f.ua.ID), docID, commitIn)
	if err != nil {
		t.Fatalf("replayed commit: %v", err)
	}
	if second.Version.ID != first.Version.ID {
		t.Fatalf("replayed version id = %q, want %q", second.Version.ID, first.Version.ID)
	}
	if got := f.chatMessagesOfKind(t, room.ID, "document_version"); got != 1 {
		t.Fatalf("document_version messages after replay = %d, want 1", got)
	}
}

func messageRowOf(t *testing.T, rows []ChatMessageRow, messageID string) ChatMessageRow {
	t.Helper()
	for _, row := range rows {
		if row.ID == messageID {
			return row
		}
	}
	t.Fatalf("message %s not found in page", messageID)
	return ChatMessageRow{}
}

func (f *chatDocumentFixture) fileDocumentsCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'file' AND system_kind IS NULL`,
		f.ws.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestShareAttachmentAsDocumentRefusesOverCapRoom is BE-CDS-11 (share half): a
// room whose grantable audience is over the batch cap refuses the conversion
// with 422 share_batch_too_large, creates no document and leaves the message a
// file.
func TestShareAttachmentAsDocumentRefusesOverCapRoom(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()

	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ids := []string{f.ub.ID}
	for i := range maxDocumentShareBatch {
		u := registerVerified(t, f.q, as, fmt.Sprintf("chatdoc-sharecap-%d@example.com", i), fmt.Sprintf("Cap %d", i))
		addOrgMember(t, f.q, f.orgID, u.ID)
		addWorkspaceMember(t, f.q, f.ws.ID, u.ID)
		ids = append(ids, u.ID)
	}
	group, err := f.svc.CreateGroup(ctx, f.ua.ID, f.ws.ID, CreateGroupInput{Name: "big", MemberUserIDs: ids})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	orig, err := f.svc.SendFileMessage(ctx, f.ua.ID, f.ws.ID, group.ID, SendFileMessageInput{
		Filename:    "big-room.md",
		Body:        bytes.NewReader([]byte("# Big room\n")),
		ClientMsgID: "big-room-file-1",
	})
	if err != nil {
		t.Fatalf("send file: %v", err)
	}

	if _, err := f.svc.ShareAttachmentAsDocument(ctx, f.ua.ID, f.ws.ID, group.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "big-room-share-1",
	}); err == nil {
		t.Fatal("an over-cap room converted an attachment to a document")
	} else if ce := wantCode(t, err, "share_batch_too_large"); ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", ce.Status)
	}
	if got := f.fileDocumentsCount(t); got != 0 {
		t.Fatalf("documents after the refusal = %d, want 0", got)
	}
	if got := f.chatMessagesOfKind(t, group.ID, "file"); got != 1 {
		t.Fatalf("file messages after the refusal = %d, want 1 (still kind=file)", got)
	}
	if got := f.chatMessagesOfKind(t, group.ID, "document"); got != 0 {
		t.Fatalf("document messages after the refusal = %d, want 0", got)
	}
}

// TestShareAttachmentAsDocumentCrossWorkspace proves D1a, D1b and R3 on the
// share-as-document conversion path: a sender in workspace B converts their
// attachment in a DM anchored in workspace A into a root document in
// workspace B, and the recipient in workspace A receives access.
func TestShareAttachmentAsDocumentCrossWorkspace(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	as := NewAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	wsBView, err := f.svc.ws.CreateInOrg(ctx, f.ua.ID, f.orgID, "Share WS B", "share-ws-b")
	if err != nil {
		t.Fatalf("create ws B: %v", err)
	}
	wsB := wsBView.Workspace

	uA := registerVerified(t, f.q, as, "chatshare-xw-a@example.com", "Share A")
	uB := registerVerified(t, f.q, as, "chatshare-xw-b@example.com", "Share B")
	addOrgMember(t, f.q, f.orgID, uA.ID)
	addWorkspaceMember(t, f.q, f.ws.ID, uA.ID)
	addOrgMember(t, f.q, f.orgID, uB.ID)
	addWorkspaceMember(t, f.q, wsB.ID, uB.ID)

	dmSum, err := f.svc.ResolveDM(ctx, uA.ID, f.ws.ID, uB.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	orig, err := f.svc.SendFileMessage(ctx, uB.ID, wsB.ID, dmSum.ID, SendFileMessageInput{
		Filename:    "xw-note.md",
		Body:        bytes.NewReader([]byte("# Cross-workspace note\n")),
		ClientMsgID: "xw-file-1",
	})
	if err != nil {
		t.Fatalf("send file from ws B: %v", err)
	}
	converted, err := f.svc.ShareAttachmentAsDocument(ctx, uB.ID, wsB.ID, dmSum.ID, orig.ID, ShareAttachmentAsDocumentInput{
		ShareLevel:  "comment",
		ClientMsgID: "xw-share-1",
	})
	if err != nil {
		t.Fatalf("share attachment from ws B: %v", err)
	}
	doc, err := f.q.GetDocumentByID(ctx, converted.Document.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	if doc.WorkspaceID != wsB.ID {
		t.Fatalf("doc.WorkspaceID = %q, want %q", doc.WorkspaceID, wsB.ID)
	}
	if doc.ParentID.Valid || doc.OwnerKind.Valid || doc.AclOwnerID.String != uB.ID {
		t.Fatalf("doc = %+v, want root document owned by uB with no owner_kind", doc)
	}
	rows, err := f.svc.ListRoomMessages(ctx, uA.ID, f.ws.ID, dmSum.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("uA list messages: %v", err)
	}
	block := documentBlockOf(t, rows, converted.ID)
	if block == nil || !block.HasAccess || block.Level != "comment" {
		t.Fatalf("uA card block = %+v, want HasAccess=true Level=comment", block)
	}
}
