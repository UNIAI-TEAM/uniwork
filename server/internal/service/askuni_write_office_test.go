package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
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

// askAttach stores a file as the asker's attachment of a turn and returns its row.
func askAttach(t *testing.T, x *mcpToolWorld, s *AskUNIService, convID, msgID, userID, name string, body []byte) db.AiInsertAttachmentParams {
	t.Helper()
	ctx := context.Background()
	scope := files.Scope{OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID}
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
	return p
}

func TestAskSaveAttachmentTemplate(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	att := askAttach(t, x, s, convID, msgID, x.ua.ID, "bao-cao.pptx", docxLike(t, "ppt/presentation.xml", "ppt/slides/slide1.xml"))

	row := askPrepare(t, s, tc, "save_attachment_template", fmt.Sprintf(`{"attachment_id":%q}`, att.ID))
	if f, ok := officeField(row, "attachment_id"); row.Level != askLevel2 || !ok || f.Type != "text" || f.To != "bao-cao.pptx" {
		t.Fatalf("row = %+v", row)
	}
	if f, ok := officeField(row, "title"); !ok || f.To != "bao-cao.pptx" || row.Preview.Target.Kind != "document" || row.Preview.Audience.Visibility != "workspace" {
		t.Fatalf("preview = %+v", row.Preview)
	}

	p := applyOffice(t, s, tc, x.ua.ID, row)
	id := p.Result.ObjectID
	var vis, level, owner string
	var parent *string
	var marked *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT visibility, workspace_level, created_by, parent_id, template_marked_at FROM documents WHERE id = $1`, id).Scan(&vis, &level, &owner, &parent, &marked); err != nil {
		t.Fatal(err)
	}
	if vis != "workspace" || level != "edit" || owner != x.ua.ID || parent != nil || marked == nil {
		t.Fatalf("template: visibility %s level %s owner %s parent %v marked %v", vis, level, owner, parent, marked)
	}
	inList := func() bool {
		page, err := docs.ListTemplateDocuments(ctx, Human(x.ua.ID), x.w.ID, ListDocumentsInput{})
		if err != nil {
			t.Fatal(err)
		}
		for _, it := range page.Items {
			if it.Document.ID == id {
				return true
			}
		}
		return false
	}
	if !inList() {
		t.Fatal("the template is not in the Templates list")
	}

	if u, err := s.UndoProposal(ctx, x.ua.ID, p.ID); err != nil || u.Status != "undone" {
		t.Fatalf("undo: %+v, %v", u, err)
	}
	if n := x.count(t, `SELECT count(*) FROM documents WHERE id = $1 AND archived_at IS NOT NULL`, id); n != 1 {
		t.Fatal("the template is not in the trash")
	}
	if inList() {
		t.Fatal("a trashed template is still listed")
	}
}

func TestAskSaveAttachmentTemplateRefuses(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	member := x.member(t)
	theirs := askAttach(t, x, s, convID, msgID, member.UserID, "cua-b.docx", docxBody(t, util.NewID()))
	png := askAttach(t, x, s, convID, msgID, x.ua.ID, "anh.png", []byte("\x89PNG\r\n\x1a\n"))
	mine := askAttach(t, x, s, convID, msgID, x.ua.ID, "cua-a.docx", docxBody(t, util.NewID()))
	prep := func(args string) error {
		_, err := s.prepareSaveAttachmentTemplate(context.Background(), tc, json.RawMessage(args), nil)
		return err
	}
	byID := func(id string) string { return fmt.Sprintf(`{"attachment_id":%q}`, id) }
	if err := prep(byID(theirs.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("someone else's attachment: %v, want not found", err)
	}
	if err := prep(byID(png.ID)); !isInvalidArgs(err) {
		t.Fatalf("a .png attachment: %v, want invalid_args", err)
	}
	if err := prep(`{}`); !isInvalidArgs(err) {
		t.Fatalf("no attachment_id: %v, want invalid_args", err)
	}

	x.flags.byOrg = map[string]bool{x.w.OrganizationID: false}
	if err := prep(byID(mine.ID)); !errors.Is(err, errMcpDocumentsUnavailable) {
		t.Fatalf("documents flag off: %v, want documents_unavailable", err)
	}
}

// A flag switched off between the card and Apply closes Apply too, through
// ApplyProposal, and no file is made.
func TestAskCreateOfficeApplyClosedWhenDocumentsTurnOff(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	ctx := context.Background()
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	att := askAttach(t, x, s, convID, msgID, x.ua.ID, "mau.docx", docxBody(t, util.NewID()))
	for name, row := range map[string]askDraftRow{
		"create_office_document":   askPrepare(t, s, tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## A"}`),
		"save_attachment_template": askPrepare(t, s, tc, "save_attachment_template", fmt.Sprintf(`{"attachment_id":%q}`, att.ID)),
	} {
		pr := propose(t, s, tc, convID, msgID, AskModeAsk, row)[0]
		x.flags.byOrg = map[string]bool{x.w.OrganizationID: false}
		before := x.docRows(t)
		p, err := s.ApplyProposal(ctx, x.ua.ID, pr.ID)
		if codeOf(err) != "documents_unavailable" || p.Status != "failed" || p.ErrorCode != "documents_unavailable" {
			t.Fatalf("%s: %+v, %v; want a failed row with documents_unavailable", name, p, err)
		}
		if after := x.docRows(t); after != before {
			t.Fatalf("%s: documents %d -> %d", name, before, after)
		}
		x.flags.byOrg = nil
	}
}

