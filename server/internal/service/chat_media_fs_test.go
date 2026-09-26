package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FileService-path coverage for chat file + voice messages (UNI-745). The
// Advisor ruling keeps the legacy path byte-identical and green under the
// Bước 0 net; these tests wire filesfake and prove the FS path: upload ->
// claim-in-transaction -> message row, release on delete, proxy open, and the
// reference provider the collector consults.

// tinyFSFileBytes satisfies the verified-type check the fake runs on upload:
// DetectContentType reports %PDF- as application/pdf, which the
// chat_attachment policy allows.
var tinyFSFileBytes = []byte("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n")

// tinyFSVoiceBytes carries the EBML container magic a browser voice note
// starts with. Until t1c-content-detect lands the fake's sniffer reports it
// as video/webm or octet-stream, so happy-path voice uploads stay skipped.
var tinyFSVoiceBytes = []byte{0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x00, 0x00, 0x00, 0x00}

// chatFixtureFiles wires the in-memory FileService the FS-path tests need.
func chatFixtureFiles(t *testing.T) (*ChatService, *capturePublisher, *db.Queries, db.User, db.User, db.Workspace) {
	s, pub, q, ua, ub, w := chatFixture(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	return s, pub, q, ua, ub, w
}

// skipVoiceUploadUntilT1C marks the assertions that need the shared content
// detector (lane t1c-content-detect, UNI-739): filesfake's raw
// http.DetectContentType can never produce the audio/* allowlist, so a real
// voice upload is refused with file_type_rejected until that merge lands.
func skipVoiceUploadUntilT1C(t *testing.T, err error) {
	t.Helper()
	if codedIs(err, files.CodeTypeRejected) {
		t.Skip("voice upload refused by the raw sniffer: pending t1c-content-detect (UNI-739) merge")
	}
}

// lookupPurposeSpec reads the registry row a chat purpose declares.
func lookupPurposeSpec(t *testing.T, purpose files.UploadPurpose) files.PurposeSpec {
	t.Helper()
	spec, err := files.DefaultRegistry().Lookup(purpose)
	if err != nil {
		t.Fatalf("registry lookup %s: %v", purpose, err)
	}
	return spec
}

// The FS path verifies bytes against the purpose policy, so the transport
// caps and allowlists must not drift from the registry rows (one declaration
// of the same limits).
func TestChatMediaRegistrySpecsMatchChatCaps(t *testing.T) {
	t.Parallel()

	attach := lookupPurposeSpec(t, files.ChatAttachment)
	if attach.Policy.MaxBytes != MaxChatFileMessageBytes {
		t.Fatalf("chat_attachment policy cap = %d, want %d", attach.Policy.MaxBytes, int64(MaxChatFileMessageBytes))
	}
	if attach.Policy.ReadMode != files.ReadProxy {
		t.Fatalf("chat_attachment read mode = %s, want proxy", attach.Policy.ReadMode)
	}
	if attach.Scope != files.ScopeOrgWorkspaceOptional {
		t.Fatalf("chat_attachment scope = %s, want org_workspace_optional", attach.Scope)
	}
	for _, mime := range []string{"image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "text/plain"} {
		if !attach.Policy.Allows(mime) {
			t.Fatalf("chat_attachment allowlist is missing %q", mime)
		}
	}

	voice := lookupPurposeSpec(t, files.ChatVoice)
	if voice.Policy.MaxBytes != MaxChatVoiceMessageBytes {
		t.Fatalf("chat_voice policy cap = %d, want %d", voice.Policy.MaxBytes, int64(MaxChatVoiceMessageBytes))
	}
	if voice.Scope != files.ScopeOrgWorkspaceOptional {
		t.Fatalf("chat_voice scope = %s, want org_workspace_optional", voice.Scope)
	}
	for _, mime := range []string{"audio/webm", "audio/ogg", "audio/mp4"} {
		if !voice.Policy.Allows(mime) {
			t.Fatalf("chat_voice allowlist is missing %q", mime)
		}
	}
}

// An FS send stores the file_id in the column and in the metadata snapshot;
// the metadata never carries a storage locator.
func TestChatMessageMetadataStoresFileIDFS(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "ke-hoach.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-pin-file-1",
	})
	if err != nil {
		t.Fatalf("send file: %v", err)
	}
	if row.File == nil || row.File.FileID == "" {
		t.Fatalf("row.File = %#v, want a file_id reference", row.File)
	}
	if row.File.ObjectKey != "" {
		t.Fatalf("row.File.ObjectKey = %q: post-T7 rows never carry a storage locator", row.File.ObjectKey)
	}

	stored, err := q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: row.ID, RoomID: dm.ID, WorkspaceID: w.ID,
	})
	if err != nil {
		t.Fatalf("stored row: %v", err)
	}
	if !stored.FileID.Valid || stored.FileID.String != row.File.FileID {
		t.Fatalf("stored file_id column = %v, want %q", stored.FileID, row.File.FileID)
	}
	var meta map[string]any
	if err := json.Unmarshal(stored.Metadata, &meta); err != nil {
		t.Fatalf("metadata json: %v (%s)", err, stored.Metadata)
	}
	if _, leaked := meta["object_key"]; leaked {
		t.Fatalf("metadata carries a storage locator: %v", meta)
	}
	if got, _ := meta["file_id"].(string); got != row.File.FileID {
		t.Fatalf("metadata file_id = %q, want %q", got, row.File.FileID)
	}
	if meta["content_type"] != "application/pdf" {
		t.Fatalf("metadata content_type = %v, want the verified application/pdf", meta["content_type"])
	}
}

