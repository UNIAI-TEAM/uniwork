package service

// UNI-2225: marking a workspace file as a template. The mark is library
// state: idempotent, audited only on a real change, never carried by a copy,
// and kept through the trash.

import (
	"bytes"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type templateWorld struct {
	f  *docPermFixture
	tn docTenant
}

func newTemplateWorld(t *testing.T, slug string) templateWorld {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, slug)
	f.svc.SetFiles(filesfake.New(filesfake.Options{}))
	f.svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	f.svc.store.spoolDir = t.TempDir()
	return templateWorld{f: f, tn: tn}
}

// file creates a file document as the ACL owner; workspace files stay at the
// view level the root create gives them.
func (w templateWorld) file(t *testing.T, visibility string) db.Document {
	t.Helper()
	res, err := w.f.svc.CreateFileDocument(w.f.ctx, Human(w.tn.aclOwner.ID), w.tn.wsA, CreateFileDocumentInput{
		Title: "Mẫu " + util.NewID(), Filename: "mau.pdf", Body: bytes.NewReader(pdfBody(util.NewID())),
		Visibility: visibility,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Document
}

func (w templateWorld) reload(t *testing.T, id string) db.Document {
	t.Helper()
	return w.f.listFilterReload(t, id)
}

func (w templateWorld) auditCount(t *testing.T, action, docID string) (n int) {
	t.Helper()
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (w templateWorld) outboxCount(t *testing.T, topic, docID string) (n int) {
	t.Helper()
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, topic, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMarkDocumentTemplateOnAWorkspaceFile(t *testing.T) {
	w := newTemplateWorld(t, "tplmark")
	doc := w.file(t, documentVisibilityWorkspace)
	member := Human(w.tn.member.ID)

	view, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, member, doc.ID, MarkDocumentTemplateInput{})
	if err != nil {
		t.Fatal(err)
	}
	got := view.Document
	if !got.TemplateMarkedAt.Valid || got.TemplateMarkedBy.String != w.tn.member.ID || got.TemplateMarkedByKind.String != "human" {
		t.Fatalf("mark = %+v", got)
	}
	if got.WorkspaceLevel != string(DocumentLevelView) || got.Visibility != documentVisibilityWorkspace {
		t.Fatalf("home row = %q/%q, want workspace/view", got.Visibility, got.WorkspaceLevel)
	}
	if got.Revision != doc.Revision {
		t.Fatalf("revision moved %d -> %d: the mark is not content", doc.Revision, got.Revision)
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	if n := w.outboxCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
	var ws string
	if err := w.f.pool.QueryRow(w.f.ctx,
		`SELECT payload::jsonb->>'workspace_id' FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`,
		audit.ActionDocumentTemplateMarked, doc.ID).Scan(&ws); err != nil || ws != w.tn.wsA {
		t.Fatalf("payload workspace_id = %q %v", ws, err)
	}
}

func TestMarkDocumentTemplateTwiceAuditsOnce(t *testing.T) {
	w := newTemplateWorld(t, "tpltwice")
	doc := w.file(t, documentVisibilityWorkspace)
	member := Human(w.tn.member.ID)
	for i := 0; i < 2; i++ {
		if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, member, doc.ID, MarkDocumentTemplateInput{}); err != nil {
			t.Fatalf("mark #%d: %v", i+1, err)
		}
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	if n := w.outboxCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
}

func TestMarkRestrictedDocumentTemplateNeedsConfirmation(t *testing.T) {
	w := newTemplateWorld(t, "tplwiden")
	doc := w.file(t, documentVisibilityRestricted)
	owner := Human(w.tn.aclOwner.ID)

	if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, owner, doc.ID, MarkDocumentTemplateInput{}); !codedIs(err, "template_widens_visibility") {
		t.Fatalf("unconfirmed mark = %v, want template_widens_visibility", err)
	}
	got := w.reload(t, doc.ID)
	if got.Visibility != documentVisibilityRestricted || got.TemplateMarkedAt.Valid {
		t.Fatalf("refused mark changed the row: %q marked=%v", got.Visibility, got.TemplateMarkedAt.Valid)
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 0 {
		t.Fatalf("refused mark audited %d rows", n)
	}

	view, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, owner, doc.ID, MarkDocumentTemplateInput{WidenToWorkspace: true})
	if err != nil {
		t.Fatal(err)
	}
	if v := view.Document; v.Visibility != documentVisibilityWorkspace || v.WorkspaceLevel != string(DocumentLevelEdit) || !v.TemplateMarkedAt.Valid {
		t.Fatalf("confirmed mark = %q/%q marked=%v", v.Visibility, v.WorkspaceLevel, v.TemplateMarkedAt.Valid)
	}
	if n := w.auditCount(t, audit.ActionDocumentWorkspaceAccessChanged, doc.ID); n != 1 {
		t.Fatalf("access-changed rows = %d, want 1", n)
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("template_marked rows = %d, want 1", n)
	}
}

func TestMarkRestrictedDocumentTemplateNeedsManage(t *testing.T) {
	w := newTemplateWorld(t, "tplmanage")
	doc := w.file(t, documentVisibilityRestricted)
	w.f.share(t, doc, DocumentPrincipalUser, w.tn.member.ID, DocumentLevelEdit, w.tn.aclOwner.ID)

	_, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, Human(w.tn.member.ID), doc.ID, MarkDocumentTemplateInput{WidenToWorkspace: true})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("editor widening a restricted file = %v, want ErrForbidden", err)
	}
	if got := w.reload(t, doc.ID); got.Visibility != documentVisibilityRestricted || got.TemplateMarkedAt.Valid {
		t.Fatalf("refused mark changed the row: %q marked=%v", got.Visibility, got.TemplateMarkedAt.Valid)
	}
}

func TestMarkDocumentTemplateRefusals(t *testing.T) {
	w := newTemplateWorld(t, "tplrefuse")
	member := Human(w.tn.member.ID)
	in := MarkDocumentTemplateInput{}

	t.Run("page", func(t *testing.T) {
		page := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: documentVisibilityWorkspace, aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID})
		_, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, member, page.ID, in)
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("page = %v, want a validation error", err)
		}
	})
	t.Run("shelved", func(t *testing.T) {
		doc := w.file(t, documentVisibilityWorkspace)
		if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET shelved_at = now(), shelved_by = $2,
			shelved_by_kind = 'human', shelve_batch_id = $3 WHERE id = $1`, doc.ID, w.tn.aclOwner.ID, util.NewID()); err != nil {
			t.Fatal(err)
		}
		if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, member, doc.ID, in); !codedIs(err, "document_shelved") {
			t.Fatalf("shelved = %v, want document_shelved", err)
		}
	})
	t.Run("agent", func(t *testing.T) {
		doc := w.file(t, documentVisibilityWorkspace)
		agent := Actor{Kind: audit.KindAgent, ID: w.tn.agent}
		if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, agent, doc.ID, in); !errors.Is(err, ErrForbidden) {
			t.Fatalf("agent = %v, want ErrForbidden", err)
		}
	})
	t.Run("other workspace", func(t *testing.T) {
		doc := w.file(t, documentVisibilityWorkspace)
		if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, Human(w.tn.bMember.ID), doc.ID, in); !errors.Is(err, ErrNotFound) {
			t.Fatalf("member of another workspace = %v, want ErrNotFound", err)
		}
	})
}

func TestUnmarkDocumentTemplate(t *testing.T) {
	w := newTemplateWorld(t, "tplunmark")
	doc := w.file(t, documentVisibilityWorkspace)
	if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, Human(w.tn.aclOwner.ID), doc.ID, MarkDocumentTemplateInput{}); err != nil {
		t.Fatal(err)
	}
	other := Human(w.tn.member.ID)

	view, err := w.f.svc.UnmarkDocumentTemplate(w.f.ctx, other, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v := view.Document; v.TemplateMarkedAt.Valid || v.TemplateMarkedBy.Valid || v.TemplateMarkedByKind.Valid {
		t.Fatalf("mark after unmark = %+v", v)
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateUnmarked, doc.ID); n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	if n := w.outboxCount(t, audit.ActionDocumentTemplateUnmarked, doc.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
	if _, err := w.f.svc.UnmarkDocumentTemplate(w.f.ctx, other, doc.ID); err != nil {
		t.Fatalf("second unmark: %v", err)
	}
	if n := w.auditCount(t, audit.ActionDocumentTemplateUnmarked, doc.ID); n != 1 {
		t.Fatalf("audit rows after a repeat = %d, want 1", n)
	}

	// A shelved template can still leave the library.
	if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, other, doc.ID, MarkDocumentTemplateInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET shelved_at = now(), shelved_by = $2,
		shelved_by_kind = 'human', shelve_batch_id = $3 WHERE id = $1`, doc.ID, w.tn.aclOwner.ID, util.NewID()); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.svc.UnmarkDocumentTemplate(w.f.ctx, other, doc.ID); err != nil {
		t.Fatalf("unmark on a shelved document: %v", err)
	}
	if w.reload(t, doc.ID).TemplateMarkedAt.Valid {
		t.Fatal("shelved document kept its mark")
	}
}

