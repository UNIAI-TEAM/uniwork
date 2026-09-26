package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *EmailHubService) useInboxConversationList(in ListEmailHubThreadsInput, folder string) bool {
	if folder != emailhub.FolderInbox {
		return false
	}
	if in.LabelFilter != "" || in.Query != "" {
		return false
	}
	return true
}

func (s *EmailHubService) listInboxConversationRows(
	ctx context.Context,
	in ListEmailHubThreadsInput,
	organizationID string,
	beforeSent pgtype.Timestamptz,
	beforeID string,
	limit int32,
) ([]db.EmailHubThread, error) {
	return s.q.ListEmailHubInboxConversationPage(ctx, db.ListEmailHubInboxConversationPageParams{
		AccountID: in.AccountID, OrganizationID: organizationID,
		UnreadOnly: in.UnreadOnly, HasAttachmentsOnly: in.HasAttachmentsOnly,
		FromFilter: in.FromFilter, Query: in.Query,
		BeforeSentAt: beforeSent, BeforeID: beforeID, LimitVal: limit,
	})
}

func (s *EmailHubService) enrichInboxConversationList(ctx context.Context, rows []db.EmailHubThread) ([]EmailHubThreadView, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	keys := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.ConversationKey != "" {
			keys = append(keys, r.ConversationKey)
		}
	}
	stats := map[string]struct {
		count  int
		unread bool
	}{}
	if len(keys) > 0 {
		meta, err := s.q.ListEmailHubConversationMessageCounts(ctx, db.ListEmailHubConversationMessageCountsParams{
			AccountID: rows[0].AccountID, OrganizationID: rows[0].OrganizationID, ConversationKeys: keys,
		})
		if err != nil {
			return nil, err
		}
		for _, m := range meta {
			stats[m.ConversationKey] = struct {
				count  int
				unread bool
			}{count: max(1, int(m.MessageCount)), unread: m.InboxUnread}
		}
	}
	out := make([]EmailHubThreadView, 0, len(rows))
	for _, r := range rows {
		v := threadView(r)
		if r.ConversationKey == "" {
			v.ConversationMessageCount = 1
		} else if st, ok := stats[r.ConversationKey]; ok {
			v.ConversationMessageCount = st.count
			if st.unread {
				v.IsRead = false
			}
		} else {
			v.ConversationMessageCount = 1
		}
		out = append(out, v)
	}
	return out, nil
}