// FS idempotency: a retry with the same client_msg_id replays the earlier
// message; a different payload under that key is idempotency_conflict.
func TestSendFileMessageClientMsgIDFS(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "bao-cao.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-same-key",
	})
	if err != nil {
		t.Fatalf("send first: %v", err)
	}
	createdEvents := countEvents(pub.events, "chat.message.created")

	retry, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "bao-cao.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-same-key",
	})
	if err != nil || retry.ID != row.ID {
		t.Fatalf("retry: err=%v row=%+v want id %s", err, retry, row.ID)
	}
	if countEvents(pub.events, "chat.message.created") != createdEvents {
		t.Fatalf("replay republished chat.message.created: %v", pub.events)
	}

	// Different filename under the same key: the FS upload key binds the
	// command, so this is idempotency_conflict.
	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "khac.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-same-key",
	})
	if !codedIs(err, files.CodeIdempotencyConflict) {
		t.Fatalf("different filename under the same key = %v, want idempotency_conflict", err)
	}
	// Different bytes, same filename: also a different command.
	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "bao-cao.pdf", Body: bytes.NewReader(append(append([]byte{}, tinyFSFileBytes...), 0x0a)), ClientMsgID: "fs-same-key",
	})
	if !codedIs(err, files.CodeIdempotencyConflict) {
		t.Fatalf("different bytes under the same key = %v, want idempotency_conflict", err)
	}

	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	fileCount := 0
	for _, m := range msgs {
		if m.Kind == "file" {
			fileCount++
		}
	}
	if fileCount != 1 {
		t.Fatalf("file messages in room = %d, want 1 (client_msg_id must not duplicate)", fileCount)
	}

	// The key is scoped per (room, sender): a text send that reuses the key
	// still returns the earlier message (unchanged legacy rule), while a file
	// send reusing a text key is a different command and conflicts.
	textRow, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{
		Body: "text with the same id", ClientMsgID: "fs-same-key",
	})
	if err != nil || textRow.ID != row.ID || textRow.Kind != "file" {
		t.Fatalf("text reuse of the file key: err=%v row=%+v want the file message %s", err, textRow, row.ID)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{
		Body: "plain text", ClientMsgID: "fs-text-key",
	}); err != nil {
		t.Fatalf("send text: %v", err)
	}
	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "muon-mau.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-text-key",
	})
	if !codedIs(err, files.CodeIdempotencyConflict) {
		t.Fatalf("file send reusing a text key = %v, want idempotency_conflict", err)
	}
}

