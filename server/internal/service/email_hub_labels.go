package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *EmailHubService) ListImapLabels(ctx context.Context, actor Actor, workspaceID, accountID string) ([]string, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if _, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rows, err := s.q.ListEmailHubDistinctImapLabels(ctx, db.ListEmailHubDistinctImapLabelsParams{
		AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	return emailhub.UserVisibleImapLabels(rows), nil
}
