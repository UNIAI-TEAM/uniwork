package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	emailHubPullInterval      = 10 * time.Minute
	emailHubReconcileInterval = 30 * time.Minute
	emailHubWorkerBatch       = 20
	emailHubWatchTimeout      = 45 * time.Second
)

type emailHubFolderSync struct {
	UIDValidity uint32 `json:"uidvalidity"`
	LastUID     uint32 `json:"last_uid"`
	LastSyncAt  string `json:"last_sync_at,omitempty"`
}

type emailHubSyncState map[string]emailHubFolderSync

func parseEmailHubSyncState(raw []byte) emailHubSyncState {
	if len(raw) == 0 {
		return emailHubSyncState{}
	}
	var state emailHubSyncState
	if err := json.Unmarshal(raw, &state); err != nil {
		return emailHubSyncState{}
	}
	return state
}

func (s emailHubSyncState) folder(name string) emailHubFolderSync {
	if s == nil {
		return emailHubFolderSync{}
	}
	return s[name]
}

func (s emailHubSyncState) withFolder(name string, cur emailHubFolderSync) emailHubSyncState {
	if s == nil {
		s = emailHubSyncState{}
	}
	s[name] = cur
	return s
}

func lastSyncFromState(raw []byte) *time.Time {
	inbox := parseEmailHubSyncState(raw).folder(emailHubFolderInbox)
	if inbox.LastSyncAt == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, inbox.LastSyncAt)
	if err != nil {
		return nil
	}
	return &t
}

func (s *EmailHubService) syncAccount(ctx context.Context, acc db.EmailHubAccount, reconcile, force bool) (bool, error) {
	release, ok := s.gov.trySync(acc.ID, force, false, emailHubSyncModeFull)
	if !ok {
		s.log.Debug("email hub sync skipped", "account_id", acc.ID, "reason", "debounced")
		return false, nil
	}
	defer release()

	if !s.Enabled() {
		return false, ErrEmailHubNotConfigured
	}
	if force {
		if err := s.q.InvalidateEmailHubEmptyBodies(ctx, db.InvalidateEmailHubEmptyBodiesParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID,
		}); err != nil {
			s.log.Warn("email hub invalidate empty bodies failed", "account_id", acc.ID, "err", err)
		}
	}
	state := parseEmailHubSyncState(acc.SyncState)
	var lastErr error
	inboxOK := false
	if err := s.gov.withIMAP(acc.ID, func() error {
		creds, _, err := s.accountCredentials(acc)
		if err != nil {
			return err
		}
		sess, err := imapclient.OpenSession(creds)
		if err != nil {
			return err
		}
		defer sess.Close()

		defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
		mailboxes, listErr := sess.MailboxMap(defaults)
		if listErr != nil {
			s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
			mailboxes = defaults
		}
		s.gov.setMailboxes(acc.ID, mailboxes)

		for _, folder := range emailhub.SyncableFolders() {
			var folderErr error
			state, folderErr = s.syncAccountFolderSession(ctx, acc, folder, state, reconcile, sess, mailboxes)
			if folderErr != nil {
				s.log.Warn("email hub folder sync failed", "account_id", acc.ID, "folder", folder, "err", folderErr)
				lastErr = folderErr
				continue
			}
			if folder == emailHubFolderInbox {
				inboxOK = true
			}
		}
		return nil
	}); err != nil {
		return false, err
	}
	if !inboxOK {
		return false, lastErr
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return false, err
	}
	if err := s.q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: raw,
	}); err != nil {
		return false, err
	}
	s.scheduleBodyPrefetch(acc, emailHubFolderInbox)
	s.scheduleBodyPrefetch(acc, emailHubFolderSent)
	return true, nil
}

func (s *EmailHubService) reconcileAccount(ctx context.Context, acc db.EmailHubAccount) error {
	_, err := s.syncAccount(ctx, acc, true, false)
	return err
}

