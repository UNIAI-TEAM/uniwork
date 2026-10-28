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
// (UNI-1625). Gmail searches All Mail only (not INBOX+All Mail): the same
// Message-ID has different UIDs per mailbox and used to create duplicate
// starred rows (UNI-2269).
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
			kept := make([]imapclient.ThreadMeta, 0, len(result.Items))
			for _, it := range result.Items {
				it.IsStarred = true
				if s.applyStarredToExistingByMessageID(ctx, acc, it.MessageID) {
					upserted++
					continue
				}
				kept = append(kept, it)
			}
			if len(kept) == 0 {
				continue
			}
			ids, upsertErr := s.upsertThreadItems(ctx, acc, logical, kept)
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

// applyStarredToExistingByMessageID stars every cached copy of Message-ID and
// collapses Gmail INBOX+All Mail duplicates to one preferred row (UNI-2269).
func (s *EmailHubService) applyStarredToExistingByMessageID(ctx context.Context, acc db.EmailHubAccount, messageID string) bool {
	mid := emailhub.NormalizeMessageID(messageID)
	if mid == "" {
		return false
	}
	n, err := s.q.MarkEmailHubThreadsStarredByMessageID(ctx, db.MarkEmailHubThreadsStarredByMessageIDParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, MessageID: mid, IsStarred: true,
	})
	if err != nil {
		s.log.Warn("email hub star by message-id failed", "account_id", acc.ID, "err", err)
		return false
	}
	if n == 0 {
		return false
	}
	if _, delErr := s.q.DeleteEmailHubDuplicateThreadsByMessageID(ctx, db.DeleteEmailHubDuplicateThreadsByMessageIDParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, MessageID: mid,
	}); delErr != nil {
		s.log.Warn("email hub starred dedupe failed", "account_id", acc.ID, "err", delErr)
	}
	return true
}

func starredSearchFolders(provider string) []string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "gmail":
		// All Mail already contains inbox + archived starred mail. Searching
		// INBOX as well created a second row per Message-ID (UNI-2269).
		return []string{emailhub.FolderArchive}
	default:
		return []string{emailhub.FolderInbox}
	}
}
