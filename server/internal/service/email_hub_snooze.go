package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubFolderSnoozed is a virtual list folder (not an IMAP mailbox).
const emailHubFolderSnoozed = "SNOOZED"

func (s *EmailHubService) SetThreadSnooze(
	ctx context.Context, actor Actor, workspaceID, accountID, threadID string, until *time.Time,
) (EmailHubThreadView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	if row.Folder != emailhub.FolderInbox {
		return EmailHubThreadView{}, Invalid("snooze only applies to inbox threads")
	}
	var snooze pgtype.Timestamptz
	if until != nil {
		if until.Before(time.Now().UTC()) {
			return EmailHubThreadView{}, Invalid("snooze_until must be in the future")
		}
		snooze = pgtype.Timestamptz{Time: until.UTC(), Valid: true}
	}
	updated, err := s.q.UpdateEmailHubThreadSnooze(ctx, db.UpdateEmailHubThreadSnoozeParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID, SnoozedUntil: snooze,
	})
	if err != nil {
		return EmailHubThreadView{}, err
	}
	return threadView(updated), nil
}
