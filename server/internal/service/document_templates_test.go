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
