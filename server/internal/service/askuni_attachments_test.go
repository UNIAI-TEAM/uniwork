package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
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

// useLocalFileStore gives s a real FileService over a local store that goes
// away with the test.
func useLocalFileStore(t *testing.T, s *AskUNIService) {
	t.Helper()
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
}

// attachFixture is askFixture with a real FileService over a local store,
// the agent wired as the other agent tests wire it (read tools and the fake
// provider's model), the second user a plain member of the workspace, and
// both flags on.
func attachFixture(t *testing.T) (*AskUNIService, *attachFlags, db.User, db.User, db.Workspace) {
	t.Helper()
	s, _, flags, ua, ub, w := attachAgentFixture(t)
	return s, flags, ua, ub, w
}

// attachAgentFixture is attachFixture with the fake provider behind the
// gateway, for a test that scripts the model.
func attachAgentFixture(t *testing.T) (*AskUNIService, *provider.Fake, *attachFlags, db.User, db.User, db.Workspace) {
	t.Helper()
	s, fake, ua, ub, w := askFixture(t)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	useLocalFileStore(t, s)
	s.SetReadTools(NewMcpToolService(s.q, s, NewHomeService(s.q, s.ws), s.ws, "https://app.example.test"))
	flags := &attachFlags{org: w.OrganizationID, user: ua.ID, attachments: true, agent: true}
	s.SetFlags(flags)
	return s, fake, flags, ua, ub, w
}

