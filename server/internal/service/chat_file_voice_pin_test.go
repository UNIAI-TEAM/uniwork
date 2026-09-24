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

// Bước 0 regression pins for chat file + voice messages (UNI-745, plan §6.1).
//
// These tests describe what develop does today, before T7 moves chat file and
// voice uploads onto the shared FileService. Every test named
// "...PinForFileServiceMigration" asserts behavior the migration deliberately
// changes (the storage locator inside the message JSON becomes a file_id, caps
// and MIME allowlists move into the purpose policy), so the migration PR edits
// the assertion visibly instead of deleting the case.

func TestChatFileAndVoiceCapsPinForFileServiceMigration(t *testing.T) {
	t.Parallel()
	if MaxChatFileMessageBytes != 25<<20 {
		t.Fatalf("chat file cap = %d bytes, want 25 MiB", MaxChatFileMessageBytes)
	}
	if MaxChatVoiceMessageBytes != 4<<20 {
		t.Fatalf("chat voice cap = %d bytes, want 4 MiB", MaxChatVoiceMessageBytes)
	}
	if maxVoiceDurationMS != 120_000 {
		t.Fatalf("voice duration cap = %d ms, want 120000", maxVoiceDurationMS)
	}

	wantFiles := map[string]string{
		"image/jpeg":      "jpg",
		"image/png":       "png",
		"image/gif":       "gif",
		"image/webp":      "webp",
		"application/pdf": "pdf",
		"text/plain":      "txt",
	}
	if len(supportedChatFileContentTypes) != len(wantFiles) {
		t.Fatalf("chat file allowlist = %v, want %v", supportedChatFileContentTypes, wantFiles)
	}
	for mime, ext := range wantFiles {
		if got, ok := supportedChatFileContentTypes[mime]; !ok || got != ext {
			t.Fatalf("chat file allowlist[%q] = %q (present=%t), want %q", mime, got, ok, ext)
		}
	}

	wantVoice := []string{"audio/webm", "audio/ogg", "audio/mp4"}
	if len(supportedVoiceContentTypes) != len(wantVoice) {
		t.Fatalf("voice allowlist = %v, want %v", supportedVoiceContentTypes, wantVoice)
	}
	for _, mime := range wantVoice {
		if _, ok := supportedVoiceContentTypes[mime]; !ok {
			t.Fatalf("voice allowlist is missing %q", mime)
		}
	}
}

// Today the business JSON keeps the storage locator next to the display
// metadata; T7 stores only a file_id and reads MIME, size and duration from
// the files row instead.
func TestChatMessageMetadataKeepsStorageLocatorPinForFileServiceMigration(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	filePrep, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "ke-hoach.pdf", ContentType: "application/pdf", SizeBytes: 4096,
		ClientMsgID: "pin-file-1",
	})
	if err != nil {
		t.Fatalf("prepare file: %v", err)
	}
	fileRow, created, err := s.CreateFileMessage(ctx, ua.ID, "chat/files/org/room/pin.pdf", filePrep)
	if err != nil || !created {
		t.Fatalf("create file: err=%v created=%v", err, created)
	}

	voicePrep, err := s.PrepareVoiceMessage(ctx, ua.ID, w.ID, dm.ID, PrepareVoiceMessageInput{
		DurationMS: 11_500, ContentType: "audio/webm", SizeBytes: 2048,
		ClientMsgID: "pin-voice-1",
	})
	if err != nil {
		t.Fatalf("prepare voice: %v", err)
	}
	voiceRow, created, err := s.CreateVoiceMessage(ctx, ua.ID, "chat/voice/org/room/pin.webm", voicePrep)
	if err != nil || !created {
		t.Fatalf("create voice: err=%v created=%v", err, created)
	}

	for _, tc := range []struct {
		name   string
		id     string
		object string
	}{
		{"file", fileRow.ID, "chat/files/org/room/pin.pdf"},
		{"voice", voiceRow.ID, "chat/voice/org/room/pin.webm"},
	} {
		stored, err := q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: tc.id, RoomID: dm.ID, WorkspaceID: w.ID,
		})
		if err != nil {
			t.Fatalf("%s row: %v", tc.name, err)
		}
		var meta map[string]any
		if err := json.Unmarshal(stored.Metadata, &meta); err != nil {
			t.Fatalf("%s metadata json: %v (%s)", tc.name, err, stored.Metadata)
		}
		if got, _ := meta["object_key"].(string); got != tc.object {
			t.Fatalf("%s metadata object_key = %q, want %q (pin: T7 replaces it with file_id)", tc.name, got, tc.object)
		}
		if _, ok := meta["file_id"]; ok {
			t.Fatalf("%s metadata already carries file_id; this pin belongs to the FileService migration", tc.name)
		}
	}
}