func (s *EmailHubService) syncAccountFolderSession(
	ctx context.Context, acc db.EmailHubAccount, logicalFolder string, state emailHubSyncState, reconcile bool,
	sess *imapclient.Session, mailboxes imapclient.MailboxMap,
) (emailHubSyncState, error) {
	mailbox := mailboxes.Resolve(logicalFolder)
	if mailbox == "" {
		mailbox = emailhub.MailboxName(acc.Provider, logicalFolder)
	}
	cursor := state.folder(logicalFolder)

	var result imapclient.SyncResult
	var err error
	if reconcile {
		result, err = sess.SyncFolder(mailbox, 0, 0, true)
	} else {
		result, err = sess.SyncFolder(mailbox, cursor.LastUID, cursor.UIDValidity, false)
	}
	if err != nil {
		return state, err
	}

	if cursor.UIDValidity != 0 && result.UIDValidity != 0 && cursor.UIDValidity != result.UIDValidity {
		if err := s.q.DeleteEmailHubThreadsInFolder(ctx, db.DeleteEmailHubThreadsInFolderParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: logicalFolder,
		}); err != nil {
			return state, err
		}
		cursor = emailHubFolderSync{}
	}

	if reconcile && len(result.Items) > 0 {
		keep := make([]int32, 0, len(result.Items))
		for _, it := range result.Items {
			keep = append(keep, int32(it.UID))
		}
		if err := s.q.DeleteEmailHubThreadsNotInUIDs(ctx, db.DeleteEmailHubThreadsNotInUIDsParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: logicalFolder, Column4: keep,
		}); err != nil {
			return state, err
		}
	}

	if err := s.upsertThreadItems(ctx, acc, logicalFolder, result.Items); err != nil {
		return state, err
	}

	nextUID := cursor.LastUID
	if result.HighestUID > nextUID {
		nextUID = result.HighestUID
	}
	state = state.withFolder(logicalFolder, emailHubFolderSync{
		UIDValidity: result.UIDValidity,
		LastUID:     nextUID,
		LastSyncAt:  time.Now().UTC().Format(time.RFC3339),
	})
	return state, nil
}

func (s *EmailHubService) syncSingleFolder(ctx context.Context, acc db.EmailHubAccount, logicalFolder string, reconcile, force, live bool) (bool, error) {
	mode := emailHubSyncModeFull
	if logicalFolder == emailHubFolderInbox {
		mode = emailHubSyncModeInbox
	}
	release, ok := s.gov.trySync(acc.ID, force, live, mode)
	if !ok {
		s.log.Debug("email hub sync skipped", "account_id", acc.ID, "folder", logicalFolder, "reason", "debounced")
		return false, nil
	}
	defer release()

	state := parseEmailHubSyncState(acc.SyncState)
	if err := s.gov.withIMAP(acc.ID, func() error {
		creds, _, err := s.accountCredentials(acc)
		if err != nil {
			return err
		}
		sess, err := imapclient.OpenSession(creds)
		if err != nil {
			return err
		}
		defer sess.Close()

		defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
		mailboxes, listErr := sess.MailboxMap(defaults)
		if listErr != nil {
			s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
			mailboxes = defaults
		}
		s.gov.setMailboxes(acc.ID, mailboxes)

		var syncErr error
		state, syncErr = s.syncAccountFolderSession(ctx, acc, logicalFolder, state, reconcile, sess, mailboxes)
		return syncErr
	}); err != nil {
		return false, err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return false, err
	}
	if err := s.q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: raw,
	}); err != nil {
		return false, err
	}
	if logicalFolder == emailHubFolderInbox {
		s.scheduleBodyPrefetch(acc, emailHubFolderInbox)
	}
	return true, nil
}

func (s *EmailHubService) upsertThreadItems(ctx context.Context, acc db.EmailHubAccount, logicalFolder string, items []imapclient.ThreadMeta) error {
	var lastErr error
	for _, it := range items {
		toAddrs := it.ToAddrs
		if toAddrs == nil {
			toAddrs = []string{}
		}
		row, err := s.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			Folder: logicalFolder, ImapUid: int32(it.UID), MessageID: pgtype.Text{String: it.MessageID, Valid: it.MessageID != ""},
			Subject: it.Subject, Snippet: it.Snippet, FromAddr: it.FromAddr,
			FromName: pgtype.Text{String: it.FromName, Valid: it.FromName != ""},
			ToAddrs:  toAddrs, SentAt: pgtype.Timestamptz{Time: it.SentAt, Valid: true},
			IsRead: it.IsRead, IsStarred: it.IsStarred, HasAttachments: it.HasAttachments,
		})
		if err != nil {
			s.log.Warn("email hub thread upsert failed",
				"account_id", acc.ID, "folder", logicalFolder, "uid", it.UID, "err", err)
			lastErr = err
			continue
		}
		if len(it.Attachments) > 0 {
			if err := s.replaceThreadAttachments(ctx, acc, row.ID, it.Attachments); err != nil {
				s.log.Warn("email hub attachments upsert failed",
					"account_id", acc.ID, "thread_id", row.ID, "err", err)
				lastErr = err
			}
		}
		if it.BodyText != "" || it.BodyHTML != "" {
			s.maybeCacheBodyFromSync(ctx, row, imapclient.ThreadBody{Text: it.BodyText, HTML: it.BodyHTML})
		}
	}
	return lastErr
}

