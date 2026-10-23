package service

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// attachFlags turns the two flags Ask UNI attachments need on for one
// organization and one user, so a test also proves they are read with the
// request's organization and user. Every other flag reads as its default.
type attachFlags struct {
	org, user          string
	attachments, agent bool
}

func (f *attachFlags) IsEnabled(ctx context.Context, key string, def bool) bool {
	ec := featureflag.EvalContextFrom(ctx)
	here := ec.OrganizationID == f.org && ec.UserID == f.user
	switch key {
	case askAttachmentsFlag:
		return here && f.attachments
	case askAgentFlag:
		return here && f.agent
	}
	return def
}

// attachFixture is askFixture with a real FileService over a local store,
// the second user a plain member of the workspace, and both flags on.
func attachFixture(t *testing.T) (*AskUNIService, *attachFlags, db.User, db.User, db.Workspace) {
	t.Helper()
	s, _, ua, ub, w := askFixture(t)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	stores, err := storage.BuildStores(context.Background(),
		storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatal(err)
	}
	fs, err := NewFileService(FileServiceOptions{Pool: s.pool, Store: stores[storage.BackendLocal], SpoolDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	s.SetFiles(fs)
	flags := &attachFlags{org: w.OrganizationID, user: ua.ID, attachments: true, agent: true}
	s.SetFlags(flags)
	return s, flags, ua, ub, w
}

func uploadSession(t *testing.T, s *AskUNIService, fileID string) db.FileUploadSession {
	t.Helper()
	sess, err := s.q.GetUploadSessionByFile(context.Background(), fileID)
	if err != nil {
		t.Fatal(err)
	}
	return sess
}

func TestUploadAttachmentReturnsTheFile(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	body := pdfBody("ask-att")
	got, err := s.UploadAttachment(context.Background(), ua.ID, w.ID, "note.pdf", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	want := AskAttachment{FileID: got.FileID, Name: "note.pdf", MIME: "application/pdf", Kind: "pdf", Size: int64(len(body))}
	if got != want || got.FileID == "" {
		t.Fatalf("got %+v, want %+v with a file id", got, want)
	}
	sess := uploadSession(t, s, got.FileID)
	if sess.Purpose != string(files.AiAttachment) || sess.CreatedBy != ua.ID || sess.WorkspaceID.String != w.ID || sess.OrganizationID.String != w.OrganizationID {
		t.Fatalf("session %+v is not the asker's ai_attachment in their workspace", sess)
	}
	// The upload is a file in the store only; sending the question claims it.
	var rows int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM ai_attachments`).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("ai_attachments rows = %d (%v), want 0 before a question is sent", rows, err)
	}
}

func TestUploadAttachmentRefusedWhileOff(t *testing.T) {
	s, flags, ua, ub, w := attachFixture(t)
	ctx := context.Background()
	for name, off := range map[string]func(){
		"attachments flag off": func() { flags.attachments = false },
		"agent flag off":       func() { flags.agent = false },
	} {
		flags.attachments, flags.agent = true, true
		off()
		if _, err := s.UploadAttachment(ctx, ua.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("off"))); !errors.Is(err, ai.ErrAttachmentsUnavailable) {
			t.Errorf("%s: %v, want ai_attachments_unavailable", name, err)
		}
	}
	// A member the flags are not on for (their own evaluation context) is
	// refused the same way, and a stranger never gets as far as the flags.
	flags.attachments, flags.agent = true, true
	if _, err := s.UploadAttachment(ctx, ub.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("other"))); !errors.Is(err, ai.ErrAttachmentsUnavailable) {
		t.Errorf("a user the flags are off for: %v, want ai_attachments_unavailable", err)
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM file_upload_sessions WHERE purpose = $1`, string(files.AiAttachment)).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a refused upload left %d sessions (%v)", n, err)
	}
	stranger := db.User{ID: "01J8X4STRANGER0000000000000"}
	if _, err := s.UploadAttachment(ctx, stranger.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("x"))); !errors.Is(err, ai.ErrContextForbidden) {
		t.Errorf("non-member: %v, want ai_context_forbidden", err)
	}
}

