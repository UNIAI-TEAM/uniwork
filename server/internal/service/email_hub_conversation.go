package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const emailHubConversationMessageLimit = 50

// ListConversationMessages returns every cached message in the same conversation
// as threadID (across folders), oldest first — like Gmail's stacked thread view.
func (s *EmailHubService) ListConversationMessages(
	ctx context.Context,
	actor Actor,
	workspaceID, accountID, threadID string,
) ([]EmailHubThreadView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	anchor, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	key := anchor.ConversationKey
	if key == "" {
		return []EmailHubThreadView{threadView(anchor)}, nil
	}
	rows, err := s.q.ListEmailHubConversationMessages(ctx, db.ListEmailHubConversationMessagesParams{
		AccountID: accountID, OrganizationID: ws.OrganizationID, ConversationKey: key,
		Limit: emailHubConversationMessageLimit,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []EmailHubThreadView{threadView(anchor)}, nil
	}
	out := make([]EmailHubThreadView, 0, len(rows))
	for _, r := range rows {
		out = append(out, threadView(r))
	}
	return out, nil
}