// oneNotFound is the answer of a cancel that is not the asker's to make: the
// bare ErrNotFound the API renders as 404 not_found, never a coded
// file_not_found, which would name the id.
func oneNotFound(err error) bool {
	var ce CodedError
	return errors.Is(err, ErrNotFound) && !errors.As(err, &ce)
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

// pngOf is a valid PNG of w by h pixels, small whatever its size.
func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// An image the model would refuse is refused at upload, with a reason that
// names the limit, and the upload is taken back; one within the limits goes.
func TestUploadAttachmentRefusesAnImageTheModelCannotTake(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	if _, err := s.UploadAttachment(ctx, ua.ID, w.ID, "nho.png", bytes.NewReader(pngOf(t, 800, 600))); err != nil {
		t.Fatalf("an 800x600 PNG: %v", err)
	}
	big := append(pngOf(t, 10, 10), make([]byte, askMaxImageBytes)...) // a PNG padded past 7.5 MB
	for name, tc := range map[string]struct {
		body []byte
		code string
		says string
	}{
		"over 7.5 MB":            {big, ai.ErrAttachmentsTooLarge.Code, "7,5 MB"},
		"wider than 8000 px":     {pngOf(t, 8001, 1), ai.ErrAttachmentsTooLarge.Code, "8000 × 8000"},
		"taller than 8000 px":    {pngOf(t, 1, 8001), ai.ErrAttachmentsTooLarge.Code, "8000 × 8000"},
		"header does not decode": {[]byte("\x89PNG\r\n\x1a\nkhông phải ảnh thật"), ai.ErrAttachmentUnreadable.Code, "hinh.png"},
	} {
		_, err := s.UploadAttachment(ctx, ua.ID, w.ID, "hinh.png", bytes.NewReader(tc.body))
		var e *ai.Error
		if !errors.As(err, &e) || e.Code != tc.code || e.Status != 422 || !strings.Contains(e.Msg, tc.says) {
			t.Errorf("%s: %v, want %s naming %q", name, err, tc.code, tc.says)
		}
	}
	var staged, canceled int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = $2), count(*) FILTER (WHERE status = $3) FROM file_upload_sessions WHERE purpose = $1`,
		string(files.AiAttachment), string(files.SessionStaged), string(files.SessionCanceled)).Scan(&staged, &canceled); err != nil {
		t.Fatal(err)
	}
	if staged != 1 || canceled != 4 {
		t.Fatalf("sessions staged %d, canceled %d; want the good image staged and the four refused taken back", staged, canceled)
	}
}

func TestCancelAttachmentOnlyByTheUploader(t *testing.T) {
	s, _, ua, ub, w := attachFixture(t)
	ctx := context.Background()
	up, err := s.UploadAttachment(ctx, ua.ID, w.ID, "note.pdf", bytes.NewReader(pdfBody("cancel")))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAttachment(ctx, ub.ID, w.ID, up.FileID); !oneNotFound(err) {
		t.Fatalf("another member: %v, want the bare not found", err)
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
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, "01J8X4NOSUCHFILE00000000000"); !oneNotFound(err) {
		t.Fatalf("unknown id: %v, want the bare not found", err)
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
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, string(other.File.ID)); !oneNotFound(err) {
		t.Fatalf("another purpose: %v, want the bare not found", err)
	}
	if got := uploadSession(t, s, string(other.File.ID)).Status; got != string(files.SessionStaged) {
		t.Fatalf("a file of another purpose ended up %q, want staged", got)
	}

	// The same person's upload in another tenant is no more theirs to cancel
	// from here.
	elsewhere, err := s.files.Upload(ctx, files.UploadInput{
		Actor: Human(ua.ID), Purpose: files.AiAttachment, Scope: files.Scope{OrganizationID: "other-org", WorkspaceID: "other-ws"},
		IdempotencyKey: "cancel-other-tenant", Filename: "other.pdf", Body: bytes.NewReader(pdfBody("elsewhere")),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, string(elsewhere.File.ID)); !oneNotFound(err) {
		t.Fatalf("another tenant: %v, want the bare not found", err)
	}
	if got := uploadSession(t, s, string(elsewhere.File.ID)).Status; got != string(files.SessionStaged) {
		t.Fatalf("another tenant's file ended up %q, want staged", got)
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
	if err := s.CancelAttachment(ctx, ua.ID, w.ID, up.FileID); !oneNotFound(err) {
		t.Fatalf("a claimed file: %v, want the bare not found", err)
	}
	if got := uploadSession(t, s, up.FileID).Status; got != string(files.SessionClaimed) {
		t.Fatalf("a claimed file ended up %q, want claimed", got)
	}
}

// An upload is offered only where the turn would run the agent: both flags on
// is not enough when the read tools are unwired or the provider has no
// copilot_agent model, because the turn then falls back to P0, which reads no
// file.
func TestAttachmentsNeedTheAgentToRun(t *testing.T) {
	for name, breakAgent := range map[string]func(s *AskUNIService){
		"read tools unwired": func(s *AskUNIService) { s.SetReadTools(nil) },
		"no copilot_agent model": func(s *AskUNIService) {
			s.gw = ai.NewGateway(s.q, unmodelledProvider{&provider.Fake{}}, NewAIQuota(s.ent), nil, ai.Options{})
		},
	} {
		// One fixture per case: each takes the test database's lock.
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			s, _, ua, _, w := attachFixture(t)
			if _, err := s.UploadAttachment(ctx, ua.ID, w.ID, "ok.pdf", bytes.NewReader(pdfBody("ok"))); err != nil {
				t.Fatalf("with the agent wired the upload failed: %v", err)
			}
			breakAgent(s)
			c, err := s.Capabilities(ctx, ua.ID, w.ID)
			if err != nil {
				t.Fatal(err)
			}
			if c.Attachments {
				t.Error("both flags on, but Attachments = true although the turn would not run the agent")
			}
			if _, err := s.UploadAttachment(ctx, ua.ID, w.ID, "no.pdf", bytes.NewReader(pdfBody("no"))); !errors.Is(err, ai.ErrAttachmentsUnavailable) {
				t.Errorf("upload = %v, want ai_attachments_unavailable", err)
			}
		})
	}
}

// unmodelledProvider is a provider the model policy has no default for.
type unmodelledProvider struct{ *provider.Fake }

func (unmodelledProvider) Name() string { return "no-such-provider" }

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

// ---- Files on a question (UNI-2119, Task 6) ---------------------------------

// uploadPDFs uploads one small PDF per name as userID and returns the file ids.
// The PDFs are valid: a question that is sent reads its files.
func uploadPDFs(t *testing.T, s *AskUNIService, userID, workspaceID string, names ...string) []string {
	t.Helper()
	ids := make([]string, len(names))
	for i, n := range names {
		up, err := s.UploadAttachment(context.Background(), userID, workspaceID, n, bytes.NewReader(pdfOfPages(1)))
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = up.FileID
	}
	return ids
}

// requireNoQuestionStored is the state of a refused question: no message, no
// ai_attachments row, and every file still unclaimed, so the asker can fix the
// question and send it again.
func requireNoQuestionStored(t *testing.T, s *AskUNIService, staged ...string) {
	t.Helper()
	for _, table := range []string{"ai_messages", "ai_attachments"} {
		var n int
		if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s has %d rows (%v) after a refused question, want 0", table, n, err)
		}
	}
	for _, id := range staged {
		if got := uploadSession(t, s, id).Status; got != string(files.SessionStaged) {
			t.Fatalf("file %s ended up %q after a refused question, want staged", id, got)
		}
	}
}

// requireNothingStored is that, and no conversation either: a question whose
// files are refused is refused before its conversation exists.
func requireNothingStored(t *testing.T, s *AskUNIService, staged ...string) {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM ai_conversations`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("ai_conversations has %d rows (%v) after a refused question, want 0", n, err)
	}
	requireNoQuestionStored(t, s, staged...)
}

