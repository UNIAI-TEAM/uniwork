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
	// The tree lock before any document row, as CreatePage takes it: two
	// root creates never share a position.
	if err := q.LockDocumentTree(ctx, in.WorkspaceID); err != nil {
		return db.Document{}, err
	}
	doc, err := s.insertPage(ctx, q, actor, newPage{
		OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID, Kind: DocumentKindPage, Title: title,
		Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(DocumentLevelView), Page: page,
	})
	if err != nil {
		return db.Document{}, err
	}
	// The creator holds the page as its ACL owner; the grants go through the
	// one share door with that access, exactly as a share from the dialog.
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return db.Document{}, err
	}
	for _, id := range in.Editors {
		if id == actor.ID {
			continue
		}
		share := DocumentShareInput{PrincipalType: DocumentPrincipalUser, PrincipalID: id, Level: DocumentLevelEdit}
		_, err := s.shareDocumentInTx(ctx, q, actor, doc, access, share)
		var ce CodedError
		if errors.As(err, &ce) && ce.Code == "principal_not_in_organization" {
			// An editor who has left the organization gets no grant; the
			// page is made for the others.
			continue
		}
		if err != nil {
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
// LockPageForEditInTx. A page whose content was not saved after its latest
// version answers that version and writes nothing: the caller wants "the
// version that holds this content", not a duplicate. Saved since - even back
// to the same content - is a new version.
func (s *DocumentService) CreateDocumentVersionInTx(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (db.DocumentVersion, error) {
	latest, err := q.GetLatestDocumentVersion(ctx, db.GetLatestDocumentVersionParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	switch {
	case err == nil:
		savedSince := doc.ContentSavedAt.Valid && doc.ContentSavedAt.Time.After(latest.CreatedAt.Time)
		if latest.Kind == DocumentKindPage && !savedSince {
			return latest, nil
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return db.DocumentVersion{}, err
	}
	return s.insertManualPageVersion(ctx, q, actor, doc, "", true)
}

// LevelFor is the actor's level on a document; a gate refusal is none.
func (s *DocumentService) LevelFor(ctx context.Context, actor Actor, doc db.Document) (DocumentLevel, error) {
	acc, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if isGateRefusal(err) {
		return DocumentLevelNone, nil
	}
	return acc.Level, err
}