// Concurrent sends under the same client_msg_id produce exactly one row and
// one created event; losers replay or conflict, never duplicate.
func TestSendFileMessageConcurrentSameKeyFS(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	const callers = 4
	var wg sync.WaitGroup
	ids := make([]string, callers)
	errs := make([]error, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
				Filename: "cung-luc.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-race-key",
			})
			if err == nil {
				ids[i] = row.ID
			}
			errs[i] = err
		}(i)
	}
	wg.Wait()

	var winner string
	for i, err := range errs {
		if err != nil {
			if !codedIs(err, files.CodeIdempotencyConflict) {
				t.Fatalf("caller %d err = %v, want nil or idempotency_conflict", i, err)
			}
			continue
		}
		if winner == "" {
			winner = ids[i]
		} else if ids[i] != winner {
			t.Fatalf("two different message IDs won: %s vs %s", winner, ids[i])
		}
	}
	if winner == "" {
		t.Fatal("no send succeeded")
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	fileCount := 0
	for _, m := range msgs {
		if m.Kind == "file" {
			fileCount++
		}
	}
	if fileCount != 1 {
		t.Fatalf("file messages in room = %d, want 1", fileCount)
	}
	if countEvents(pub.events, "chat.message.created") != 1 {
		t.Fatalf("created events = %v, want exactly 1", pub.events)
	}
}

func TestSendFileMessageRequiresRoomMembershipAndHonoursDMBlockFS(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "chat-outsider-fs@example.com", "Outsider")
	addOrgMember(t, q, w.OrganizationID, outsider.ID)
	addWorkspaceMember(t, q, w.ID, outsider.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "rieng-tu.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-dm-file-1",
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	// A workspace member who is not in the DM cannot send, read or stream.
	_, err = s.SendFileMessage(ctx, outsider.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "x.pdf", Body: bytes.NewReader(tinyFSFileBytes),
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider send = %v, want ErrForbidden", err)
	}
	if _, err := s.GetFileMessage(ctx, outsider.ID, w.ID, dm.ID, row.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider file get = %v, want ErrForbidden", err)
	}
	if _, _, err := s.OpenChatFileMessage(ctx, outsider.ID, w.ID, dm.ID, row.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider file open = %v, want ErrForbidden", err)
	}
	if _, err := s.GetVoiceMessage(ctx, outsider.ID, w.ID, dm.ID, row.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider voice get = %v, want ErrForbidden", err)
	}

	// A DM peer who blocked the sender stops new file and voice uploads, and
	// the refusal lands before any byte reaches FileService.
	if err := s.BlockChatUser(ctx, ub.ID, w.ID, ua.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "sau-khi-block.pdf", Body: bytes.NewReader(tinyFSFileBytes),
	})
	if !codedIs(err, "chat_user_blocked") {
		t.Fatalf("file upload after block = %v, want chat_user_blocked", err)
	}
	_, err = s.SendVoiceMessage(ctx, ua.ID, w.ID, dm.ID, SendVoiceMessageInput{
		DurationMS: 100, Body: bytes.NewReader([]byte{0x1a, 0x45, 0xdf, 0xa3}),
	})
	if !codedIs(err, "chat_user_blocked") {
		t.Fatalf("voice upload after block = %v, want chat_user_blocked", err)
	}
}

