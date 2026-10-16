package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// My Folder (MYFOLDER-01, UNI-1850; addendum §1–§4): each workspace member
// gets at most one personal root folder (`system_kind = 'my_folder'`,
// `visibility = 'restricted'`, `title = 'My Folder'`), lazily created on
// first open or first create targeting `destination = "my_folder"`.
const (
	DocumentSystemKindMyFolder = "my_folder"
	myFolderStoredTitle        = "My Folder"
)

func isMyFolder(doc db.Document) bool {
	return doc.SystemKind.Valid && doc.SystemKind.String == DocumentSystemKindMyFolder
}

// EnsureMyFolder returns the caller's personal root folder in workspaceID,
// creating it when none exists yet (addendum §2). Only human workspace
// members may ensure one (ADR 0010: agents never create documents).
func (s *DocumentService) EnsureMyFolder(ctx context.Context, actor Actor, workspaceID string) (DocumentView, bool, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return DocumentView{}, false, ErrForbidden
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return DocumentView{}, false, ErrNotFound
		}
		return DocumentView{}, false, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, false, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, false, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentView{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return DocumentView{}, false, ErrNotFound
		}
		return DocumentView{}, false, err
	}
	doc, created, err := s.ensureMyFolderInTx(ctx, tx, q, actor, w.OrganizationID, workspaceID)
	if err != nil {
		return DocumentView{}, false, err
	}
	view, err := s.documentView(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentView{}, false, err
	}
	return view, created, nil
}

// ensureMyFolderInTx locks the workspace document tree and returns the
// caller's My Folder row, inserting and auditing it on the first call. A
// savepoint guards the insert so a unique-violation race against
// idx_documents_my_folder_uidx rolls back cleanly and re-reads the winner's
// row without aborting the outer transaction.
func (s *DocumentService) ensureMyFolderInTx(ctx context.Context, tx pgx.Tx, q *db.Queries, actor Actor, orgID, workspaceID string) (db.Document, bool, error) {
	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return db.Document{}, false, err
	}
	existing, err := q.GetMyFolder(ctx, db.GetMyFolderParams{
		OrganizationID: orgID, WorkspaceID: workspaceID, AclOwnerID: pgtype.Text{String: actor.ID, Valid: true},
	})
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, false, err
	}

	title, err := normalizeDocumentTitle(DocumentKindFolder, myFolderStoredTitle)
	if err != nil {
		return db.Document{}, false, err
	}
	position, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
		OrganizationID: orgID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return db.Document{}, false, err
	}

	sp, err := tx.Begin(ctx)
	if err != nil {
		return db.Document{}, false, err
	}
	spQ := s.q.WithTx(sp)
	doc, insErr := spQ.InsertDocument(ctx, db.InsertDocumentParams{
		ID:             util.NewID(),
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Kind:           DocumentKindFolder,
		SystemKind:     pgtype.Text{String: DocumentSystemKindMyFolder, Valid: true},
		Title:          title,
		Visibility:     documentVisibilityRestricted,
		WorkspaceLevel: string(DocumentLevelView),
		SearchText:     documentSearchText(title, ""),
		Revision:       1,
		Position:       position,
		AclOwnerID:     aclOwnerFor(actor),
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
	})
	if insErr != nil {
		_ = sp.Rollback(ctx)
		if isUniqueViolation(insErr) {
			reread, rErr := q.GetMyFolder(ctx, db.GetMyFolderParams{
				OrganizationID: orgID, WorkspaceID: workspaceID, AclOwnerID: pgtype.Text{String: actor.ID, Valid: true},
			})
			if rErr == nil {
				return reread, false, nil
			}
			return db.Document{}, false, rErr
		}
		return db.Document{}, false, insErr
	}
	if err := sp.Commit(ctx); err != nil {
		return db.Document{}, false, err
	}

	created := map[string]any{
		"title":       doc.Title,
		"kind":        doc.Kind,
		"visibility":  doc.Visibility,
		"system_kind": DocumentSystemKindMyFolder,
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentCreated,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(nil, created),
		Metadata:       map[string]any{"system_kind": DocumentSystemKindMyFolder},
	}, audit.Event{Topic: "document.created", Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
	}}); err != nil {
		return db.Document{}, false, err
	}
	return doc, true, nil
}