func TestAskStoresAttachmentsOnTheQuestion(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	ids := uploadPDFs(t, s, ua.ID, w.ID, "a.pdf", "b.pdf")
	// Sent in the reverse of the order they were uploaded: attachment_ids is
	// the attach order.
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt hai file", AttachmentIDs: []string{ids[1], ids[0]}})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := s.Messages(ctx, ua.ID, res.ConversationID)
	if err != nil || len(msgs) != 2 || msgs[0].Role != "user" || msgs[1].Role != "assistant" {
		t.Fatalf("messages = %d (%v), want [user assistant]", len(msgs), err)
	}
	want := []AskAttachment{
		{FileID: ids[1], Name: "b.pdf", MIME: "application/pdf", Kind: "pdf", Size: int64(len(pdfOfPages(1)))},
		{FileID: ids[0], Name: "a.pdf", MIME: "application/pdf", Kind: "pdf", Size: int64(len(pdfOfPages(1)))},
	}
	rows, err := s.q.AiListAttachmentsForMessages(ctx, db.AiListAttachmentsForMessagesParams{OrganizationID: w.OrganizationID, MessageIds: []string{msgs[0].ID, msgs[1].ID}})
	if err != nil || len(rows) != 2 {
		t.Fatalf("ai_attachments rows = %d (%v), want 2", len(rows), err)
	}
	got := msgs[0].Attachments
	if len(got) != 2 {
		t.Fatalf("the question carries %+v, want %+v", got, want)
	}
	for i, r := range rows {
		if r.MessageID != msgs[0].ID || r.ConversationID != res.ConversationID || r.UserID != ua.ID || r.WorkspaceID != w.ID || r.FileID != want[i].FileID {
			t.Errorf("row %d = %+v, want the question's, %s's, in %s, file %s", i, r, ua.ID, w.ID, want[i].FileID)
		}
		// The message lists the row's own id, the one a download names.
		if got[i].ID != r.ID || got[i].ID == "" {
			t.Errorf("file %d is listed as row %q, want %q", i, got[i].ID, r.ID)
		}
		got[i].ID = ""
		if got[i] != want[i] {
			t.Errorf("file %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if len(msgs[1].Attachments) != 0 {
		t.Fatalf("the answer carries %+v, want no files", msgs[1].Attachments)
	}
	for _, id := range ids {
		if got := uploadSession(t, s, id).Status; got != string(files.SessionClaimed) {
			t.Errorf("file %s is %q after the question was stored, want claimed", id, got)
		}
	}
}

func TestAskRefusesSomeoneElsesUpload(t *testing.T) {
	s, flags, ua, ub, w := attachFixture(t)
	ctx := context.Background()
	scope := files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	mine := uploadPDFs(t, s, ua.ID, w.ID, "mine.pdf")[0]
	// The flags are on for one person at a time in this fixture.
	flags.user = ub.ID
	theirs := uploadPDFs(t, s, ub.ID, w.ID, "theirs.pdf")[0]
	flags.user = ua.ID
	chatFile, err := s.files.Upload(ctx, files.UploadInput{
		Actor: Human(ua.ID), Purpose: files.ChatAttachment, Scope: scope,
		IdempotencyKey: "ask-other-purpose", Filename: "chat.pdf", Body: bytes.NewReader(pdfBody("chat")),
	})
	if err != nil {
		t.Fatal(err)
	}
	elsewhere, err := s.files.Upload(ctx, files.UploadInput{
		Actor: Human(ua.ID), Purpose: files.AiAttachment, Scope: files.Scope{OrganizationID: "other-org", WorkspaceID: "other-ws"},
		IdempotencyKey: "ask-other-tenant", Filename: "other.pdf", Body: bytes.NewReader(pdfBody("elsewhere")),
	})
	if err != nil {
		t.Fatal(err)
	}
	// Every id the asker may not attach answers the same bare not found as an
	// id that names nothing, and takes the asker's own valid file down with it.
	for name, id := range map[string]string{
		"another member's upload": theirs, "an id that names nothing": "01J8X4NOSUCHFILE00000000000",
		"a file of another purpose": string(chatFile.File.ID), "an upload in another tenant": string(elsewhere.File.ID),
	} {
		_, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{mine, id}})
		if !oneNotFound(err) {
			t.Errorf("%s: %v, want the bare not found", name, err)
		}
	}
	requireNothingStored(t, s, mine, theirs, string(chatFile.File.ID), string(elsewhere.File.ID))
}

