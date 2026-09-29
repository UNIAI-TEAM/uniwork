package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type EmailHubSidebarCounts struct {
	InboxUnread  int64
	SnoozedTotal int64
}

func (s *EmailHubService) SidebarCounts(
	ctx context.Context,
	actor Actor,
	workspaceID, accountID string,
) (EmailHubSidebarCounts, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubSidebarCounts{}, err
	}
	if _, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubSidebarCounts{}, ErrNotFound
		}
		return EmailHubSidebarCounts{}, err
	}
	row, err := s.q.EmailHubAccountSidebarCounts(ctx, db.EmailHubAccountSidebarCountsParams{
		AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubSidebarCounts{}, err
	}
	return EmailHubSidebarCounts{InboxUnread: row.InboxUnread, SnoozedTotal: row.SnoozedTotal}, nil
}
