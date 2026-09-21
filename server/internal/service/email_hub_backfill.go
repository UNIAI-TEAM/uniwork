package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func listAllowsBackfill(in ListEmailHubThreadsInput) bool {
	return strings.TrimSpace(in.Query) == "" &&
		strings.TrimSpace(in.FromFilter) == "" &&
		!in.UnreadOnly &&
		!in.HasAttachmentsOnly
}

func backfillSupportedFolder(folder string) bool {
	return folder != emailhub.FolderStarred
}

func backfillMailboxFolder(folder string) string {
	if folder == emailhub.FolderStarred {
		return emailhub.FolderInbox
	}
	return folder
}

func (s *EmailHubService) backfillOlderThreads(
	ctx context.Context, acc db.EmailHubAccount, folder string, beforeUID uint32,
) (int, error) {
	if !s.Enabled() || beforeUID <= 1 || !backfillSupportedFolder(folder) {
		return 0, nil
	}

	var fetched int
	err := s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPInteractive(acc)
		if err != nil {
			return err
		}
		defer sess.Close()

		logical := backfillMailboxFolder(folder)
		mailbox := mailboxes.Resolve(logical)
		if mailbox == "" {
			mailbox = emailhub.MailboxName(acc.Provider, logical)
		}

		result, err := sess.BackfillFolder(mailbox, beforeUID)
		if err != nil {
			return err
		}
		if len(result.Items) == 0 {
			return nil
		}
		if err := s.upsertThreadItems(ctx, acc, logical, result.Items); err != nil {
			return err
		}
		fetched = len(result.Items)
		return nil
	})
	return fetched, err
}