func TestAskRefusesADuplicateAttachment(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	f := uploadPDFs(t, s, ua.ID, w.ID, "dup.pdf")[0]
	_, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{f, f}})
	if !errors.Is(err, ai.ErrAttachmentsInvalid) {
		t.Fatalf("the same file twice: %v, want ai_attachments_invalid", err)
	}
	requireNothingStored(t, s, f)
}

func TestAskRefusesSixAttachments(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	ids := uploadPDFs(t, s, ua.ID, w.ID, "1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf", "6.pdf")
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: ids}); !errors.Is(err, ai.ErrAttachmentsInvalid) {
		t.Fatalf("six files: %v, want ai_attachments_invalid", err)
	}
	requireNothingStored(t, s, ids...)
	// Five is the limit, and still goes through.
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: ids[:5]})
	if err != nil {
		t.Fatalf("five files: %v", err)
	}
	msgs, err := s.Messages(ctx, ua.ID, res.ConversationID)
	if err != nil || len(msgs[0].Attachments) != 5 {
		t.Fatalf("the question carries %d files (%v), want 5", len(msgs[0].Attachments), err)
	}
}

func TestAskRefusesOver20MBInTotal(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	upload := func(name string, size int) string {
		t.Helper()
		up, err := s.UploadAttachment(ctx, ua.ID, w.ID, name, bytes.NewReader(pdfOfSize(1, size)))
		if err != nil {
			t.Fatal(err)
		}
		return up.FileID
	}
	const half = 10 << 20
	a, b, c := upload("a.pdf", half), upload("b.pdf", half+1), upload("c.pdf", half)
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{a, b}}); !errors.Is(err, ai.ErrAttachmentsTooLarge) {
		t.Fatalf("20 MB and one byte: %v, want ai_attachments_too_large", err)
	}
	requireNothingStored(t, s, a, b, c)
	// Exactly 20 MB is allowed.
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{a, c}}); err != nil {
		t.Fatalf("exactly 20 MB: %v", err)
	}
}

func TestAskRefusesAttachmentsWhenAgentOff(t *testing.T) {
	s, flags, ua, _, w := attachFixture(t)
	f := uploadPDFs(t, s, ua.ID, w.ID, "off.pdf")[0]
	for name, off := range map[string]func(){
		"agent flag off":       func() { flags.agent = false },
		"attachments flag off": func() { flags.attachments = false },
	} {
		flags.attachments, flags.agent = true, true
		off()
		if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{f}}); !errors.Is(err, ai.ErrAttachmentsUnavailable) {
			t.Errorf("%s: %v, want ai_attachments_unavailable", name, err)
		}
	}
	requireNothingStored(t, s, f)
	// A question with no file is not held back by the flags.
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "có gì mới?"}); err != nil {
		t.Fatalf("a question without files while the flags are off: %v", err)
	}
}

