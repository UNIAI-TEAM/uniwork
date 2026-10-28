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
	rows, err := s.q.ListEmailHubInboxConversationPage(ctx, db.ListEmailHubInboxConversationPageParams{
		AccountID: in.AccountID, OrganizationID: organizationID,
		UnreadOnly: in.UnreadOnly, HasAttachmentsOnly: in.HasAttachmentsOnly,
		FromFilter: in.FromFilter, Query: in.Query,
		BeforeSentAt: beforeSent, BeforeID: beforeID, LimitVal: limit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]db.EmailHubThread, len(rows))
	for i, r := range rows {
		out[i] = emailHubThreadFromListRow(r.ID, r.AccountID, r.OrganizationID, r.Folder, r.ImapUid, r.MessageID,
			r.Subject, r.Snippet, r.FromAddr, r.FromName, r.ToAddrs, r.SentAt, r.IsRead, r.IsStarred, r.HasAttachments,
			r.BodyCached, r.SyncedAt, r.ImapLabels, r.SnoozedUntil, r.ConversationKey, r.BodyObjectKey)
	}
	return out, nil
}

// emailHubThreadFromListRow builds a thread from a list-page query that omits bodies (UNI-2268).
func emailHubThreadFromListRow(
	id, accountID, organizationID, folder string, imapUID int32, messageID pgtype.Text,
	subject, snippet, fromAddr string, fromName pgtype.Text, toAddrs []string, sentAt pgtype.Timestamptz,
	isRead, isStarred, hasAttachments, bodyCached bool, syncedAt pgtype.Timestamptz, imapLabels []string,
	snoozedUntil pgtype.Timestamptz, conversationKey, bodyObjectKey string,
) db.EmailHubThread {
	return db.EmailHubThread{
		ID: id, AccountID: accountID, OrganizationID: organizationID, Folder: folder, ImapUid: imapUID,
		MessageID: messageID, Subject: subject, Snippet: snippet, FromAddr: fromAddr, FromName: fromName,
		ToAddrs: toAddrs, SentAt: sentAt, IsRead: isRead, IsStarred: isStarred, HasAttachments: hasAttachments,
		BodyCached: bodyCached, SyncedAt: syncedAt, ImapLabels: imapLabels, SnoozedUntil: snoozedUntil,
		ConversationKey: conversationKey, BodyObjectKey: bodyObjectKey,
	}
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

// inboxConversationRows is what an action on row touches: an INBOX message
// stands for every INBOX message of its conversation (the inbox lists one row
// per conversation), any other row only for itself (UNI-1124).
func (s *EmailHubService) inboxConversationRows(ctx context.Context, row db.EmailHubThread) ([]db.EmailHubThread, error) {
	if row.Folder != emailhub.FolderInbox || row.ConversationKey == "" {
		return []db.EmailHubThread{row}, nil
	}
	rows, err := s.q.ListEmailHubInboxConversationMembers(ctx, db.ListEmailHubInboxConversationMembersParams{
		AccountID: row.AccountID, OrganizationID: row.OrganizationID, ConversationKey: row.ConversationKey,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []db.EmailHubThread{row}, nil
	}
	return rows, nil
}
