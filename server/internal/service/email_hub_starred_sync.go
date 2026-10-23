package service

import (
	"context"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// syncStarred pulls flagged / Gmail-starred messages into the cache so the
// virtual STARRED folder is not limited to the ~50 most recent INBOX rows
// (UNI-1625). Searches INBOX always; on Gmail also searches All Mail so
// starred archive mail is included.
func (s *EmailHubService) syncStarred(ctx context.Context, acc db.EmailHubAccount, force bool) (bool, int, error) {
	release, ok := s.gov.trySync(acc.ID, force, false, emailHubSyncModeFull)
	if !ok {
		s.log.Debug("email hub starred sync skipped", "account_id", acc.ID, "reason", "debounced")
		return false, 0, nil
	}
	defer release()

	if !s.Enabled() {
		return false, 0, ErrEmailHubNotConfigured
	}
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, 0, err
	}

	var upserted int
	run := func() error {
		sess, err := imapclient.OpenSession(creds.IMAP)
		if err != nil {
			return err
		}
		defer sess.Close()

		defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
		mailboxes, listErr := sess.MailboxMap(defaults)
		if listErr != nil {
			s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "code", emailHubErrCode(listErr))
			mailboxes = defaults
		}
		s.gov.setMailboxes(acc.ID, mailboxes)

		folders := starredSearchFolders(acc.Provider)
		for _, logical := range folders {
			mailbox := mailboxes.Resolve(logical)
			if mailbox == "" {
				mailbox = emailhub.MailboxName(acc.Provider, logical)
			}
			if mailbox == "" {
				continue
			}
			result, searchErr := sess.SearchFolder(mailbox, "", imapclient.SearchOptions{StarredOnly: true})
			if searchErr != nil {
				s.log.Warn("email hub starred search failed",
					"account_id", acc.ID, "folder", logical, "code", emailHubErrCode(searchErr))
				continue
			}
			if len(result.Items) == 0 {
				continue
			}
			for i := range result.Items {
				result.Items[i].IsStarred = true
			}
			ids, upsertErr := s.upsertThreadItems(ctx, acc, logical, result.Items)
			if upsertErr != nil {
				return upsertErr
			}
			upserted += len(ids)
		}
		return nil
	}
	if err := s.gov.withIMAP(acc.ID, run); err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			return false, 0, ErrEmailHubReauthRequired
		}
		return false, 0, err
	}
	s.gov.loginSucceeded(acc.ID)
	return upserted > 0 || force, 0, nil
}

func starredSearchFolders(provider string) []string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "gmail":
		// All Mail holds starred messages that left the inbox.
		return []string{emailhub.FolderInbox, emailhub.FolderArchive}
	default:
		return []string{emailhub.FolderInbox}
	}
}
