package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type EmailHubScheduledSendListItem struct {
	ID      string
	SendAt  string
	Subject string
	To      []string
	Status  string
}

func (s *EmailHubService) ListPendingScheduledSends(
	ctx context.Context, actor Actor, workspaceID, accountID string,
) ([]EmailHubScheduledSendListItem, error) {
	if !s.Enabled() {
		return nil, ErrEmailHubNotConfigured
	}
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
	rows, err := s.q.ListEmailHubPendingScheduledSends(ctx, db.ListEmailHubPendingScheduledSendsParams{
		WorkspaceID: ws.ID, AccountID: accountID, UserID: actor.ID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]EmailHubScheduledSendListItem, 0, len(rows))
	for _, row := range rows {
		var payload scheduledSendPayload
		_ = json.Unmarshal(row.Payload, &payload)
		item := EmailHubScheduledSendListItem{
			ID: row.ID, Status: row.Status, Subject: payload.Subject, To: payload.To,
		}
		if row.SendAt.Valid {
			item.SendAt = row.SendAt.Time.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		out = append(out, item)
	}
	return out, nil
}

func (s *EmailHubService) CancelScheduledSend(
	ctx context.Context, actor Actor, workspaceID, accountID, scheduledID string,
) error {
	if !s.Enabled() {
		return ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if _, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	n, err := s.q.CancelEmailHubScheduledSend(ctx, db.CancelEmailHubScheduledSendParams{
		ID: scheduledID, WorkspaceID: ws.ID, AccountID: accountID, UserID: actor.ID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