func TestCopiedTemplateIsNotATemplate(t *testing.T) {
	w := newTemplateWorld(t, "tplcopy")
	doc := w.file(t, documentVisibilityWorkspace)
	member := Human(w.tn.member.ID)
	if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, member, doc.ID, MarkDocumentTemplateInput{}); err != nil {
		t.Fatal(err)
	}
	// Copy needs edit on the source: the home row is raised for the copier.
	setWorkspaceLevel(t, w.f, doc, string(DocumentLevelEdit))
	copied, err := w.f.svc.CopyDocument(w.f.ctx, member, doc.ID, CopyDocumentInput{
		Consent: documentCopyConsent, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if c := w.reload(t, copied.Document.ID); c.TemplateMarkedAt.Valid || c.TemplateMarkedBy.Valid || c.TemplateMarkedByKind.Valid {
		t.Fatalf("copy carries the mark: %+v", c)
	}
	if !w.reload(t, doc.ID).TemplateMarkedAt.Valid {
		t.Fatal("copying cleared the source's mark")
	}
}

// templateFile uploads a workspace template as the ACL owner.
func (w templateWorld) templateFile(t *testing.T, name string, body []byte) db.Document {
	t.Helper()
	res, err := w.f.svc.CreateFileDocument(w.f.ctx, Human(w.tn.aclOwner.ID), w.tn.wsA, CreateFileDocumentInput{
		Filename: name, Body: bytes.NewReader(body), Template: true, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res.Document
}

func (w templateWorld) listTemplates(t *testing.T, actor Actor) map[string]db.Document {
	t.Helper()
	page, err := w.f.svc.ListTemplateDocuments(w.f.ctx, actor, w.tn.wsA, ListDocumentsInput{})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]db.Document{}
	for _, it := range page.Items {
		out[it.Document.ID] = it.Document
	}
	return out
}

func TestListTemplateDocuments(t *testing.T) {
	w := newTemplateWorld(t, "tpllist")
	member := Human(w.tn.member.ID)
	owner := Human(w.tn.aclOwner.ID)
	docx := w.templateFile(t, "bao-gia.docx", docxBody(t, util.NewID()))
	xlsx := w.templateFile(t, "don-hang.xlsx", officeFile(t, officeXLSXParts))
	plain := w.file(t, documentVisibilityWorkspace)
	hidden := w.file(t, documentVisibilityRestricted)
	if _, err := w.f.pool.Exec(w.f.ctx, `UPDATE documents SET template_marked_at = now(), template_marked_by = $2,
		template_marked_by_kind = 'human' WHERE id = $1`, hidden.ID, w.tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}

	got := w.listTemplates(t, member)
	if _, ok := got[docx.ID]; !ok || len(got) != 2 {
		t.Fatalf("member's templates = %v, want exactly the docx and xlsx", got)
	}
	if _, ok := got[xlsx.ID]; !ok {
		t.Fatal("xlsx template missing")
	}
	if _, ok := got[plain.ID]; ok {
		t.Fatal("a plain file is listed as a template")
	}
	if _, ok := got[hidden.ID]; ok {
		t.Fatal("a restricted template the caller cannot read is listed")
	}
	if own := w.listTemplates(t, owner); len(own) != 3 {
		t.Fatalf("owner's templates = %d, want 3 (the restricted one is theirs)", len(own))
	}

	if _, err := w.f.svc.ArchiveDocument(w.f.ctx, owner, docx.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.listTemplates(t, member)[docx.ID]; ok {
		t.Fatal("a trashed template stays listed")
	}
	if _, err := w.f.svc.RestoreDocument(w.f.ctx, owner, docx.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := w.listTemplates(t, member)[docx.ID]; !ok {
		t.Fatal("a restored template is not back in the list")
	}

	agent := Actor{Kind: audit.KindAgent, ID: w.tn.agent}
	if _, err := w.f.svc.ListTemplateDocuments(w.f.ctx, agent, w.tn.wsA, ListDocumentsInput{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent = %v, want ErrForbidden", err)
	}
}

func TestListTemplateDocumentsKeepsTheMarkOnRows(t *testing.T) {
	w := newTemplateWorld(t, "tplrows")
	w.templateFile(t, "bao-gia.docx", docxBody(t, util.NewID()))
	member := Human(w.tn.member.ID)
	rows := w.listTemplates(t, member)
	if len(rows) != 1 {
		t.Fatalf("templates = %d, want 1", len(rows))
	}
	for id, d := range rows {
		if !d.TemplateMarkedAt.Valid || d.TemplateMarkedBy.String != w.tn.aclOwner.ID || d.TemplateMarkedByKind.String != "human" {
			t.Fatalf("row %s lost its mark: %+v", id, d)
		}
	}
	// The flat list carries it too (listRowDocument copies the columns).
	page, err := w.f.svc.ListDocuments(w.f.ctx, member, w.tn.wsA, ListDocumentsInput{})
	if err != nil {
		t.Fatal(err)
	}
	var marked int
	for _, it := range page.Items {
		if it.Document.TemplateMarkedAt.Valid {
			marked++
		}
	}
	if marked != 1 {
		t.Fatalf("flat list rows with a mark = %d, want 1", marked)
	}
}

func TestCreateFileDocumentAsTemplate(t *testing.T) {
	w := newTemplateWorld(t, "tplcreate")
	doc := w.templateFile(t, "bao-gia.docx", docxBody(t, util.NewID()))
	got := w.reload(t, doc.ID)
	if got.ParentID.Valid || got.Visibility != documentVisibilityWorkspace || got.WorkspaceLevel != string(DocumentLevelEdit) ||
		got.AclOwnerID.String != w.tn.aclOwner.ID {
		t.Fatalf("template home row = parent %v %q/%q owner %q", got.ParentID, got.Visibility, got.WorkspaceLevel, got.AclOwnerID.String)
	}
	if !got.TemplateMarkedAt.Valid || got.TemplateMarkedBy.String != w.tn.aclOwner.ID {
		t.Fatalf("mark = %+v", got)
	}
	for _, action := range []string{audit.ActionDocumentCreated, audit.ActionDocumentTemplateMarked} {
		if n := w.auditCount(t, action, doc.ID); n != 1 {
			t.Fatalf("%s audit rows = %d, want 1", action, n)
		}
	}
	if n := w.outboxCount(t, audit.ActionDocumentTemplateMarked, doc.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
}

func TestCreateFileDocumentAsTemplateOnlyAtTheRoot(t *testing.T) {
	w := newTemplateWorld(t, "tplroot")
	owner := Human(w.tn.aclOwner.ID)
	page := w.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: documentVisibilityWorkspace, aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID})
	for name, in := range map[string]CreateFileDocumentInput{
		"parent":      {ParentID: page.ID},
		"destination": {Destination: DocumentSystemKindMyFolder},
	} {
		in.Template, in.Filename, in.Body = true, "mau.pdf", bytes.NewReader(pdfBody(util.NewID()))
		if _, err := w.f.svc.CreateFileDocument(w.f.ctx, owner, w.tn.wsA, in); !isInvalid(err) {
			t.Fatalf("%s = %v, want a validation error", name, err)
		}
	}
	var n int
	if err := w.f.pool.QueryRow(w.f.ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1 AND kind = 'file'`, w.tn.wsA).Scan(&n); err != nil || n != 0 {
		t.Fatalf("files created = %d %v, want 0", n, err)
	}
}

func TestCreateFileDocumentAsTemplateIsIdempotent(t *testing.T) {
	w := newTemplateWorld(t, "tplidem")
	owner := Human(w.tn.aclOwner.ID)
	body := pdfBody(util.NewID())
	create := func(template bool) (DocumentFileResult, error) {
		return w.f.svc.CreateFileDocument(w.f.ctx, owner, w.tn.wsA, CreateFileDocumentInput{
			Filename: "mau.pdf", Body: bytes.NewReader(body), Template: template, IdempotencyKey: "tpl-key-1",
		})
	}
	first, err := create(true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := create(true)
	if err != nil {
		t.Fatal(err)
	}
	if first.Document.ID != second.Document.ID {
		t.Fatalf("replay made a second document: %s vs %s", first.Document.ID, second.Document.ID)
	}
	for _, action := range []string{audit.ActionDocumentCreated, audit.ActionDocumentTemplateMarked} {
		if n := w.auditCount(t, action, first.Document.ID); n != 1 {
			t.Fatalf("%s audit rows = %d, want 1", action, n)
		}
	}
	if _, err := create(false); !codedIs(err, "idempotency_payload_mismatch") {
		t.Fatalf("same key without Template = %v, want idempotency_payload_mismatch", err)
	}
}

func TestFileCreateFingerprintChangesOnlyForATemplate(t *testing.T) {
	plain := fileCreateFingerprint("ws", "", "t", "sum", "", "", false)
	if plain != IdempotencyFingerprint(idempotencyScopeDocumentFileCreate, "ws", "", "t", "sum") {
		t.Fatal("a non-template fingerprint changed")
	}
	if plain == fileCreateFingerprint("ws", "", "t", "sum", "", "", true) {
		t.Fatal("a template shares the plain fingerprint")
	}
}

func TestArchivedTemplateKeepsItsMark(t *testing.T) {
	w := newTemplateWorld(t, "tplarchive")
	doc := w.file(t, documentVisibilityWorkspace)
	owner := Human(w.tn.aclOwner.ID)
	if _, err := w.f.svc.MarkDocumentTemplate(w.f.ctx, owner, doc.ID, MarkDocumentTemplateInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.svc.ArchiveDocument(w.f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := w.f.svc.RestoreDocument(w.f.ctx, owner, doc.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if got := w.reload(t, doc.ID); !got.TemplateMarkedAt.Valid || got.TemplateMarkedBy.String != w.tn.aclOwner.ID {
		t.Fatalf("mark after trash and restore = %+v", got)
	}
}