// The new file's title carries its format's extension, on the card and on the file.
func TestAskCreateOfficeTitleGetsTheFormatExtension(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	for title, want := range map[string]string{"Báo giá Q4": "Báo giá Q4.docx", "Q4.docx": "Q4.docx", "Q4.DOCX": "Q4.DOCX"} {
		row := askPrepare(t, s, tc, "create_office_document", fmt.Sprintf(`{"title":%q,"format":"docx","outline":"## A"}`, title))
		if f, _ := officeField(row, "title"); f.To != want || row.Preview.Target.Title != want {
			t.Fatalf("%q: card title %v / %q, want %q", title, f.To, row.Preview.Target.Title, want)
		}
		p := applyOffice(t, s, tc, x.ua.ID, row)
		var got string
		if err := s.pool.QueryRow(context.Background(), `SELECT title FROM documents WHERE id = $1`, p.Result.ObjectID).Scan(&got); err != nil || got != want {
			t.Fatalf("%q: document title %q (%v), want %q", title, got, err, want)
		}
	}
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	att := askAttach(t, x, s, convID, msgID, x.ua.ID, "bao-cao.pptx", docxLike(t, "ppt/presentation.xml", "ppt/slides/slide1.xml"))
	row := askPrepare(t, s, tc, "save_attachment_template", fmt.Sprintf(`{"attachment_id":%q,"title":"Mẫu báo cáo"}`, att.ID))
	if f, _ := officeField(row, "title"); f.To != "Mẫu báo cáo.pptx" {
		t.Fatalf("template title = %v", f.To)
	}
	p := applyOffice(t, s, tc, x.ua.ID, row)
	var got string
	if err := s.pool.QueryRow(context.Background(), `SELECT title FROM documents WHERE id = $1`, p.Result.ObjectID).Scan(&got); err != nil || got != "Mẫu báo cáo.pptx" {
		t.Fatalf("template document title %q (%v)", got, err)
	}
}