func TestAskRefusesAnAlreadySentAttachment(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	f := uploadPDFs(t, s, ua.ID, w.ID, "once.pdf")[0]
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "tóm tắt", AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	// In the same conversation and in a new one: the file is a sent question's.
	for _, conv := range []string{first.ConversationID, ""} {
		if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: conv, Question: "lại", AttachmentIDs: []string{f}}); !oneNotFound(err) {
			t.Fatalf("a file a sent question holds (conversation %q): %v, want the bare not found", conv, err)
		}
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM ai_attachments`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("ai_attachments rows = %d (%v), want the one of the first question", n, err)
	}
}

// A regenerated answer re-reads the original question's files, so it takes no
// new ones.
func TestAskRefusesRegenerateWithAttachments(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	f := uploadPDFs(t, s, ua.ID, w.ID, "regen.pdf")[0]
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "có gì mới?"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.AskStream(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Dock: true, AttachmentIDs: []string{f}}, nil)
	if !errors.Is(err, ai.ErrAttachmentsInvalid) {
		t.Fatalf("regenerate with a file: %v, want ai_attachments_invalid", err)
	}
	if got := uploadSession(t, s, f).Status; got != string(files.SessionStaged) {
		t.Fatalf("file ended up %q, want staged", got)
	}
}

// The claim belongs to the stored question: a question the turn refuses after
// its files were checked (here a mention the asker cannot read) leaves them
// unclaimed.
func TestAskKeepsFilesUnclaimedWhenTheTurnIsRefused(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	f := uploadPDFs(t, s, ua.ID, w.ID, "kept.pdf")[0]
	_, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{
		Question: "tóm tắt", AttachmentIDs: []string{f},
		Mentions: []ai.Focus{{Kind: "task", ID: "01J8X4NOSUCHTASK00000000000"}},
	})
	if !errors.Is(err, ai.ErrContextForbidden) {
		t.Fatalf("an unreadable mention: %v, want ai_context_forbidden", err)
	}
	requireNoQuestionStored(t, s, f)
}

// Two questions can pass the check on the same file before either commits;
// the claim then lets both attach it again, so the second store refuses it.
func TestStoreAttachesAFileToOneQuestionOnly(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	up, err := s.UploadAttachment(ctx, ua.ID, w.ID, "race.pdf", bytes.NewReader(pdfBody("race")))
	if err != nil {
		t.Fatal(err)
	}
	conv, err := s.q.AiCreateConversation(ctx, db.AiCreateConversationParams{ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	turn := askTurn{Question: "q", Answer: "a", Files: []AskAttachment{up}, UserID: ua.ID, WorkspaceID: w.ID}
	if _, err := s.store(ctx, w.OrganizationID, conv.ID, turn); err != nil {
		t.Fatal(err)
	}
	if _, err := s.store(ctx, w.OrganizationID, conv.ID, turn); !oneNotFound(err) {
		t.Fatalf("the second store of the same file: %v, want the bare not found", err)
	}
	var msgs, atts int
	if err := s.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM ai_messages), (SELECT count(*) FROM ai_attachments)`).Scan(&msgs, &atts); err != nil || msgs != 2 || atts != 1 {
		t.Fatalf("messages = %d, attachments = %d (%v), want the first question's 2 and 1", msgs, atts, err)
	}
}

// ---- Download and drop with the conversation (UNI-2119, Task 9) -------------

// sentAttachments asks one question carrying the files and returns the
// conversation and the ids the question holds them by.
func sentAttachments(t *testing.T, s *AskUNIService, userID, workspaceID string, fileIDs ...string) (string, []string) {
	t.Helper()
	ctx := context.Background()
	res, err := s.Ask(ctx, userID, workspaceID, AskInput{Question: "tóm tắt", AttachmentIDs: fileIDs})
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := s.Messages(ctx, userID, res.ConversationID)
	if err != nil || len(msgs) == 0 || len(msgs[0].Attachments) != len(fileIDs) {
		t.Fatalf("messages = %+v (%v), want the question to carry %d files", msgs, err, len(fileIDs))
	}
	ids := make([]string, len(fileIDs))
	for i, a := range msgs[0].Attachments {
		ids[i] = a.ID
	}
	return res.ConversationID, ids
}

func TestOpenAttachmentOnlyForTheAsker(t *testing.T) {
	s, flags, ua, ub, w := attachFixture(t)
	ctx := context.Background()
	file := uploadPDFs(t, s, ua.ID, w.ID, "mine.pdf")[0]
	_, ids := sentAttachments(t, s, ua.ID, w.ID, file)

	read := func() (AskAttachment, []byte) {
		t.Helper()
		r, att, err := s.OpenAttachment(ctx, ua.ID, w.ID, ids[0])
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		return att, body
	}
	att, body := read()
	if want := (AskAttachment{ID: ids[0], FileID: file, Name: "mine.pdf", MIME: "application/pdf", Kind: "pdf", Size: int64(len(pdfOfPages(1)))}); att != want || !bytes.Equal(body, pdfOfPages(1)) {
		t.Fatalf("the asker got %+v with %d bytes, want %+v with the uploaded bytes", att, len(body), want)
	}

	// Another member of the workspace, the id of a row that never was, and the
	// file id (an upload's name, not the row's) are one answer.
	for name, tc := range map[string]struct{ user, id string }{
		"another member":    {ub.ID, ids[0]},
		"an unknown id":     {ua.ID, "01J8X4NOSUCHATTACH000000000"},
		"the file id":       {ua.ID, file},
		"an empty id":       {ua.ID, ""},
		"another's unknown": {ub.ID, "01J8X4NOSUCHATTACH000000000"},
	} {
		if r, _, err := s.OpenAttachment(ctx, tc.user, w.ID, tc.id); !oneNotFound(err) {
			_ = r.Close()
			t.Errorf("%s: %v, want the bare not found", name, err)
		}
	}

	// What a person attached stays theirs to download when files are switched
	// off: the flags gate adding files, not taking them back.
	flags.attachments = false
	if _, body := read(); !bytes.Equal(body, pdfOfPages(1)) {
		t.Fatal("the asker could not download their file with the flag off")
	}
}

