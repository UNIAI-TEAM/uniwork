package service

import (
	"context"
	"errors"
	"sync"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type emailHubHubWatcher struct {
	svc  *EmailHubService
	root context.Context
	mu   sync.Mutex
	refs map[string]int
	stop map[string]context.CancelFunc
}

func newEmailHubHubWatcher(svc *EmailHubService) *emailHubHubWatcher {
	return &emailHubHubWatcher{
		svc:  svc,
		refs: make(map[string]int),
		stop: make(map[string]context.CancelFunc),
	}
}

func (s *EmailHubService) RunHubWatchers(ctx context.Context) {
	s.hubWatch.setRoot(ctx)
	<-ctx.Done()
	s.hubWatch.stopAll()
}

func (w *emailHubHubWatcher) setRoot(ctx context.Context) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.root = ctx
}

func (w *emailHubHubWatcher) stopAll() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for id, cancel := range w.stop {
		cancel()
		delete(w.stop, id)
		delete(w.refs, id)
	}
}

func (s *EmailHubService) SubscribeInboxWatch(
	ctx context.Context, actor Actor, workspaceID, accountID string,
) error {
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
	s.hubWatch.subscribe(acc)
	return nil
}

func (s *EmailHubService) UnsubscribeInboxWatch(
	ctx context.Context, actor Actor, workspaceID, accountID string,
) error {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if _, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	s.hubWatch.unsubscribe(accountID)
	return nil
}

func (w *emailHubHubWatcher) subscribe(acc db.EmailHubAccount) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.root == nil {
		return
	}
	w.refs[acc.ID]++
	if w.refs[acc.ID] > 1 {
		return
	}
	ctx, cancel := context.WithCancel(w.root)
	w.stop[acc.ID] = cancel
	go w.svc.runHubWatchLoop(ctx, acc.ID)
}

func (w *emailHubHubWatcher) unsubscribe(accountID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := w.refs[accountID]
	if n <= 0 {
		return
	}
	n--
	if n == 0 {
		delete(w.refs, accountID)
		if cancel, ok := w.stop[accountID]; ok {
			cancel()
			delete(w.stop, accountID)
		}
		return
	}
	w.refs[accountID] = n
}

func (w *emailHubHubWatcher) forceStop(accountID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.refs, accountID)
	if cancel, ok := w.stop[accountID]; ok {
		cancel()
		delete(w.stop, accountID)
	}
}

func (s *EmailHubService) runHubWatchLoop(ctx context.Context, accountID string) {
	s.gov.beginWatch(accountID)
	defer s.gov.endWatch(accountID)

	for ctx.Err() == nil {
		acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return
			}
			s.log.Warn("email hub watcher load account failed", "account_id", accountID, "err", err)
			continue
		}
		if acc.DisconnectedAt.Valid {
			return
		}
		changed, err := s.waitInboxIDLE(ctx, acc)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.log.Warn("email hub watcher idle failed", "account_id", accountID, "err", err)
			continue
		}
		if !changed {
			continue
		}
		beforeUnread := s.inboxUnreadForAccount(ctx, acc)
		synced, newUnread, syncErr := s.syncSingleFolder(ctx, acc, emailHubFolderInbox, false, true, false, true)
		if syncErr != nil {
			s.log.Warn("email hub watcher sync failed", "account_id", accountID, "err", syncErr)
			continue
		}
		if synced {
			s.emitInboxChanged(ctx, acc)
			if newUnread > 0 || s.inboxUnreadForAccount(ctx, acc) > beforeUnread {
				s.emitEmailHubNewMail(ctx, acc, "")
			}
		}
	}
}

func (s *EmailHubService) waitInboxIDLE(ctx context.Context, acc db.EmailHubAccount) (bool, error) {
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
	return sess.WatchFolder(watchCtx, mailbox)
}

func (s *EmailHubService) emitInboxChanged(ctx context.Context, acc db.EmailHubAccount) {
	emitCtx := audit.WithRequest(ctx, audit.RequestInfo{CorrelationID: util.NewID()})
	if err := auditRecorder.Emit(emitCtx, s.q, audit.System("email-hub-watcher"), audit.Event{
		Topic:          "email_hub.inbox_changed",
		Version:        1,
		OrganizationID: acc.OrganizationID,
		Payload: map[string]string{
			"account_id": acc.ID,
			"user_id":    acc.UserID,
		},
	}); err != nil {
		s.log.Warn("email hub inbox_changed emit failed", "account_id", acc.ID, "err", err)
	}
}

func (s *EmailHubService) emitEmailHubNewMail(ctx context.Context, acc db.EmailHubAccount, workspaceID string) {
	emitCtx := audit.WithRequest(ctx, audit.RequestInfo{CorrelationID: util.NewID()})
	payload := map[string]string{
		"account_id": acc.ID,
		"user_id":    acc.UserID,
	}
	if workspaceID != "" {
		payload["workspace_id"] = workspaceID
	}
	if err := auditRecorder.Emit(emitCtx, s.q, audit.System("email-hub"), audit.Event{
		Topic:          "email_hub.new_mail",
		Version:        1,
		OrganizationID: acc.OrganizationID,
		Payload:        payload,
	}); err != nil {
		s.log.Warn("email hub new_mail emit failed", "account_id", acc.ID, "err", err)
	}
}
