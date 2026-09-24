package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	emailHubFolderInbox = emailhub.FolderInbox
	emailHubFolderSent  = emailhub.FolderSent
)

func normalizeEmailHubFolder(folder string) string {
	if folder == "" {
		return emailHubFolderInbox
	}
	return folder
}

func (s *EmailHubService) accountCredentials(acc db.EmailHubAccount) (imapclient.Credentials, string, error) {
	password, err := s.openPassword(acc.PasswordEnc)
	if err != nil {
		return imapclient.Credentials{}, "", err
	}
	return imapclient.Credentials{
		Host: acc.ImapHost, Port: int(acc.ImapPort), Email: acc.EmailAddress, Password: password,
	}, acc.Provider, nil
}

func (s *EmailHubService) mailboxFor(acc db.EmailHubAccount, logicalFolder string) string {
	if m, ok := s.gov.mailboxes(acc.ID); ok {
		return m.Resolve(logicalFolder)
	}
	return emailhub.MailboxName(acc.Provider, logicalFolder)
}

func (s *EmailHubService) openIMAPInteractive(acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	creds, _, err := s.accountCredentials(acc)
	if err != nil {
		return nil, nil, err
	}
	sess, err := imapclient.OpenSessionInteractive(creds)
	if err != nil {
		return nil, nil, err
	}
	defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
	if cached, ok := s.gov.mailboxes(acc.ID); ok {
		return sess, cached, nil
	}
	mailboxes, listErr := sess.MailboxMap(defaults)
	if listErr != nil {
		s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
		return sess, defaults, nil
	}
	s.gov.setMailboxes(acc.ID, mailboxes)
	return sess, mailboxes, nil
}

func (s *EmailHubService) openIMAPWithMailboxes(acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	creds, _, err := s.accountCredentials(acc)
	if err != nil {
		return nil, nil, err
	}
	sess, err := imapclient.OpenSession(creds)
	if err != nil {
		return nil, nil, err
	}
	defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
	if cached, ok := s.gov.mailboxes(acc.ID); ok {
		return sess, cached, nil
	}
	mailboxes, listErr := sess.MailboxMap(defaults)
	if listErr != nil {
		s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
		return sess, defaults, nil
	}
	s.gov.setMailboxes(acc.ID, mailboxes)
	return sess, mailboxes, nil
}

// MoveThread moves a cached message to archive or trash on IMAP and updates the cache.
func (s *EmailHubService) MoveThread(
	ctx context.Context, actor Actor, workspaceID, accountID, threadID, targetFolder string,
) error {
	if !emailhub.IsMoveableTarget(targetFolder) {
		return Invalid("unsupported move target")
	}
	if !s.Enabled() {
		return ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	creds, _, err := s.accountCredentials(acc)
	if err != nil {
		return err
	}
	fromMailbox := s.mailboxFor(acc, row.Folder)
	toMailbox := s.mailboxFor(acc, targetFolder)
	if err := imapclient.MoveMessage(creds, fromMailbox, uint32(row.ImapUid), toMailbox); err != nil {
		s.log.Warn("email hub move failed", "thread_id", threadID, "target", targetFolder, "err", err)
		return err
	}
	_ = s.q.DeleteEmailHubAttachmentsForThread(ctx, threadID)
	if err := s.q.DeleteEmailHubThread(ctx, db.DeleteEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		return err
	}
	_, _, err = s.syncSingleFolder(ctx, acc, targetFolder, false, true, false, true)
	return err
}