// pendingCleanups is how many files have a pending cleanup job: the file store
// has been told nothing holds them any more.
func pendingCleanups(t *testing.T, s *AskUNIService, fileIDs ...string) int {
	t.Helper()
	n := 0
	for _, id := range fileIDs {
		jobs, err := s.q.ListFileJobsByFile(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if got := jobStatuses(jobs, fileJobCleanup); len(got) == 1 && got[0] == "pending" {
			n++
		}
	}
	return n
}

func TestDeleteConversationReleasesItsFiles(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	gone, kept := uploadPDFs(t, s, ua.ID, w.ID, "a.pdf", "b.pdf"), uploadPDFs(t, s, ua.ID, w.ID, "other.pdf")
	conv, ids := sentAttachments(t, s, ua.ID, w.ID, gone...)
	_, keptIDs := sentAttachments(t, s, ua.ID, w.ID, kept...)
	if n := pendingCleanups(t, s, append(slices.Clone(gone), kept...)...); n != 0 {
		t.Fatalf("%d files are queued for cleanup before anything was deleted", n)
	}

	if err := s.DeleteConversation(ctx, ua.ID, conv); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM ai_attachments WHERE conversation_id = $1`, conv).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("%d ai_attachments rows are left on the deleted conversation (%v)", rows, err)
	}
	if n := pendingCleanups(t, s, gone...); n != 2 {
		t.Fatalf("%d of the deleted conversation's 2 files are queued for cleanup", n)
	}
	for _, id := range ids {
		if _, _, err := s.OpenAttachment(ctx, ua.ID, w.ID, id); !oneNotFound(err) {
			t.Errorf("a deleted conversation's file %s: %v, want the bare not found", id, err)
		}
	}
	// Another conversation's file is the asker's still.
	if n := pendingCleanups(t, s, kept...); n != 0 {
		t.Fatalf("%d files of another conversation were released with it", n)
	}
	r, _, err := s.OpenAttachment(ctx, ua.ID, w.ID, keptIDs[0])
	if err != nil {
		t.Fatalf("another conversation's file: %v", err)
	}
	_ = r.Close()
}

// A file id is released once however many rows name it, in one call, and a
// conversation with no file never calls the store at all.
func TestDeleteConversationReleasesEachFileOnce(t *testing.T) {
	s, _, ua, _, w := attachFixture(t)
	ctx := context.Background()
	spy := &releaseSpy{Service: s.files}
	s.SetFiles(spy)
	file := uploadPDFs(t, s, ua.ID, w.ID, "twice.pdf")[0]
	conv, _ := sentAttachments(t, s, ua.ID, w.ID, file)
	var msg string
	if err := s.pool.QueryRow(ctx, `SELECT message_id FROM ai_attachments WHERE conversation_id = $1`, conv).Scan(&msg); err != nil {
		t.Fatal(err)
	}
	if err := s.q.AiInsertAttachment(ctx, db.AiInsertAttachmentParams{
		ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: ua.ID, ConversationID: conv,
		MessageID: msg, FileID: file, Name: "twice.pdf", Mime: "application/pdf", SizeBytes: 10, Kind: "pdf",
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteConversation(ctx, ua.ID, conv); err != nil {
		t.Fatal(err)
	}
	if want := [][]files.FileID{{files.FileID(file)}}; !slices.EqualFunc(spy.released, want, slices.Equal) {
		t.Fatalf("released %v, want one call with the one file %v", spy.released, want)
	}

	spy.released = nil
	plain, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "không file"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteConversation(ctx, ua.ID, plain.ConversationID); err != nil || len(spy.released) != 0 {
		t.Fatalf("a conversation with no file: %v, released %v, want nothing", err, spy.released)
	}
}
