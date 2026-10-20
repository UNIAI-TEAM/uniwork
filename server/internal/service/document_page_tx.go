package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Page commands another service runs inside its own transaction, so its row
// and the page commit together (a meeting's minutes, spec meeting
// follow-through §6.6). They follow CreateOwnedDocumentInTx: the caller owns
// the transaction and has gated its own command; the document rules - human
// actor, membership, level - are still decided here.

// SharedPageInput is a workspace page created on someone's behalf.
type SharedPageInput struct {
	OrganizationID, WorkspaceID, Title string
	Content                            json.RawMessage
	// Editors receive edit. The actor holds manage as the page's ACL owner,
	// like every page; the whole workspace views it.
	Editors []string
}

// CreateSharedPageInTx creates a page at the root of the workspace, visible
// to the workspace at view, and shares edit with each editor. Agents never
// write documents (ADR 0010).
func (s *DocumentService) CreateSharedPageInTx(ctx context.Context, q *db.Queries, actor Actor, in SharedPageInput) (db.Document, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return db.Document{}, ErrForbidden
	}
	title, err := normalizeDocumentTitle(DocumentKindPage, in.Title)
	if err != nil {
		return db.Document{}, err
	}
	page, err := sanitizePage(in.Content)
	if err != nil {
		return db.Document{}, err
	}
	if _, err := s.ws.RequireMemberQ(ctx, q, in.WorkspaceID, actor.ID); err != nil {
		return db.Document{}, err
	}
	doc, err := s.insertPage(ctx, q, actor, newPage{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, Kind: DocumentKindPage, Title: title,
		Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(DocumentLevelView), Page: page,
	})
	if err != nil {
		return db.Document{}, err
	}
	for _, id := range in.Editors {
		if id == actor.ID {
			continue
		}
		share := DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: DocumentLevelEdit}
		if err := s.validateSharePrincipal(ctx, q, doc, share); err != nil {
			// An editor who has left the organization gets no grant; the
			// page is made for the others.
			var ce CodedError
			if errors.As(err, &ce) && ce.Code == "principal_not_in_organization" {
				continue
			}
			return db.Document{}, err
		}
		notify, err := s.notifyOnUserShare(ctx, q, actor, doc, nil, id, DocumentLevelEdit)
		if err != nil {
			return db.Document{}, err
		}
		if _, err := s.applyDocumentShareWithBatch(ctx, q, actor, doc, DocumentAccess{Level: DocumentLevelManage}, share, "", notify); err != nil {
			return db.Document{}, err
		}
	}
	return doc, nil
}

// LockPageForEditInTx locks a live page the actor may edit, in the caller's
// transaction: missing -> ErrNotFound, below edit -> ErrForbidden (an admin
// scope without a level is no way in), trashed -> document_deleted, shelved
// -> document_shelved.
func (s *DocumentService) LockPageForEditInTx(ctx context.Context, q *db.Queries, actor Actor, documentID string) (db.Document, error) {
	if !validActor(actor) || documentID == "" {
		return db.Document{}, ErrNotFound
	}
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return db.Document{}, err
	}
	if !access.Level.AtLeast(DocumentLevelEdit) {
		return db.Document{}, ErrForbidden
	}
	if doc.ArchivedAt.Valid {
		return db.Document{}, errDocumentDeleted()
	}
	if err := requireNotShelved(doc); err != nil {
		return db.Document{}, err
	}
	if doc.Kind != DocumentKindPage {
		return db.Document{}, Invalid("chỉ trang mới có phiên bản nội dung")
	}
	return doc, nil
}

// CreateDocumentVersionInTx takes a manual version of a page locked by
// LockPageForEditInTx. A working copy unchanged since the latest version
// answers that version and writes nothing: the caller wants "the version
// that holds this content", not a duplicate.
func (s *DocumentService) CreateDocumentVersionInTx(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (db.DocumentVersion, error) {
	v, err := s.insertManualPageVersion(ctx, q, actor, doc, "")
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "document_version_unchanged" {
		return q.GetLatestDocumentVersion(ctx, db.GetLatestDocumentVersionParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
	}
	return v, err
}

// LevelFor is the actor's level on a document; a gate refusal is none.
func (s *DocumentService) LevelFor(ctx context.Context, actor Actor, doc db.Document) (DocumentLevel, error) {
	acc, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if isGateRefusal(err) {
		return DocumentLevelNone, nil
	}
	return acc.Level, err
}