// A retry with the same client_msg_id is one message, and today a different
// payload under that same id also returns the earlier message instead of a
// conflict. T7 turns the second case into `idempotency_conflict`; the pin
// keeps that change visible.
func TestChatFileMessageClientMsgIDIdempotencyPinForFileServiceMigration(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	first, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "bao-cao.pdf", ContentType: "application/pdf", SizeBytes: 1024,
		ClientMsgID: "same-key-file",
	})
	if err != nil {
		t.Fatalf("prepare first: %v", err)
	}
	row, created, err := s.CreateFileMessage(ctx, ua.ID, "chat/files/org/room/first.pdf", first)
	if err != nil || !created {
		t.Fatalf("create first: err=%v created=%v", err, created)
	}

	retry, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "bao-cao.pdf", ContentType: "application/pdf", SizeBytes: 1024,
		ClientMsgID: "same-key-file",
	})
	if err != nil || retry.Existing == nil || retry.Existing.ID != row.ID {
		t.Fatalf("retry prepare: err=%v existing=%+v want id %s", err, retry.Existing, row.ID)
	}
	again, created, err := s.CreateFileMessage(ctx, ua.ID, "chat/files/org/room/second.pdf", retry)
	if err != nil || created || again.ID != row.ID {
		t.Fatalf("retry create: err=%v created=%v id=%s want %s", err, created, again.ID, row.ID)
	}

	different, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "khac.pdf", ContentType: "application/pdf", SizeBytes: 2048,
		ClientMsgID: "same-key-file",
	})
	if err != nil || different.Existing == nil || different.Existing.ID != row.ID {
		t.Fatalf("different payload under the same key must return the earlier message today: err=%v existing=%+v", err, different.Existing)
	}

	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	files := 0
	for _, m := range msgs {
		if m.Kind == "file" {
			files++
		}
	}
	if files != 1 {
		t.Fatalf("file messages in room = %d, want 1 (client_msg_id must not duplicate)", files)
	}

	voice, err := s.PrepareVoiceMessage(ctx, ua.ID, w.ID, dm.ID, PrepareVoiceMessageInput{
		DurationMS: 900, ContentType: "audio/webm", SizeBytes: 512, ClientMsgID: "same-key-voice",
	})
	if err != nil {
		t.Fatalf("prepare voice: %v", err)
	}
	voiceRow, created, err := s.CreateVoiceMessage(ctx, ua.ID, "chat/voice/org/room/one.webm", voice)
	if err != nil || !created {
		t.Fatalf("create voice: err=%v created=%v", err, created)
	}
	voiceRetry, err := s.PrepareVoiceMessage(ctx, ua.ID, w.ID, dm.ID, PrepareVoiceMessageInput{
		DurationMS: 900, ContentType: "audio/webm", SizeBytes: 512, ClientMsgID: "same-key-voice",
	})
	if err != nil || voiceRetry.Existing == nil || voiceRetry.Existing.ID != voiceRow.ID {
		t.Fatalf("voice retry prepare: err=%v existing=%+v want %s", err, voiceRetry.Existing, voiceRow.ID)
	}
	// A text message that already owns the client_msg_id is a different kind,
	// so the file path refuses to reuse it.
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{
		Body: "text with the same id", ClientMsgID: "same-key-file",
	}); err == nil {
		t.Fatal("text message reusing a file client_msg_id should fail today")
	}
}

func TestFileMessageRequiresRoomMembershipAndHonoursDMBlock(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "chat-outsider-pin@example.com", "Outsider")
	addOrgMember(t, q, w.OrganizationID, outsider.ID)
	addWorkspaceMember(t, q, w.ID, outsider.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	prep, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "rieng-tu.pdf", ContentType: "application/pdf", SizeBytes: 1024, ClientMsgID: "dm-file-1",
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	row, created, err := s.CreateFileMessage(ctx, ua.ID, "chat/files/org/room/private.pdf", prep)
	if err != nil || !created {
		t.Fatalf("create: err=%v created=%v", err, created)
	}

	// A workspace member who is not in the DM cannot prepare, read or stream.
	if _, err := s.PrepareFileMessage(ctx, outsider.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "x.pdf", ContentType: "application/pdf", SizeBytes: 10,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider prepare = %v, want ErrForbidden", err)
	}
	if _, err := s.GetFileMessage(ctx, outsider.ID, w.ID, dm.ID, row.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider file get = %v, want ErrForbidden", err)
	}
	if _, err := s.GetVoiceMessage(ctx, outsider.ID, w.ID, dm.ID, row.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider voice get = %v, want ErrForbidden", err)
	}

	// A DM peer who blocked the sender stops new file and voice uploads.
	if err := s.BlockChatUser(ctx, ub.ID, w.ID, ua.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if _, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "sau-khi-block.pdf", ContentType: "application/pdf", SizeBytes: 10,
	}); !codedIs(err, "chat_user_blocked") {
		t.Fatalf("file upload after block = %v, want chat_user_blocked", err)
	}
	if _, err := s.PrepareVoiceMessage(ctx, ua.ID, w.ID, dm.ID, PrepareVoiceMessageInput{
		DurationMS: 100, ContentType: "audio/webm", SizeBytes: 10,
	}); !codedIs(err, "chat_user_blocked") {
		t.Fatalf("voice upload after block = %v, want chat_user_blocked", err)
	}
}
