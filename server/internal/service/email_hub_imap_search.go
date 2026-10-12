package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// indexSearchResults runs IMAP SEARCH (which matches bodies the cache may not
// hold) and caches the hits; the returned ids keep those rows in the result.
func (s *EmailHubService) indexSearchResults(
	ctx context.Context, acc db.EmailHubAccount, folder, query string,
) ([]string, error) {
	query = strings.TrimSpace(query)
	if !s.Enabled() || query == "" {
		return nil, nil
	}
	hits, run := s.gov.shouldIndexSearch(acc.ID, folder, query)
	if !run {
		return hits, nil // cached hits cost no IMAP, so they hold while a thread opens
	}
	if s.gov.interactiveActive(acc.ID) {
		s.gov.forgetSearch(acc.ID, folder, query)
		return nil, nil
	}

	var searchErr error
	if !s.gov.tryWithIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPInteractive(ctx, acc)
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
		hits, searchErr = s.upsertThreadItems(ctx, acc, cacheFolder, result.Items)
		return searchErr
	}) {
		s.gov.forgetSearch(acc.ID, folder, query)
		return nil, nil
	}
	s.gov.rememberSearchHits(acc.ID, folder, query, hits)
	return hits, searchErr
}

func searchFolderPlan(folder string) (searchFolder, cacheFolder string, opts imapclient.SearchOptions) {
	switch folder {
	case emailhub.FolderStarred:
		return emailhub.FolderInbox, emailhub.FolderInbox, imapclient.SearchOptions{StarredOnly: true}
	default:
		return folder, folder, imapclient.SearchOptions{}
	}
}
