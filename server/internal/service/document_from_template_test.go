package service

// Create-from-template (UNI-2261): the new file is the asker's own, reuses the
// template's file id without copying bytes, and never inherits the template's
// access. CheckCreateIn is the read-only pre-flight Ask UNI runs before it
// shows a proposal.

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// templateFromWorld creates a marked template in wsA as the ACL owner.
func templateFromWorld(t *testing.T, env *docStorageEnv, name string) DocumentFileResult {
	t.Helper()
	res, err := env.svc.CreateFileDocument(env.f.ctx, human(env.tn.aclOwner), env.tn.wsA, CreateFileDocumentInput{
		Filename: name, Body: bytes.NewReader(pdfBody(util.NewID())), Template: true, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func docCount(t *testing.T, env *docStorageEnv, ws string) (n int) {
	t.Helper()
	if err := env.f.pool.QueryRow(env.f.ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1`, ws).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCreateDocumentFromTemplateMakesTheAskersOwnFile(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	tpl := templateFromWorld(t, env, "bao-gia.pdf")
	b := human(env.tn.member)
	usage := env.usage(t)

	res, err := env.svc.CreateDocumentFromTemplate(env.f.ctx, b, env.tn.wsA, CreateFromTemplateInput{
		TemplateID: tpl.Document.ID, Destination: DocumentSystemKindMyFolder, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	d := res.Document
	if d.AclOwnerID.String != b.ID || d.Visibility != documentVisibilityRestricted {
		t.Fatalf("home row = owner %q %q, want the asker and restricted", d.AclOwnerID.String, d.Visibility)
	}
	mf, err := env.f.q.GetMyFolder(env.f.ctx, db.GetMyFolderParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, AclOwnerID: nullText(b.ID),
	})
	if err != nil || d.ParentID.String != mf.ID {
		t.Fatalf("parent = %q, want the asker's My Folder %q (%v)", d.ParentID.String, mf.ID, err)
	}
	if d.TemplateMarkedAt.Valid {
		t.Fatal("a document made from a template must not carry the template mark")
	}
	srcTpl := env.doc(t, tpl.Document.ID)
	if d.SourceDocumentID.String != srcTpl.ID || d.SourceVersionID.String != tpl.Version.ID {
		t.Fatalf("provenance = %q/%q, want %s/%s", d.SourceDocumentID.String, d.SourceVersionID.String, srcTpl.ID, tpl.Version.ID)
	}
	if d.Title != srcTpl.Title {
		t.Fatalf("title = %q, want the template's %q", d.Title, srcTpl.Title)
	}
	if res.Version.FileID.String != tpl.Version.FileID.String {
		t.Fatalf("file = %s, want the template's %s", res.Version.FileID.String, tpl.Version.FileID.String)
	}
	if got := env.usage(t); got != usage {
		t.Fatalf("storage used %d -> %d: reusing a file id adds no bytes", usage, got)
	}
	if n := env.countAudit(t, audit.ActionDocumentCreated, d.ID); n != 1 {
		t.Fatalf("document.created audit rows = %d, want 1", n)
	}
	if n := env.countOutbox(t, "document.created", d.ID); n != 1 {
		t.Fatalf("document.created outbox rows = %d, want 1", n)
	}
	var raw []byte
	if err := env.f.pool.QueryRow(env.f.ctx,
		`SELECT changes FROM audit_events WHERE resource_id = $1 AND action = 'document.created'`, d.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var changes map[string]struct {
		To any `json:"to"`
	}
	if err := json.Unmarshal(raw, &changes); err != nil {
		t.Fatal(err)
	}
	if changes["reason"].To != "template" || changes["source_document_id"].To != srcTpl.ID {
		t.Fatalf("audit changes = %s, want reason template and the source id", raw)
	}
}

func TestCreateDocumentFromTemplateLeavesTheTemplateAlone(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	tpl := templateFromWorld(t, env, "mau.pdf")
	c := env.tn.creator
	env.f.share(t, tpl.Document, DocumentPrincipalUser, c.ID, DocumentLevelComment, env.tn.aclOwner.ID)
	before := env.doc(t, tpl.Document.ID)
	b := human(env.tn.member)

	res, err := env.svc.CreateDocumentFromTemplate(env.f.ctx, b, env.tn.wsA, CreateFromTemplateInput{
		TemplateID: tpl.Document.ID, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	shares, err := env.f.q.ListDocumentShares(env.f.ctx, db.ListDocumentSharesParams{
		OrganizationID: env.tn.orgID, WorkspaceID: env.tn.wsA, DocumentID: res.Document.ID,
	})
	if err != nil || len(shares) != 0 {
		t.Fatalf("new file shares = %d %v, want none", len(shares), err)
	}
	// A second version on the new file must not touch the template.
	up := env.upload(t, b, res.Document.ID, "mau.pdf", pdfBody(util.NewID()))
	if _, err := env.commit(b, res.Document.ID, up.UploadID, res.Document.Revision, util.NewID()); err != nil {
		t.Fatal(err)
	}
	after := env.doc(t, tpl.Document.ID)
	if after.CurrentVersion != before.CurrentVersion || after.Revision != before.Revision ||
		after.TemplateMarkedAt.Valid != before.TemplateMarkedAt.Valid || !after.TemplateMarkedAt.Time.Equal(before.TemplateMarkedAt.Time) {
		t.Fatalf("template moved: %+v -> %+v", before, after)
	}
}

func TestCreateDocumentFromTemplateRefusesWhatIsNotATemplate(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	owner := human(env.tn.aclOwner)
	b := human(env.tn.member)
	plain, err := env.svc.CreateFileDocument(env.f.ctx, owner, env.tn.wsA, CreateFileDocumentInput{
		Title: "Thường", Filename: "thuong.pdf", Body: bytes.NewReader(pdfBody(util.NewID())),
		Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatal(err)
	}
	trashed := templateFromWorld(t, env, "thung-rac.pdf")
	if _, err := env.svc.ArchiveDocument(env.f.ctx, owner, trashed.Document.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	// A marked file B cannot read: mark by SQL, the way an old row might be.
	hidden, err := env.svc.CreateFileDocument(env.f.ctx, owner, env.tn.wsA, CreateFileDocumentInput{
		Title: "Kín", Filename: "kin.pdf", Body: bytes.NewReader(pdfBody(util.NewID())),
		Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.f.pool.Exec(env.f.ctx,
		`UPDATE documents SET template_marked_at = now(), template_marked_by = $2, template_marked_by_kind = 'human' WHERE id = $1`,
		hidden.Document.ID, owner.ID); err != nil {
		t.Fatal(err)
	}
	otherWS := templateFromWorld(t, env, "khac.pdf")
	if _, err := env.f.pool.Exec(env.f.ctx, `UPDATE documents SET workspace_id = $2 WHERE id = $1`, otherWS.Document.ID, env.tn.wsB); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name  string
		actor Actor
		id    string
		check func(error) bool
	}{
		{"not marked", b, plain.Document.ID, func(err error) bool { return codedIs(err, "template_unavailable") }},
		{"trashed", b, trashed.Document.ID, func(err error) bool { return errors.Is(err, ErrNotFound) }},
		{"unreadable", b, hidden.Document.ID, func(err error) bool { return errors.Is(err, ErrNotFound) }},
		{"other workspace", human(env.tn.owner), otherWS.Document.ID, func(err error) bool { return errors.Is(err, ErrNotFound) }},
		{"agent", Actor{Kind: audit.KindAgent, ID: env.tn.agent}, plain.Document.ID, func(err error) bool { return errors.Is(err, ErrForbidden) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := docCount(t, env, env.tn.wsA)
			_, err := env.svc.CreateDocumentFromTemplate(env.f.ctx, tc.actor, env.tn.wsA, CreateFromTemplateInput{
				TemplateID: tc.id, IdempotencyKey: util.NewID(),
			})
			if !tc.check(err) {
				t.Fatalf("err = %v", err)
			}
			if after := docCount(t, env, env.tn.wsA); after != before {
				t.Fatalf("documents %d -> %d after a refusal", before, after)
			}
		})
	}
}

func TestCreateDocumentFromTemplateChecksTheFolderInTheTransaction(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	tpl := templateFromWorld(t, env, "mau.pdf")
	owner := human(env.tn.aclOwner)
	b := human(env.tn.member)
	folder, err := env.svc.CreatePage(env.f.ctx, owner, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindPage, Title: "Thư mục X", Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatal(err)
	}
	sh := env.f.share(t, folder.Document, DocumentPrincipalUser, b.ID, DocumentLevelView, owner.ID)

	if err := env.svc.CheckCreateIn(env.f.ctx, b, env.tn.wsA, folder.Document.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("CheckCreateIn with view = %v, want ErrForbidden", err)
	}
	before := docCount(t, env, env.tn.wsA)
	_, err = env.svc.CreateDocumentFromTemplate(env.f.ctx, b, env.tn.wsA, CreateFromTemplateInput{
		TemplateID: tpl.Document.ID, ParentID: folder.Document.ID, IdempotencyKey: util.NewID(),
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("create with view = %v, want ErrForbidden", err)
	}
	if after := docCount(t, env, env.tn.wsA); after != before {
		t.Fatalf("documents %d -> %d after a refusal", before, after)
	}

	env.f.revoke(t, sh, owner.ID)
	env.f.share(t, folder.Document, DocumentPrincipalUser, b.ID, DocumentLevelEdit, owner.ID)
	if err := env.svc.CheckCreateIn(env.f.ctx, b, env.tn.wsA, folder.Document.ID); err != nil {
		t.Fatalf("CheckCreateIn with edit = %v", err)
	}
	res, err := env.svc.CreateDocumentFromTemplate(env.f.ctx, b, env.tn.wsA, CreateFromTemplateInput{
		TemplateID: tpl.Document.ID, ParentID: folder.Document.ID, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Document.ParentID.String != folder.Document.ID {
		t.Fatalf("parent = %q, want the folder", res.Document.ParentID.String)
	}
}

func TestCheckCreateIn(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	owner := human(env.tn.aclOwner)
	if err := env.svc.CheckCreateIn(env.f.ctx, human(env.tn.member), env.tn.wsA, ""); err != nil {
		t.Fatalf("workspace root for a member = %v", err)
	}
	if err := env.svc.CheckCreateIn(env.f.ctx, human(env.tn.outsider), env.tn.wsA, ""); err == nil {
		t.Fatal("an outsider passed the workspace check")
	}
	folder, err := env.svc.CreatePage(env.f.ctx, owner, env.tn.wsA, CreatePageInput{
		Kind: DocumentKindPage, Title: "Kín", Visibility: documentVisibilityRestricted,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := env.svc.CheckCreateIn(env.f.ctx, human(env.tn.member), env.tn.wsA, folder.Document.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unreadable folder = %v, want ErrNotFound", err)
	}
}