// DeleteChatMessage releases the FileService reference in the same
// transaction: the provider sees the file held before the delete and free
// after it, and the message row keeps its file_id (soft delete, no rewrite).
func TestDeleteChatMessageReleasesFileReference(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "xoa-di.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-del-file-1",
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	fileID := files.FileID(row.File.FileID)

	provider := s.FileReferenceProvider()
	if provider.Name() != "chat.messages" {
		t.Fatalf("provider name = %q", provider.Name())
	}
	held, err := provider.HeldBy(ctx, q, []files.FileID{fileID})
	if err != nil {
		t.Fatalf("provider before delete: %v", err)
	}
	if held[fileID] != files.HoldActive {
		t.Fatalf("provider held = %v, want active hold on %s", held, fileID)
	}

	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, dm.ID, row.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}

	held, err = provider.HeldBy(ctx, q, []files.FileID{fileID})
	if err != nil {
		t.Fatalf("provider after delete: %v", err)
	}
	if len(held) != 0 {
		t.Fatalf("provider held = %v after delete, want released", held)
	}
	// Live-row queries filter soft-deleted rows, so the soft-delete check goes
	// straight to the table: the row keeps its file_id after the release.
	var deletedAt *time.Time
	var storedFileID *string
	if err := pool.QueryRow(ctx,
		"SELECT deleted_at, file_id FROM chat_messages WHERE id = $1", row.ID,
	).Scan(&deletedAt, &storedFileID); err != nil {
		t.Fatalf("deleted row read: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("deleted message must still be a soft delete")
	}
	if storedFileID == nil || *storedFileID != row.File.FileID {
		t.Fatalf("deleted row file_id = %v, want %q (kept for audit)", storedFileID, row.File.FileID)
	}

	// Re-deleting the same row is already-deleted, not a second release.
	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, dm.ID, row.ID); err == nil {
		t.Fatal("double delete must fail")
	}
}

// A second member opens exactly the bytes the sender uploaded through
// FileService, and the file stays openable across a replayed send.
func TestOpenChatFileMessageStreamsVerifiedBytes(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	row, err := s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "tai-lieu.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fs-open-file-1",
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	got, reader, err := s.OpenChatFileMessage(ctx, ub.ID, w.ID, dm.ID, row.ID)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if reader.Body == nil {
		t.Fatal("open returned a legacy fallback for a post-T7 row")
	}
	defer reader.Close()
	data, err := io.ReadAll(reader.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(data, tinyFSFileBytes) {
		t.Fatalf("streamed %d bytes, want %d", len(data), len(tinyFSFileBytes))
	}
	if got.File == nil || got.File.ContentType != "application/pdf" || got.File.SizeBytes != int64(len(tinyFSFileBytes)) {
		t.Fatalf("row file view = %#v", got.File)
	}
	if reader.File.ContentType != "application/pdf" {
		t.Fatalf("verified content type = %q", reader.File.ContentType)
	}
}

// Input validation runs before FileService is consulted: a missing body or a
// malformed client_msg_id is a ValidationError even with no files wired.
func TestSendFileMessageValidationFS(t *testing.T) {
	t.Parallel()
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()

	var validationErr ValidationError
	if _, err := s.SendFileMessage(ctx, ua.ID, w.ID, "room", SendFileMessageInput{
		Filename: "a.pdf",
	}); !errors.As(err, &validationErr) {
		t.Fatalf("nil body = %v, want ValidationError", err)
	}
	if _, err := s.SendFileMessage(ctx, ua.ID, w.ID, "room", SendFileMessageInput{
		Filename: "a.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "!!!bad!!!",
	}); !errors.As(err, &validationErr) {
		t.Fatalf("bad client_msg_id = %v, want ValidationError", err)
	}
	// No files wired: the FS path reports storage_unavailable, not a panic.
	_, err := s.SendFileMessage(ctx, ua.ID, w.ID, "room", SendFileMessageInput{
		Filename: "a.pdf", Body: bytes.NewReader(tinyFSFileBytes),
	})
	if err == nil || errors.As(err, &validationErr) {
		t.Fatalf("unwired FS send = %v, want storage_unavailable", err)
	}
	if !codedIs(err, files.CodeStorageUnavailable) {
		t.Fatalf("unwired FS send = %v, want %s", err, files.CodeStorageUnavailable)
	}
}

// The fake verifies type and size from the bytes and rejects what the purpose
// policy refuses; the refusal surfaces as the contract's file_* codes.
func TestSendFileMessagePolicyRefusalsFS(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "tep-nen.zip", Body: bytes.NewReader([]byte("PK\x03\x04....")),
	})
	if !codedIs(err, files.CodeTypeRejected) {
		t.Fatalf("zip upload = %v, want file_type_rejected", err)
	}
	oversize := bytes.Repeat([]byte{0x00}, MaxChatFileMessageBytes+1)
	_, err = s.SendFileMessage(ctx, ua.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "qua-lon.png", Body: bytes.NewReader(oversize),
	})
	if !codedIs(err, files.CodeTooLarge) {
		t.Fatalf("oversize upload = %v, want file_too_large", err)
	}
}

