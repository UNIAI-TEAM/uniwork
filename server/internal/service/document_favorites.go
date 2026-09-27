package service

// Document favorites (G1-07, UNI-681): per-user server-side favorites. Add
// and remove run inside withDocumentMutation so the document row lock and a
// fresh effectiveLevel decide the write - a share revoked before the command
// is already seen; one that lands later waits. Both are idempotent: the
// (document_id, user_id) unique pair absorbs a repeat add, a missing row
// makes remove a no-op, and only a real change audits. The list re-runs the
// live permission check on every candidate - a revoked share drops out of
// the list while the row stays, and returns if access comes back.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FavoriteDocument adds the caller's favorite for a document they can read
// (view). A repeat returns the existing row without auditing.
func (s *DocumentService) FavoriteDocument(ctx context.Context, actor Actor, documentID string) (db.DocumentFavorite, error) {
	var out db.DocumentFavorite
	err := s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, _ DocumentAccess) error {
		row, err := q.AddDocumentFavorite(ctx, db.AddDocumentFavoriteParams{
			ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			DocumentID: doc.ID, UserID: actor.ID,
			CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Already favorited - return the row as it stands, audit nothing.
			out, err = q.GetDocumentFavorite(ctx, db.GetDocumentFavoriteParams{
				DocumentID: doc.ID, UserID: actor.ID,
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			})
			return err
		}
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Actor: actor, Action: audit.ActionDocumentFavorited,
			ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"favorite_id": row.ID},
		}, audit.Event{Topic: audit.ActionDocumentFavorited, Payload: map[string]string{
			"document_id": doc.ID, "user_id": actor.ID, "workspace_id": doc.WorkspaceID,
		}}); err != nil {
			return err
		}
		out = row
		return nil
	})
	return out, err
}

// UnfavoriteDocument removes the caller's favorite (view). A missing row is
// a no-op and audits nothing.
func (s *DocumentService) UnfavoriteDocument(ctx context.Context, actor Actor, documentID string) error {
	return s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, _ DocumentAccess) error {
		n, err := q.RemoveDocumentFavorite(ctx, db.RemoveDocumentFavoriteParams{
			DocumentID: doc.ID, UserID: actor.ID,
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		if err != nil || n == 0 {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Actor: actor, Action: audit.ActionDocumentUnfavorited,
			ResourceType: "document", ResourceID: doc.ID,
		}, audit.Event{Topic: audit.ActionDocumentUnfavorited, Payload: map[string]string{
			"document_id": doc.ID, "user_id": actor.ID, "workspace_id": doc.WorkspaceID,
		}})
	})
}

// ListDocumentFavorites is the caller's favorites in one organization, each
// re-filtered through the live effectiveLevel - a revoked share or an
// archived document below manage drops out instead of leaking a title.
func (s *DocumentService) ListDocumentFavorites(ctx context.Context, actor Actor, organizationID string) ([]db.ListDocumentFavoritesRow, error) {
	if !validActor(actor) {
		return nil, ErrNotFound
	}
	if _, err := s.orgs.RequireMember(ctx, organizationID, actor.ID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rows, err := s.q.ListDocumentFavorites(ctx, db.ListDocumentFavoritesParams{
		UserID: actor.ID, OrganizationID: organizationID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]db.ListDocumentFavoritesRow, 0, len(rows))
	for _, r := range rows {
		acc, err := s.effectiveLevel(ctx, s.q, actor, r.Document)
		if err != nil {
			return nil, err
		}
		if decideDocumentAccess(r.Document, acc, DocumentLevelView) == nil {
			out = append(out, r)
		}
	}
	return out, nil
}
