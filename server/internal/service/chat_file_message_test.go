package service

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestSanitizeChatFilename(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"report.pdf", "report.pdf"},
		{"../etc/passwd", "passwd"},
		{"C:\\Users\\a\\b.png", "b.png"},
		{"...", "file"},
		{"", "file"},
	}
	for _, tc := range cases {
		if got := sanitizeChatFilename(tc.in); got != tc.want {
			t.Fatalf("sanitizeChatFilename(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidateFileMessageInput(t *testing.T) {
	t.Parallel()
	valid := PrepareFileMessageInput{
		Filename: "sprint.pdf", ContentType: "application/pdf", SizeBytes: 1,
		ClientMsgID: "file-msg-123",
	}
	if err := validateFileMessageInput(valid); err != nil {
		t.Fatalf("valid input: %v", err)
	}
	tests := []struct {
		name string
		edit func(*PrepareFileMessageInput)
	}{
		{"empty file", func(in *PrepareFileMessageInput) { in.SizeBytes = 0 }},
		{"large file", func(in *PrepareFileMessageInput) { in.SizeBytes = MaxChatFileMessageBytes + 1 }},
		{"unsupported type", func(in *PrepareFileMessageInput) { in.ContentType = "application/zip" }},
		{"bad client id", func(in *PrepareFileMessageInput) { in.ClientMsgID = "!!!bad!!!" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := valid
			tt.edit(&in)
			var validationErr ValidationError
			if err := validateFileMessageInput(in); !errors.As(err, &validationErr) {
				t.Fatalf("error = %v, want ValidationError", err)
			}
		})
	}
}

func TestExtForChatFileContentType(t *testing.T) {
	t.Parallel()
	if ExtForChatFileContentType(" image/PNG ") != "png" {
		t.Fatal("expected png")
	}
	if ExtForChatFileContentType("application/zip") != "" {
		t.Fatal("zip must be unsupported")
	}
}

func TestSanitizeChatFilenameTruncates(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("あ", maxChatFilenameRunes+20) + ".png"
	got := sanitizeChatFilename(long)
	if utf8RuneCount(got) != maxChatFilenameRunes {
		t.Fatalf("len=%d want=%d got=%q", utf8RuneCount(got), maxChatFilenameRunes, got)
	}
}

func utf8RuneCount(s string) int {
	return len([]rune(s))
}

func TestFileMessageFromMetadataRejectsBad(t *testing.T) {
	t.Parallel()
	if fileMessageFromMetadata("file", []byte(`{`)) != nil {
		t.Fatal("invalid json")
	}
	if fileMessageFromMetadata("file", []byte(`{"filename":"a.pdf","object_key":"","content_type":"application/pdf","size_bytes":1}`)) != nil {
		t.Fatal("empty object key")
	}
	if fileMessageFromMetadata("file", []byte(`{"filename":"a.zip","object_key":"k","content_type":"application/zip","size_bytes":1}`)) != nil {
		t.Fatal("unsupported type")
	}
}

func TestFileMessageFromMetadata(t *testing.T) {
	t.Parallel()
	raw := []byte(`{
		"filename": "sprint.pdf",
		"object_key": "chat/files/org/room/message.pdf",
		"content_type": "application/pdf",
		"size_bytes": 2048
	}`)
	got := fileMessageFromMetadata("file", raw)
	if got == nil {
		t.Fatal("file metadata was not mapped")
	}
	if got.Filename != "sprint.pdf" || got.ObjectKey == "" || got.ContentType != "application/pdf" || got.SizeBytes != 2048 {
		t.Fatalf("unexpected file info: %#v", got)
	}
	if fileMessageFromMetadata("text", raw) != nil {
		t.Fatal("text kind should not map file metadata")
	}
}

func TestCreateFileMessageAndGet(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	clientID := "file-client-msg-001"
	prep, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "../docs/sprint.pdf", ContentType: "application/pdf", SizeBytes: 2048,
		ClientMsgID: clientID,
	})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if prep.Filename() != "sprint.pdf" || prep.OrganizationID == "" || prep.Existing != nil {
		t.Fatalf("prep = %#v", prep)
	}

	row, created, err := s.CreateFileMessage(ctx, ua.ID, "chat/files/org/room/msg.pdf", prep)
	if err != nil || !created {
		t.Fatalf("create: err=%v created=%v", err, created)
	}
	if row.Kind != "file" || row.File == nil || row.File.Filename != "sprint.pdf" || row.Body != "sprint.pdf" {
		t.Fatalf("row = %#v", row)
	}
	if row.File.ObjectKey != "chat/files/org/room/msg.pdf" {
		t.Fatalf("object key = %q", row.File.ObjectKey)
	}
	if countEvents(pub.events, "chat.message.created") < 1 {
		t.Fatalf("publish: %+v", pub.events)
	}

	got, err := s.GetFileMessage(ctx, ua.ID, w.ID, dm.ID, row.ID)
	if err != nil || got.File == nil || got.File.ObjectKey == "" {
		t.Fatalf("get: err=%v got=%#v", err, got)
	}

	// Idempotent prepare returns Existing without another upload.
	again, err := s.PrepareFileMessage(ctx, ua.ID, w.ID, dm.ID, PrepareFileMessageInput{
		Filename: "sprint.pdf", ContentType: "application/pdf", SizeBytes: 2048,
		ClientMsgID: clientID,
	})
	if err != nil || again.Existing == nil || again.Existing.ID != row.ID {
		t.Fatalf("idempotent prepare: err=%v existing=%#v", err, again.Existing)
	}

	if _, _, err := s.CreateFileMessage(ctx, ua.ID, "", prep); err == nil {
		t.Fatal("empty object key must fail")
	}
	if _, err := s.GetFileMessage(ctx, ua.ID, w.ID, dm.ID, "missing"); err == nil {
		t.Fatal("missing file message must fail")
	}
}