func TestSendVoiceMessageValidationFS(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()

	var validationErr ValidationError
	for _, d := range []int{0, -1, 120_001} {
		if _, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, "room", SendVoiceMessageInput{
			DurationMS: d, Body: bytes.NewReader(tinyFSVoiceBytes),
		}); !errors.As(err, &validationErr) {
			t.Fatalf("duration %d = %v, want ValidationError", d, err)
		}
	}
	if _, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, "room", SendVoiceMessageInput{
		DurationMS: 100,
	}); !errors.As(err, &validationErr) {
		t.Fatalf("nil body = %v, want ValidationError", err)
	}
	if _, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, "room", SendVoiceMessageInput{
		DurationMS: 100, Body: bytes.NewReader(tinyFSVoiceBytes), ClientMsgID: "!!!bad!!!",
	}); !errors.As(err, &validationErr) {
		t.Fatalf("bad client_msg_id = %v, want ValidationError", err)
	}
}

// The purpose policy refuses non-audio bytes: the verified type is checked
// against chat_voice's allowlist and surfaces as file_type_rejected.
func TestSendVoiceMessageRejectsNonAudioFS(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	_, err = s.SendVoiceMessage(ctx, ua.ID, w.ID, dm.ID, SendVoiceMessageInput{
		DurationMS: 1000, Body: bytes.NewReader([]byte("khong-phai-am-thanh")),
	})
	if !codedIs(err, files.CodeTypeRejected) {
		t.Fatalf("non-audio voice = %v, want file_type_rejected", err)
	}
}

// The voice happy path through FileService: duration in the metadata, the
// file_id reference, and the peer's open going through files.Open. Skipped
// until t1c-content-detect lands the shared detector in the fake.
func TestSendVoiceMessageHappyPathFS(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	row, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, dm.ID, SendVoiceMessageInput{
		DurationMS: 12_500, Body: bytes.NewReader(tinyFSVoiceBytes), ClientMsgID: "fs-voice-happy-1",
	})
	if err != nil {
		skipVoiceUploadUntilT1C(t, err)
		t.Fatalf("send voice: %v", err)
	}
	if row.Kind != "voice" || row.Voice == nil {
		t.Fatalf("row = %#v", row)
	}
	if row.Voice.FileID == "" || row.Voice.ObjectKey != "" {
		t.Fatalf("voice reference = %#v, want file_id only", row.Voice)
	}
	if row.Voice.DurationMS != 12_500 || !strings.HasPrefix(row.Voice.ContentType, "audio/") {
		t.Fatalf("voice view = %#v", row.Voice)
	}
	if countEvents(pub.events, "chat.message.created") < 1 {
		t.Fatalf("publish: %+v", pub.events)
	}

	retry, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, dm.ID, SendVoiceMessageInput{
		DurationMS: 12_500, Body: bytes.NewReader(tinyFSVoiceBytes), ClientMsgID: "fs-voice-happy-1",
	})
	if err != nil || retry.ID != row.ID {
		t.Fatalf("voice retry: err=%v row=%+v want id %s", err, retry, row.ID)
	}

	got, reader, err := s.OpenChatVoiceMessage(ctx, ub.ID, w.ID, dm.ID, row.ID)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer reader.Close()
	if reader.Body == nil {
		t.Fatal("open returned a legacy fallback for a post-T7 row")
	}
	if got.Voice == nil || got.Voice.FileID != row.Voice.FileID {
		t.Fatalf("row voice view = %#v", got.Voice)
	}
}
