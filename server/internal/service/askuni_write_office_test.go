package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askOfficeWorld is the proposal world with documents, the file store and the
// Office service (no engine: docx needs none) wired into Ask UNI.
func askOfficeWorld(t *testing.T) (*mcpToolWorld, *AskUNIService, ai.ToolContext, *DocumentService) {
	t.Helper()
	x, s, tc := proposalWorld(t)
	docs := x.docs(t)
	s.SetDocuments(docs)
	s.SetFiles(x.files)
	s.SetOffice(NewDocumentOfficeService(DocumentOfficeOptions{Pool: s.pool, Queries: s.q, Files: x.files, Documents: docs}))
	return x, s, tc, docs
}

func officeTemplate(t *testing.T, docs *DocumentService, ownerID, wsID, filename string, body []byte) db.Document {
	t.Helper()
	res, err := docs.CreateFileDocument(context.Background(), Human(ownerID), wsID, CreateFileDocumentInput{
		Filename: filename, Body: bytes.NewReader(body), Template: true, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Document
}

func officeField(row askDraftRow, field string) (AskProposalField, bool) {
	for _, f := range row.Preview.Fields {
		if f.Field == field {
			return f, true
		}
	}
	return AskProposalField{}, false
}

func officePrepareErr(s *AskUNIService, tc ai.ToolContext, args string) (askDraftRow, error) {
	return s.prepareCreateOffice(context.Background(), tc, json.RawMessage(args), nil)
}

func isInvalidArgs(err error) bool {
	var in McpInvalidArgs
	return errors.As(err, &in)
}

func applyOffice(t *testing.T, s *AskUNIService, tc ai.ToolContext, userID string, row askDraftRow) AskProposal {
	t.Helper()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	pr := propose(t, s, tc, convID, msgID, AskModeAsk, row)[0]
	p, err := s.ApplyProposal(context.Background(), userID, pr.ID)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if p.Status != "applied" {
		t.Fatalf("apply left %+v", p)
	}
	return p
}

func TestAskCreateOfficeFromTemplate(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	ctx := context.Background()
	tpl := officeTemplate(t, docs, x.ua.ID, x.w.ID, "bao-gia.docx", docxBody(t, util.NewID()))

	row := askPrepare(t, s, tc, "create_office_document", fmt.Sprintf(`{"title":"Báo giá Q4","template_id":%q,"outline":"## Phần 1"}`, tpl.ID))
	if f, ok := officeField(row, "template_id"); row.Level != askLevel2 || !ok || f.To != tpl.Title || f.Type != "text" {
		t.Fatalf("row = %+v", row)
	}
	if loc, ok := officeField(row, "location"); !ok || loc.To != "my_folder" || row.Preview.Body != "## Phần 1" || row.Preview.Audience.Visibility != "private" {
		t.Fatalf("preview = %+v", row.Preview)
	}

	p := applyOffice(t, s, tc, x.ua.ID, row)
	id := p.Result.ObjectID
	var vis, src, creator string
	var parent *string
	if err := s.pool.QueryRow(ctx, `SELECT visibility, COALESCE(source_document_id,''), created_by, parent_id FROM documents WHERE id = $1`, id).Scan(&vis, &src, &creator, &parent); err != nil {
		t.Fatal(err)
	}
	if vis != "restricted" || src != tpl.ID || creator != x.ua.ID || parent == nil {
		t.Fatalf("new document: visibility %s source %s creator %s parent %v", vis, src, creator, parent)
	}
	if rev := x.count(t, `SELECT revision FROM documents WHERE id = $1`, tpl.ID); int64(rev) != tpl.Revision {
		t.Fatalf("template revision %d, was %d", rev, tpl.Revision)
	}
	if !strings.HasSuffix(p.Result.Href, "/documents/"+id) {
		t.Fatalf("href = %q", p.Result.Href)
	}

	if u, err := s.UndoProposal(ctx, x.ua.ID, p.ID); err != nil || u.Status != "undone" {
		t.Fatalf("undo: %+v, %v", u, err)
	}
	if n := x.count(t, `SELECT count(*) FROM documents WHERE id = $1 AND archived_at IS NOT NULL`, id); n != 1 {
		t.Fatal("the new file is not in the trash")
	}
}

func TestAskCreateOfficeBlank(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	row := askPrepare(t, s, tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## Mục 1"}`)
	if f, ok := officeField(row, "format"); !ok || f.Type != "enum" || f.To != "docx" || len(f.Options) != 6 {
		t.Fatalf("format field = %+v", f)
	}
	p := applyOffice(t, s, tc, x.ua.ID, row)
	var mimeType string
	if err := s.pool.QueryRow(context.Background(), `SELECT mime_type FROM document_versions WHERE document_id = $1`, p.Result.ObjectID).Scan(&mimeType); err != nil {
		t.Fatal(err)
	}
	if want, _ := files.DocumentFormatMime("docx"); mimeType != want {
		t.Fatalf("mime = %s, want %s", mimeType, want)
	}

	_, err := officePrepareErr(s, tc, `{"title":"Đề xuất","format":"docx"}`)
	if !isInvalidArgs(err) || !strings.Contains(err.Error(), "outline") {
		t.Fatalf("a blank without an outline: %v", err)
	}

	// Without the Office service the blank path answers office_not_configured.
	s.SetOffice(nil)
	_, _, err = writeToolNamed(t, s, "create_office_document").apply(context.Background(), principalOf(tc), row)
	if codeOf(err) != "office_not_configured" {
		t.Fatalf("apply without office: %v", err)
	}
}

func TestAskCreateOfficeNeedsExactlyOneSource(t *testing.T) {
	_, s, tc, _ := askOfficeWorld(t)
	for _, args := range []string{
		`{"title":"A","outline":"x"}`,
		`{"title":"A","template_id":"t1","format":"docx","outline":"x"}`,
		`{"title":"A","attachment_id":"a1","format":"docx","outline":"x"}`,
	} {
		if _, err := officePrepareErr(s, tc, args); !isInvalidArgs(err) {
			t.Errorf("%s: %v, want invalid_args", args, err)
		}
	}
}

func TestAskCreateOfficeRefusesTemplatesTheAskerCannotUse(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	ctx := context.Background()
	member := x.member(t)
	tcB := ai.ToolContext{ActorID: member.UserID, OrganizationID: member.OrganizationID, WorkspaceID: x.w.ID}
	args := func(id string) string {
		return fmt.Sprintf(`{"title":"Từ mẫu","template_id":%q,"outline":"x"}`, id)
	}

	hidden := officeTemplate(t, docs, x.ua.ID, x.w.ID, "mau-rieng.docx", docxBody(t, util.NewID()))
	if _, err := s.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, hidden.ID); err != nil {
		t.Fatal(err)
	}
	row, err := officePrepareErr(s, tcB, args(hidden.ID))
	if !errors.Is(err, ErrNotFound) || strings.Contains(fmt.Sprint(row.Preview), hidden.Title) {
		t.Fatalf("a template the asker cannot read: %+v, %v", row, err)
	}

	plain, err := docs.CreateFileDocument(ctx, Human(x.ua.ID), x.w.ID, CreateFileDocumentInput{Filename: "thuong.docx", Body: bytes.NewReader(docxBody(t, util.NewID())), IdempotencyKey: util.NewID()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := officePrepareErr(s, tc, args(plain.Document.ID)); codeOf(err) != "template_unavailable" {
		t.Fatalf("an unmarked document: %v", err)
	}

	txt := officeTemplate(t, docs, x.ua.ID, x.w.ID, "ghi-chu.txt", []byte("xin chao"))
	if _, err := officePrepareErr(s, tc, args(txt.ID)); !isInvalidArgs(err) {
		t.Fatalf("a .txt template: %v, want invalid_args", err)
	}

	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	other := officeTemplate(t, docs, x.ua.ID, v2.Workspace.ID, "mau-hai.docx", docxBody(t, util.NewID()))
	if _, err := officePrepareErr(s, tc, args(other.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a template of another workspace: %v, want not found", err)
	}
}

func TestAskCreateOfficeNeedsEditOnTheFolder(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	ctx := context.Background()
	member := x.member(t)
	// Folders cannot be shared; a page can, and the create gate asks edit of any parent.
	folder, err := docs.CreatePage(ctx, Human(member.UserID), x.w.ID, CreatePageInput{Title: "Thư mục của B", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	share := DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: x.ua.ID, Level: DocumentLevelView}
	if _, err := docs.ShareDocument(ctx, Human(member.UserID), folder.Document.ID, share); err != nil {
		t.Fatal(err)
	}
	args := fmt.Sprintf(`{"title":"Trong thư mục","format":"docx","outline":"x","parent_id":%q}`, folder.Document.ID)
	if _, err := officePrepareErr(s, tc, args); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a folder the asker only views: %v, want forbidden", err)
	}

	share.Level = DocumentLevelEdit
	if _, err := docs.ShareDocument(ctx, Human(member.UserID), folder.Document.ID, share); err != nil {
		t.Fatal(err)
	}
	row := askPrepare(t, s, tc, "create_office_document", args)
	if f, ok := officeField(row, "parent_id"); !ok || f.To != "Thư mục của B" {
		t.Fatalf("parent field = %+v", f)
	}
	share.Level = DocumentLevelView
	if _, err := docs.ShareDocument(ctx, Human(member.UserID), folder.Document.ID, share); err != nil {
		t.Fatal(err)
	}
	before := x.count(t, `SELECT count(*) FROM documents WHERE workspace_id = $1`, x.w.ID)
	if _, _, err := writeToolNamed(t, s, "create_office_document").apply(ctx, principalOf(tc), withWorkspace(t, row, x.w.ID)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("apply into a folder the asker lost edit on: %v, want forbidden", err)
	}
	if after := x.count(t, `SELECT count(*) FROM documents WHERE workspace_id = $1`, x.w.ID); after != before {
		t.Fatalf("documents %d -> %d", before, after)
	}
}

// withWorkspace is the row as the executor hands it to apply.
func withWorkspace(t *testing.T, row askDraftRow, wsID string) askDraftRow {
	t.Helper()
	args := map[string]json.RawMessage{}
	if err := json.Unmarshal(row.Args, &args); err != nil {
		t.Fatal(err)
	}
	args["workspace_id"] = rawJSON(wsID)
	b, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	row.Args = b
	return row
}

func TestAskCreateOfficeFromAttachment(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	ctx := context.Background()
	scope := files.Scope{OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID}
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	attach := func(userID, name string, body []byte) (db.AiInsertAttachmentParams, files.File) {
		t.Helper()
		up, err := x.files.Upload(ctx, files.UploadInput{Actor: Human(userID), Purpose: files.AiAttachment, Scope: scope, IdempotencyKey: util.NewID(), Filename: name, Body: bytes.NewReader(body)})
		if err != nil {
			t.Fatal(err)
		}
		p := db.AiInsertAttachmentParams{
			ID: util.NewID(), OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID, UserID: userID, ConversationID: convID, MessageID: msgID,
			FileID: string(up.File.ID), Name: up.File.Filename, Mime: up.File.ContentType, SizeBytes: up.File.SizeBytes, Kind: askAttachmentKind(up.File.ContentType),
		}
		if err := s.q.AiInsertAttachment(ctx, p); err != nil {
			t.Fatal(err)
		}
		return p, up.File
	}
	body := docxBody(t, util.NewID())
	mine, _ := attach(x.ua.ID, "de-cuong.docx", body)
	want := fmt.Sprintf("%x", sha256.Sum256(body))
	row := askPrepare(t, s, tc, "create_office_document", fmt.Sprintf(`{"title":"Đề cương","attachment_id":%q,"outline":"## Mở đầu"}`, mine.ID))
	if f, ok := officeField(row, "attachment_id"); !ok || f.To != "de-cuong.docx" {
		t.Fatalf("attachment field = %+v", f)
	}
	p := applyOffice(t, s, tc, x.ua.ID, row)
	var sum string
	if err := s.pool.QueryRow(ctx, `SELECT checksum_sha256 FROM document_versions WHERE document_id = $1`, p.Result.ObjectID).Scan(&sum); err != nil || sum != want {
		t.Fatalf("checksum %q (%v), want %q", sum, err, want)
	}

	member := x.member(t)
	theirs, _ := attach(member.UserID, "cua-b.docx", docxBody(t, util.NewID()))
	if _, err := officePrepareErr(s, tc, fmt.Sprintf(`{"title":"X","attachment_id":%q,"outline":"x"}`, theirs.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's attachment: %v, want not found", err)
	}
	csv, _ := attach(x.ua.ID, "so-lieu.csv", []byte("a,b\n1,2\n"))
	if _, err := officePrepareErr(s, tc, fmt.Sprintf(`{"title":"X","attachment_id":%q,"outline":"x"}`, csv.ID)); !isInvalidArgs(err) {
		t.Fatalf("a .csv attachment: %v, want invalid_args", err)
	}
}

func TestAskCreateOfficeVisibilityEdit(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	ctx := context.Background()
	row := askPrepare(t, s, tc, "create_office_document", `{"title":"Chia sẻ","format":"docx","outline":"## A"}`)
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	pr := propose(t, s, tc, convID, msgID, AskModeAsk, row)[0]
	got, err := s.EditProposal(ctx, x.ua.ID, pr.ID, map[string]json.RawMessage{"visibility": rawJSON("workspace")})
	if err != nil {
		t.Fatal(err)
	}
	var loc string
	for _, f := range got.Preview.Fields {
		if f.Field == "location" {
			loc, _ = f.To.(string)
		}
	}
	if loc != "workspace_root" || got.Preview.Audience.Visibility != "workspace" {
		t.Fatalf("after the edit: location %q, audience %q", loc, got.Preview.Audience.Visibility)
	}
	p, err := s.ApplyProposal(ctx, x.ua.ID, pr.ID)
	if err != nil || p.Status != "applied" {
		t.Fatalf("apply: %+v, %v", p, err)
	}
	var vis string
	var parent *string
	if err := s.pool.QueryRow(ctx, `SELECT visibility, parent_id FROM documents WHERE id = $1`, p.Result.ObjectID).Scan(&vis, &parent); err != nil {
		t.Fatal(err)
	}
	if vis != "workspace" || parent != nil {
		t.Fatalf("new document: visibility %s parent %v, want workspace at the root", vis, parent)
	}
}

func TestAskCreateOfficeCapsItsText(t *testing.T) {
	_, s, tc, _ := askOfficeWorld(t)
	for name, args := range map[string]string{
		"outline":      fmt.Sprintf(`{"title":"A","format":"docx","outline":%q}`, strings.Repeat("a", 16001)),
		"instructions": fmt.Sprintf(`{"title":"A","format":"docx","outline":"x","instructions":%q}`, strings.Repeat("a", 4001)),
	} {
		if _, err := officePrepareErr(s, tc, args); !isInvalidArgs(err) || !strings.Contains(err.Error(), name) {
			t.Errorf("%s over the cap: %v", name, err)
		}
	}
	if _, err := officePrepareErr(s, tc, fmt.Sprintf(`{"title":"A","format":"docx","outline":%q,"instructions":%q}`, strings.Repeat("a", 16000), strings.Repeat("b", 4000))); err != nil {
		t.Errorf("text at the cap: %v", err)
	}
}
