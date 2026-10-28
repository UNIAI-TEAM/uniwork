package service

// Create a document from a template (UNI-2261): the asker's own new file whose
// first version points at the template's current file id. No bytes are copied
// or metered (FileService counts a file id once, as CopyDocument), and nothing
// of the template's access is inherited: the asker is the ACL owner and the
// home row follows the destination like any other create.

import (
	"context"
	"net/http"
	"path"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TemplateSourceInfo is what a caller may show about a template it can use.
// Format is the list-filter spelling (docx, xlsx, pptx, pdf, md, html, txt);
// it falls back to the title's extension for a type the list cannot name.
type TemplateSourceInfo struct {
	ID, Title, Format string
	Revision          int64
}

// templateFileSource is the template row and the version a create reads.
type templateFileSource struct {
	doc     db.Document
	version db.DocumentVersion
}

// CreateFromTemplateInput is one create-from-template command. An empty Title
// takes the template's.
type CreateFromTemplateInput struct {
	TemplateID, ParentID, Destination, Title, Visibility, IdempotencyKey string
}

func errTemplateUnavailable() error {
	return coded(http.StatusConflict, "template_unavailable", "Tài liệu này không còn là mẫu.")
}

// readTemplate reads the template through q: readable by the actor, same
// workspace, a live file that no work product owns, still marked. Whoever
// cannot read it, or finds it elsewhere or in the trash, gets ErrNotFound;
// a readable file that lost its mark is errTemplateUnavailable.
func (s *DocumentService) readTemplate(ctx context.Context, q *db.Queries, actor Actor, workspaceID, templateID string) (templateFileSource, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return templateFileSource{}, ErrForbidden
	}
	doc, _, err := s.authorizeDocumentQ(ctx, q, actor, templateID, DocumentLevelView)
	if err != nil {
		return templateFileSource{}, err
	}
	if doc.WorkspaceID != workspaceID || doc.OwnerKind.Valid || doc.ArchivedAt.Valid || doc.Kind != DocumentKindFile {
		return templateFileSource{}, ErrNotFound
	}
	if !doc.TemplateMarkedAt.Valid {
		return templateFileSource{}, errTemplateUnavailable()
	}
	v, err := s.currentFileVersion(ctx, q, doc)
	if err != nil {
		return templateFileSource{}, err
	}
	if v == nil || !v.FileID.Valid {
		return templateFileSource{}, ErrNotFound
	}
	return templateFileSource{doc: doc, version: *v}, nil
}

// TemplateSource is the read-only check a proposal runs before it names a
// template; it takes no lock.
func (s *DocumentService) TemplateSource(ctx context.Context, actor Actor, workspaceID, templateID string) (TemplateSourceInfo, error) {
	src, err := s.readTemplate(ctx, s.q, actor, workspaceID, templateID)
	if err != nil {
		return TemplateSourceInfo{}, err
	}
	return TemplateSourceInfo{
		ID: src.doc.ID, Title: src.doc.Title, Format: templateFormat(src), Revision: src.doc.Revision,
	}, nil
}

func templateFormat(src templateFileSource) string {
	for _, f := range files.DocumentFormats() {
		if mime, _ := files.DocumentFormatMime(f); mime == src.version.MimeType.String {
			return f
		}
	}
	return strings.TrimPrefix(strings.ToLower(path.Ext(src.doc.Title)), ".")
}

// recheckTemplateInTx runs inside the create transaction: the mark, the
// reader's access and the current version are read again through q, so a
// template unmarked, trashed or replaced since the pre-flight is not used.
func (s *DocumentService) recheckTemplateInTx(ctx context.Context, q *db.Queries, actor Actor, workspaceID string, src *templateFileSource) error {
	cur, err := s.readTemplate(ctx, q, actor, workspaceID, src.doc.ID)
	if err != nil {
		return err
	}
	if cur.version.ID != src.version.ID {
		// A new version landed: the file, version and revision recorded as
		// provenance must describe one snapshot, so the caller retries.
		return errDocumentVersionConflict(cur.doc.Revision)
	}
	return nil
}

// CreateDocumentFromTemplate makes the actor's own file from a template. The
// folder check and the file claim run in CreateFileDocument's transaction.
func (s *DocumentService) CreateDocumentFromTemplate(ctx context.Context, actor Actor, workspaceID string, in CreateFromTemplateInput) (DocumentFileResult, error) {
	src, err := s.readTemplate(ctx, s.q, actor, workspaceID, in.TemplateID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	title := in.Title
	if strings.TrimSpace(title) == "" {
		title = src.doc.Title
	}
	return s.CreateFileDocument(ctx, actor, workspaceID, CreateFileDocumentInput{
		ParentID: in.ParentID, Destination: in.Destination, Title: title,
		Visibility: in.Visibility, IdempotencyKey: in.IdempotencyKey, fromTemplate: &src,
	})
}

// CheckCreateIn is the read-only pre-flight for creating a document in a
// folder: the workspace root needs only a seat, a folder also needs a parent
// the actor may add to. It takes no lock; the create re-checks under one.
func (s *DocumentService) CheckCreateIn(ctx context.Context, actor Actor, workspaceID, parentID string) error {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return ErrForbidden
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		return err
	}
	if parentID == "" {
		return nil
	}
	return s.authorizeParentIn(ctx, actor, parentID, workspaceID)
}
