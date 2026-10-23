package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
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

// emailHubCreds is one snapshot of a mailbox credential. Version is the
// credential_version it was read at; every auth-failure write compares it.
type emailHubCreds struct {
	IMAP    imapclient.Credentials
	SMTP    smtpclient.Credentials
	Version int64
}

// credentials is the one place a mailbox credential is opened. An account
// that needs reconnect answers ErrEmailHubReauthRequired before any dial; an
// oauth_* account carries a fresh access token and no password.
func (s *EmailHubService) credentials(ctx context.Context, acc db.EmailHubAccount) (emailHubCreds, error) {
	if acc.AuthFailedAt.Valid {
		return emailHubCreds{}, ErrEmailHubReauthRequired
	}
	var password, accessToken string
	var err error
	if strings.HasPrefix(acc.AuthKind, "oauth_") {
		accessToken, err = s.oauthAccessToken(ctx, acc)
	} else {
		password, err = s.openPassword(acc.PasswordEnc)
	}
	if err != nil {
		return emailHubCreds{}, err
	}
	return emailHubCreds{
		IMAP: imapclient.Credentials{
			Host: acc.ImapHost, Port: int(acc.ImapPort), Email: acc.EmailAddress, Username: acc.Username,
			Password: password, AccessToken: accessToken, Security: acc.ImapSecurity,
		},
		SMTP: smtpclient.Credentials{
			Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress, Username: acc.Username,
			Password: password, AccessToken: accessToken, Security: acc.SmtpSecurity,
		},
		Version: acc.CredentialVersion,
	}, nil
}

func (s *EmailHubService) mailboxFor(acc db.EmailHubAccount, logicalFolder string) string {
	if m, ok := s.gov.mailboxes(acc.ID); ok {
		return m.Resolve(logicalFolder)
	}
	return emailhub.MailboxName(acc.Provider, logicalFolder)
}

func (s *EmailHubService) openIMAPInteractive(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	return s.openIMAPMailboxes(ctx, acc, imapclient.OpenSessionInteractive)
}

func (s *EmailHubService) openIMAPWithMailboxes(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	return s.openIMAPMailboxes(ctx, acc, imapclient.OpenSession)
}

func (s *EmailHubService) openIMAPMailboxes(
	ctx context.Context, acc db.EmailHubAccount, open func(imapclient.Credentials) (*imapclient.Session, error),
) (*imapclient.Session, imapclient.MailboxMap, error) {
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return nil, nil, err
	}
	sess, err := open(creds.IMAP)
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return nil, nil, err
	}
	s.gov.loginSucceeded(acc.ID) // only refusals in a row count toward needs_reconnect
	defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
	if cached, ok := s.gov.mailboxes(acc.ID); ok {
		return sess, cached, nil
	}
	mailboxes, listErr := sess.MailboxMap(defaults)
	if listErr != nil {
		s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "code", emailHubErrCode(listErr))
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
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return err
	}
	rows, err := s.inboxConversationRows(ctx, row)
	if err != nil {
		return err
	}
	toMailbox := s.mailboxFor(acc, targetFolder)
	// shortcut: one IMAP connection per message; fine for conversation-sized sets.
	moved := make([]db.EmailHubThread, 0, len(rows))
	for _, r := range rows {
		if err := imapclient.MoveMessage(creds.IMAP, s.mailboxFor(acc, r.Folder), uint32(r.ImapUid), toMailbox); err != nil {
			if s.handleAuthError(ctx, acc, creds.Version, err) {
				return ErrEmailHubReauthRequired
			}
			s.log.Warn("email hub move failed", "thread_id", r.ID, "target", targetFolder, "code", emailHubErrCode(err))
			return redactEmailHubMailErr(err)
		}
		moved = append(moved, r)
	}
	// Pull the destination first so the UI can show the mail there. Only then
	// drop the source rows — if sync fails the local copies stay until retry
	// (UNI-1635 / UNI-1638).
	_, _, syncErr := s.syncSingleFolder(ctx, acc, targetFolder, false, true, false, true)
	if syncErr != nil {
		return redactEmailHubMailErr(syncErr)
	}
	for _, r := range moved {
		_ = s.q.DeleteEmailHubAttachmentsForThread(ctx, r.ID)
		if err := s.q.DeleteEmailHubThread(ctx, db.DeleteEmailHubThreadParams{
			ID: r.ID, AccountID: accountID, OrganizationID: ws.OrganizationID,
		}); err != nil {
			return err
		}
	}
	return nil
}
