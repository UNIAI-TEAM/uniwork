package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *EmailHubService) indexSearchResults(
	ctx context.Context, acc db.EmailHubAccount, folder, query string,
) error {
	query = strings.TrimSpace(query)
	if !s.Enabled() || query == "" {
		return nil
	}
	if s.gov.interactiveActive(acc.ID) || !s.gov.shouldIndexSearch(acc.ID, folder, query) {
		return nil
	}

	var searchErr error
	if !s.gov.tryWithIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPInteractive(acc)
		if err != nil {
			searchErr = err
			return err
		}
		defer sess.Close()

		searchFolder, cacheFolder, opts := searchFolderPlan(folder)
		mailbox := mailboxes.Resolve(searchFolder)
		if mailbox == "" {
			mailbox = emailhub.MailboxName(acc.Provider, searchFolder)
		}

		result, err := sess.SearchFolder(mailbox, query, opts)
		if err != nil {
			searchErr = err
			return err
		}
		if len(result.Items) == 0 {
			return nil
		}
		searchErr = s.upsertThreadItems(ctx, acc, cacheFolder, result.Items)
		return searchErr
	}) {
		return nil
	}
	return searchErr
}

func searchFolderPlan(folder string) (searchFolder, cacheFolder string, opts imapclient.SearchOptions) {
	switch folder {
	case emailhub.FolderStarred:
		return emailhub.FolderInbox, emailhub.FolderInbox, imapclient.SearchOptions{StarredOnly: true}
	default:
		return folder, folder, imapclient.SearchOptions{}
	}
}
