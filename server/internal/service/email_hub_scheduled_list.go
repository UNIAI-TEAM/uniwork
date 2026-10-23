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

// ListScheduledSends returns the caller's open scheduled sends: pending ones
// and failed ones (failed first) so a send the worker gave up on stays visible
// until the user retries or dismisses it. last_error is deliberately not
// surfaced — it is raw transport text, not user copy.
func (s *EmailHubService) ListScheduledSends(
	ctx context.Context, actor Actor, workspaceID, accountID string,
) ([]EmailHubScheduledSendListItem, error) {
	ws, err := s.scheduledSendScope(ctx, actor, workspaceID, accountID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListEmailHubOpenScheduledSends(ctx, db.ListEmailHubOpenScheduledSendsParams{
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

// CancelScheduledSend cancels a pending send, or dismisses a failed one.
func (s *EmailHubService) CancelScheduledSend(
	ctx context.Context, actor Actor, workspaceID, accountID, scheduledID string,
) error {
	ws, err := s.scheduledSendScope(ctx, actor, workspaceID, accountID)
	if err != nil {
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

// RetryScheduledSend puts a failed send back in the queue, due now, so the
// next worker batch picks it up. Only failed rows qualify; anything else is
// ErrNotFound.
func (s *EmailHubService) RetryScheduledSend(
	ctx context.Context, actor Actor, workspaceID, accountID, scheduledID string,
) error {
	ws, err := s.scheduledSendScope(ctx, actor, workspaceID, accountID)
	if err != nil {
		return err
	}
	n, err := s.q.RetryEmailHubScheduledSend(ctx, db.RetryEmailHubScheduledSendParams{
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

// scheduledSendScope checks configuration, workspace access and that the
// mailbox belongs to the caller, returning the workspace.
func (s *EmailHubService) scheduledSendScope(
	ctx context.Context, actor Actor, workspaceID, accountID string,
) (db.Workspace, error) {
	if !s.Enabled() {
		return db.Workspace{}, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return db.Workspace{}, err
	}
	if _, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Workspace{}, ErrNotFound
		}
		return db.Workspace{}, err
	}
	return ws, nil
}