// WatchInbox waits for an IMAP IDLE signal on INBOX and syncs when needed.
func (s *EmailHubService) WatchInbox(ctx context.Context, actor Actor, workspaceID, accountID string) (bool, error) {
	if !s.Enabled() {
		return false, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return false, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return false, err
	}

	s.gov.beginWatch(accountID)
	defer s.gov.endWatch(accountID)

	creds, _, err := s.accountCredentials(acc)
	if err != nil {
		return false, err
	}
	sess, err := imapclient.OpenSessionIdle(creds)
	if err != nil {
		return false, err
	}
	defer sess.Close()

	watchCtx, cancel := context.WithTimeout(ctx, emailHubWatchTimeout)
	defer cancel()
	mailboxes := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
	if discovered, err := sess.MailboxMap(mailboxes); err == nil {
		mailboxes = discovered
	}
	mailbox := mailboxes.Resolve(emailHubFolderInbox)
	changed, err := sess.WatchFolder(watchCtx, mailbox)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return false, nil
		}
		return false, err
	}
	if !changed {
		return false, nil
	}

	release, ok := s.gov.trySync(accountID, true, false, emailHubSyncModeInbox)
	if !ok {
		return false, nil
	}
	defer release()

	state, err := s.syncAccountFolderSession(ctx, acc, emailHubFolderInbox, parseEmailHubSyncState(acc.SyncState), false, sess, mailboxes)
	if err != nil {
		return false, err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return false, err
	}
	if err := s.q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: raw,
	}); err != nil {
		return false, err
	}
	s.scheduleBodyPrefetch(acc, emailHubFolderInbox)
	return true, nil
}

// RunWorkers polls connected mailboxes and reconciles on a slower cadence.
func (s *EmailHubService) RunWorkers(ctx context.Context) {
	if !s.Enabled() {
		return
	}
	s.log.Info("email hub sync workers started",
		"pull", emailHubPullInterval, "reconcile", emailHubReconcileInterval)
	pullTick := time.NewTicker(emailHubPullInterval)
	reconTick := time.NewTicker(emailHubReconcileInterval)
	defer pullTick.Stop()
	defer reconTick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-pullTick.C:
			s.runWorkerBatch(ctx, false)
		case <-reconTick.C:
			s.runWorkerBatch(ctx, true)
		}
	}
}

func (s *EmailHubService) runWorkerBatch(ctx context.Context, reconcile bool) {
	rows, err := s.q.ListEmailHubAccountsConnected(ctx, emailHubWorkerBatch)
	if err != nil {
		s.log.Warn("email hub worker list accounts", "err", err)
		return
	}
	for _, acc := range rows {
		if s.gov.isWatching(acc.ID) {
			s.log.Debug("email hub worker skipped", "account_id", acc.ID, "reason", "idle_active")
			continue
		}
		if s.gov.interactiveActive(acc.ID) {
			s.log.Debug("email hub worker skipped", "account_id", acc.ID, "reason", "interactive_active")
			continue
		}
		var syncErr error
		if reconcile {
			syncErr = s.reconcileAccount(ctx, acc)
		} else {
			_, syncErr = s.syncSingleFolder(ctx, acc, emailHubFolderInbox, false, false, false)
		}
		if syncErr != nil {
			s.log.Warn("email hub worker sync failed", "account_id", acc.ID, "reconcile", reconcile, "err", syncErr)
		}
	}
}