func TestUploadAttachmentRefusesLegacyOffice(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ole := append([]byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}, make([]byte, 512)...)
	_, err := s.UploadAttachment(context.Background(), ua.ID, w.ID, "x.xls", bytes.NewReader(ole))
	if !codedIs(err, files.CodeTypeRejected) {
		t.Fatalf("legacy XLS: %v, want %s", err, files.CodeTypeRejected)
	}
}

func TestCancelAttachmentOnlyByTheUploader(t *testing.T) {
	s, _, ua, ub, w := attachFixture(t)
	ctx := context.Background()
	up, err := s.UploadAttachment(ctx, ua.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("cancel")))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAttachment(ctx, ub.ID, w.ID, up.FileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another member: %v, want not found", err)
	}
	if got := uploadSession(t, s, up.FileID).Status; got != string(files.SessionStaged) {
		t.Fatalf("session after a refused cancel = %q, want staged", got)
	}
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, up.FileID); err != nil {
		t.Fatal(err)
	}
	if got := uploadSession(t, s, up.FileID).Status; got != string(files.SessionCanceled) {
		t.Fatalf("session after the uploader's cancel = %q, want canceled", got)
	}
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, "01J8X4NOSUCHFILE00000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown id: %v, want not found", err)
	}
}

// Cancel is for an unclaimed Ask UNI upload and nothing else: not the same
// user's file of another purpose, not a file a sent question already holds.
func TestCancelAttachmentRefusesWhatIsNotAnUnclaimedAskUpload(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	scope := files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}

	other, err := s.files.Upload(ctx, files.UploadInput{
		Actor: Human(ua.ID), Purpose: files.ChatAttachment, Scope: scope,
		IdempotencyKey: "cancel-other-purpose", Filename: "chat.pdf", Body: bytes.NewReader(pdfBody("chat")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, string(other.File.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another purpose: %v, want not found", err)
	}
	if got := uploadSession(t, s, string(other.File.ID)).Status; got != string(files.SessionStaged) {
		t.Fatalf("a file of another purpose ended up %q, want staged", got)
	}

	up, err := s.UploadAttachment(ctx, ua.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("claimed")))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.files.ClaimInTx(ctx, s.q.WithTx(tx), files.ClaimInput{
		Actor: Human(ua.ID), Purpose: files.AiAttachment, Scope: scope, FileIDs: []files.FileID{files.FileID(up.FileID)},
	}); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, up.FileID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a claimed file: %v, want not found", err)
	}
	if got := uploadSession(t, s, up.FileID).Status; got != string(files.SessionClaimed) {
		t.Fatalf("a claimed file ended up %q, want claimed", got)
	}
}

func TestCapabilitiesReportAttachments(t *testing.T) {
	s, flags, ua, _, w := attachFixture(t)
	for _, tc := range []struct{ attachments, agent, want bool }{
		{true, true, true}, {true, false, false}, {false, true, false}, {false, false, false},
	} {
		flags.attachments, flags.agent = tc.attachments, tc.agent
		c, err := s.Capabilities(context.Background(), ua.ID, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		if c.Attachments != tc.want {
			t.Errorf("attachments flag %v, agent flag %v: Attachments = %v, want %v", tc.attachments, tc.agent, c.Attachments, tc.want)
		}
	}
}

func TestAskAttachmentKind(t *testing.T) {
	for mime, want := range map[string]string{
		"image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image",
		"application/pdf": "pdf",
		"text/plain":      "text", "text/csv": "text", "text/markdown": "text",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "text",
		"application/vnd.oasis.opendocument.text":                                 "text",
	} {
		if got := askAttachmentKind(mime); got != want {
			t.Errorf("kind of %s = %q, want %q", mime, got, want)
		}
	}
}