func TestAskCreateOfficeRefusesAParentFromAnotherWorkspace(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	other, err := s.ws.CreateInOrg(context.Background(), x.ua.ID, x.w.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	page, err := docs.CreatePage(context.Background(), Human(x.ua.ID), other.Workspace.ID, CreatePageInput{Title: "Ở nơi khác", Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = officePrepareErr(s, tc, fmt.Sprintf(`{"title":"X","format":"docx","outline":"x","parent_id":%q}`, page.Document.ID))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("a parent of another workspace: %v, want not found", err)
	}
}

// editorAIFake answers reason for every format and records the formats asked.
type editorAIFake struct {
	reason  string
	formats []string
}

func (f *editorAIFake) EditorAIReason(_ context.Context, _, _, format string) string {
	f.formats = append(f.formats, format)
	return f.reason
}

// The card says whether the editor AI can draft the new file: compose, build
// for a deck, or why not; with no checker wired it says off.
func TestAskCreateOfficeCardSaysWhetherTheEditorAICanRun(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	editorAI := func(args string) any {
		t.Helper()
		f, ok := officeField(askPrepare(t, s, tc, "create_office_document", args), "editor_ai")
		if !ok || f.Type != "enum" {
			t.Fatalf("editor_ai field = %+v (%v)", f, ok)
		}
		return f.To
	}
	docx := `{"title":"Đề xuất","format":"docx","outline":"## A"}`
	if got := editorAI(docx); got != "off" {
		t.Fatalf("no checker wired: editor_ai = %v, want off", got)
	}
	fake := &editorAIFake{}
	s.SetEditorAI(fake)
	if got := editorAI(docx); got != "compose" {
		t.Fatalf("docx: editor_ai = %v, want compose", got)
	}
	if got := editorAI(`{"title":"Trình chiếu","format":"pptx","outline":"## Slide 1"}`); got != "build" {
		t.Fatalf("pptx: editor_ai = %v, want build", got)
	}
	fake.reason = "credits"
	if got := editorAI(docx); got != "credits" {
		t.Fatalf("credits spent: editor_ai = %v, want credits", got)
	}
	tpl := officeTemplate(t, docs, x.ua.ID, x.w.ID, "ghi-chu.md", []byte("# Ghi chú\n"))
	fake.formats = nil
	editorAI(fmt.Sprintf(`{"title":"Ghi chú","template_id":%q,"outline":"## A"}`, tpl.ID))
	if !slices.Equal(fake.formats, []string{"md"}) {
		t.Fatalf("an md template asked the checker for %v, want [md]", fake.formats)
	}
}

// flagMap is a flag source with fixed answers.
type flagMap map[string]bool

func (flagMap) Name() string { return "map" }

func (m flagMap) Lookup(_ context.Context, key string) (featureflag.Decision, bool) {
	on, ok := m[key]
	return featureflag.Decision{Enabled: on}, ok
}

// The gate reads what the frame's uniwork_ai grant reads: the plan, the
// UniWork AI and format flags, and the period's credits.
func TestEditorAIGateReadsTheFrameGrantGates(t *testing.T) {
	x, s, _, _ := askOfficeWorld(t)
	ctx := context.Background()
	org := x.w.OrganizationID
	cloud := NewAICloudService(s.orgs, NewEntitlementService(s.pool, s.q), ai.NewGateway(s.q, &provider.Fake{}, nil, nil, ai.Options{}))
	flags := flagMap{"office_ai_uniwork": true, "office_ai_uniwork_docx": true, "office_ai_uniwork_markdown": false}
	gate := NewEditorAIGate(cloud, NewOfficeCapabilitiesService(s.orgs, featureflag.NewService(flags)))
	plan := func(overrides string) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = $2::jsonb WHERE organization_id = $1`, org, overrides); err != nil {
			t.Fatal(err)
		}
	}
	check := func(name, format, want string) {
		t.Helper()
		if got := gate.EditorAIReason(ctx, x.ua.ID, org, format); got != want {
			t.Fatalf("%s: reason %q, want %q", name, got, want)
		}
	}
	plan(`{"office.ai_cloud": false}`)
	check("no office.ai_cloud", "docx", "plan")
	plan(`{"office.ai_cloud": true, "ai.tokens": 1000000}`)
	check("everything on", "docx", "")
	check("markdown flag off", "md", "format_off")
	plan(`{"office.ai_cloud": true, "ai.tokens": 0}`)
	check("credits spent", "docx", "credits")
	plan(`{"office.ai_cloud": true, "ai.tokens": 1000000}`)
	flags["office_ai_uniwork"] = false
	check("office_ai_uniwork off", "docx", "off")
}

func officeWithSources(t *testing.T, sources []OfficeHandoffSource) string {
	t.Helper()
	b, err := json.Marshal(sources)
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf(`{"title":"Đề xuất","format":"docx","outline":"## A","sources":%s}`, b)
}

// Sources are checked, listed on the card one per line, and kept in the
// stored arguments for Apply.
func TestAskCreateOfficeSourcesAreCheckedAndShown(t *testing.T) {
	_, s, tc, _ := askOfficeWorld(t)
	one := OfficeHandoffSource{Kind: "task", ID: util.NewID(), Title: "Chuẩn bị báo cáo quý", Quote: "Doanh thu quý ba tăng 12%."}
	long, odd, untitled := one, one, one
	long.Quote = strings.Repeat("a", 1501)
	odd.Kind = "spaceship"
	untitled.Title = "  "
	for name, sources := range map[string][]OfficeHandoffSource{
		"9 sources":              slices.Repeat([]OfficeHandoffSource{one}, 9),
		"a 1501-character quote": {long},
		"an unknown kind":        {odd},
		"a blank title":          {untitled},
	} {
		if _, err := officePrepareErr(s, tc, officeWithSources(t, sources)); !isInvalidArgs(err) {
			t.Errorf("%s: %v, want invalid_args", name, err)
		}
	}
	room := OfficeHandoffSource{Kind: "room", ID: util.NewID(), Title: "Phòng kinh doanh", Quote: "Chốt giá trước thứ sáu."}
	if _, err := officePrepareErr(s, tc, officeWithSources(t, []OfficeHandoffSource{room})); err != nil {
		t.Errorf("a room source: %v, want accepted", err)
	}

	two := []OfficeHandoffSource{one, {Kind: "meeting", ID: util.NewID(), Title: "Họp giao ban", Quote: strings.Repeat("b", 300)}}
	row := askPrepare(t, s, tc, "create_office_document", officeWithSources(t, two))
	f, ok := officeField(row, "sources")
	text, _ := f.To.(string)
	lines := strings.Split(text, "\n")
	if !ok || f.Type != "markdown" || len(lines) != 2 || !strings.Contains(lines[0], "**Chuẩn bị báo cáo quý**") || !strings.Contains(lines[1], "**Họp giao ban**") {
		t.Fatalf("sources field = %+v", f)
	}
	if !strings.Contains(lines[1], "“"+strings.Repeat("b", 200)+"…”") {
		t.Fatalf("the quote is not cut to its first 200 characters: %q", lines[1])
	}
	var stored struct {
		Sources []OfficeHandoffSource `json:"sources"`
	}
	if err := json.Unmarshal(row.Args, &stored); err != nil || !slices.Equal(stored.Sources, two) {
		t.Fatalf("stored sources %+v (%v), want %+v", stored.Sources, err, two)
	}

	row = askPrepare(t, s, tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## A"}`)
	if f, ok := officeField(row, "sources"); ok {
		t.Fatalf("a card without sources has a sources field: %+v", f)
	}
}

// Apply writes the package the editor AI drafts from, bound to the asker, the
// new document and the proposal, for 24 hours.
func TestAskCreateOfficeApplyWritesAHandoff(t *testing.T) {
	x, s, tc, docs := askOfficeWorld(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	s.SetEditorAI(&editorAIFake{})
	tpl := officeTemplate(t, docs, x.ua.ID, x.w.ID, "bao-gia.docx", docxBody(t, util.NewID()))
	source := OfficeHandoffSource{Kind: "task", ID: x.taskID, Title: "Chuẩn bị báo cáo quý", Quote: "Hạn nộp là thứ sáu."}
	args, err := json.Marshal(map[string]any{
		"title": "Báo giá Q4", "template_id": tpl.ID, "instructions": "Điền giá theo bảng mới.",
		"outline": "## Một\n## Hai\n## Ba\n## Bốn", "sources": []OfficeHandoffSource{source},
	})
	if err != nil {
		t.Fatal(err)
	}
	row := askPrepare(t, s, tc, "create_office_document", string(args))
	convID, msgID := askAnswer(t, s, tc, "x", nil)
	pr := propose(t, s, tc, convID, msgID, AskModeAsk, row)[0]
	p, err := s.ApplyProposal(ctx, x.ua.ID, pr.ID)
	if err != nil || p.Status != "applied" || p.Result.HandoffID == "" {
		t.Fatalf("apply: %+v, %v; want a handoff_id", p, err)
	}
	h, err := loadOfficeHandoff(ctx, s.q, p.Result.HandoffID, x.w.OrganizationID, x.ua.ID, p.Result.ObjectID, "", now)
	if err != nil {
		t.Fatalf("load handoff: %v", err)
	}
	if h.UserID != x.ua.ID || h.DocumentID != p.Result.ObjectID || h.ProposalID != pr.ID || h.Format != "docx" ||
		h.Request != "Điền giá theo bảng mới." || len(h.Parts) != 2 || !slices.Equal(h.Sources, []OfficeHandoffSource{source}) ||
		!h.ExpiresAt.Equal(now.Add(24*time.Hour)) {
		t.Fatalf("handoff = %+v", h)
	}
}

// The check runs again at Apply: when the editor AI cannot run by then, the
// file is still made, with no package.
func TestAskCreateOfficeApplyWithoutEditorAIWritesNoHandoff(t *testing.T) {
	x, s, tc, _ := askOfficeWorld(t)
	fake := &editorAIFake{}
	s.SetEditorAI(fake)
	row := askPrepare(t, s, tc, "create_office_document", `{"title":"Đề xuất","format":"docx","outline":"## A\n## B","instructions":"Viết ngắn."}`)
	if f, _ := officeField(row, "editor_ai"); f.To != "compose" {
		t.Fatalf("editor_ai = %v, want compose", f.To)
	}
	fake.reason = "off"
	p := applyOffice(t, s, tc, x.ua.ID, row)
	if p.Result.ObjectID == "" || p.Result.HandoffID != "" {
		t.Fatalf("result = %+v, want a document and no handoff_id", p.Result)
	}
	if n := x.count(t, `SELECT count(*) FROM ai_office_handoffs WHERE organization_id = $1`, x.w.OrganizationID); n != 0 {
		t.Fatalf("%d handoff rows, want none", n)
	}
}
