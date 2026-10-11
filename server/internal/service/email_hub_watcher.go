package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubWatchLease is how long one subscribe keeps an account's watch alive:
// two missed client heartbeats (emailHubWatchTimeout apart) and the loop ends.
const emailHubWatchLease = 2 * emailHubWatchTimeout

// emailHubHubWatcher runs at most one IDLE loop per account on this node. A
// loop lives while clients renew its lease (lastSeen), not by counting
// subscribes, so heartbeats and a tab closed without DELETE cannot keep it up.
type emailHubHubWatcher struct {
	svc      *EmailHubService
	root     context.Context
	mu       sync.Mutex
	lastSeen map[string]time.Time
	stop     map[string]context.CancelFunc
}

func newEmailHubHubWatcher(svc *EmailHubService) *emailHubHubWatcher {
	return &emailHubHubWatcher{
		svc:      svc,
		lastSeen: make(map[string]time.Time),
		stop:     make(map[string]context.CancelFunc),
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
	for id := range w.stop {
		w.stopLocked(id)
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
	if acc.AuthFailedAt.Valid {
		return ErrEmailHubReauthRequired
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
	s.hubWatch.forceStop(accountID)
	return nil
}

func (w *emailHubHubWatcher) subscribe(acc db.EmailHubAccount) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.root == nil {
		return
	}
	w.lastSeen[acc.ID] = time.Now()
	if _, running := w.stop[acc.ID]; running {
		return
	}
	ctx, cancel := context.WithCancel(w.root)
	w.stop[acc.ID] = cancel
	go w.svc.runHubWatchLoop(ctx, acc.ID)
}

func (w *emailHubHubWatcher) forceStop(accountID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopLocked(accountID)
}

func (w *emailHubHubWatcher) stopLocked(accountID string) {
	delete(w.lastSeen, accountID)
	if cancel, ok := w.stop[accountID]; ok {
		cancel()
		delete(w.stop, accountID)
	}
}

// leased reports whether the loop running under ctx should go on. When its
// lease lapsed it stops the watch, so the next subscribe starts a fresh loop.
func (w *emailHubHubWatcher) leased(ctx context.Context, accountID string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if ctx.Err() != nil {
		return false // whoever cancelled ctx already cleared the entry
	}
	if seen, ok := w.lastSeen[accountID]; ok && time.Since(seen) <= emailHubWatchLease {
		return true
	}
	w.stopLocked(accountID)
	return false
}

// release clears the entry of a loop that ended on its own (account gone or
// disconnected); a cancelled ctx means a newer entry may already be there.
func (w *emailHubHubWatcher) release(ctx context.Context, accountID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if ctx.Err() == nil {
		w.stopLocked(accountID)
	}
}

// The watcher waits this long after a failed round, doubling up to the cap, so
// a dead password or a down provider costs one LOGIN per backoff, not per RTT.
const (
	emailHubWatchBackoffMin = 5 * time.Second
	emailHubWatchBackoffMax = 5 * time.Minute
)

func (s *EmailHubService) runHubWatchLoop(ctx context.Context, accountID string) {
	s.gov.beginWatch(accountID)
	defer s.gov.endWatch(accountID)
	defer s.hubWatch.release(ctx, accountID)

	backoff := emailHubWatchBackoffMin
	retry := func() bool {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, emailHubWatchBackoffMax)
		return true
	}
	for s.hubWatch.leased(ctx, accountID) {
		acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return
			}
			s.log.Warn("email hub watcher load account failed", "account_id", accountID, "err", err)
			if !retry() {
				return
			}
			continue
		}
		if acc.DisconnectedAt.Valid || acc.AuthFailedAt.Valid {
			return
		}
		changed, err := s.waitInboxIDLE(ctx, acc)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if isEmailHubWatchRoundEnd(err) {
				backoff = emailHubWatchBackoffMin
				s.gov.loginSucceeded(accountID)
				continue
			}
			if errors.Is(err, ErrEmailHubReauthRequired) {
				return
			}
			s.log.Warn("email hub watcher idle failed", "account_id", accountID, "code", emailHubErrCode(err))
			if !retry() {
				return
			}
			continue
		}
		backoff = emailHubWatchBackoffMin
		s.gov.loginSucceeded(accountID)
		if !changed {
			continue
		}
		beforeUnread := s.inboxUnreadForAccount(ctx, acc)
		synced, newUnread, syncErr := s.syncSingleFolder(ctx, acc, emailHubFolderInbox, false, true, false, true)
		if syncErr != nil {
			s.log.Warn("email hub watcher sync failed", "account_id", accountID, "code", emailHubErrCode(syncErr))
			if !retry() {
				return
			}
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

// emailHubRefusedLoginsBeforeDisconnect is how many bare-NO LOGINs in a row
// count as a revoked password; the watcher backoff spaces them out.
const emailHubRefusedLoginsBeforeDisconnect = 3

// handleAuthError marks acc needs-reconnect when err says the provider refused
// the credential read at version, so no node keeps retrying it. It reports
// whether it did; network errors, timeouts and busy servers stay transient.
func (s *EmailHubService) handleAuthError(ctx context.Context, acc db.EmailHubAccount, version int64, err error) bool {
	var reason string
	switch {
	case errors.Is(err, imapclient.ErrAuthFailed):
		reason = "imap_auth_failed"
	case errors.Is(err, imapclient.ErrLoginRefused):
		if s.gov.loginRefused(acc.ID) < emailHubRefusedLoginsBeforeDisconnect {
			return false
		}
		reason = "imap_login_refused"
	case errors.Is(err, smtpclient.ErrAuthFailed):
		reason = "smtp_auth_failed"
	default:
		return false
	}
	return s.markAuthFailed(ctx, acc, version, reason)
}

// markAuthFailed records that the credential at version was refused, keeping
// the cached mail for the reconnect onto the same id. Zero rows means a
// reconnect, a disconnect or another node got there first; the watcher running
// now belongs to that newer state, so nothing else happens.
func (s *EmailHubService) markAuthFailed(ctx context.Context, acc db.EmailHubAccount, version int64, reason string) bool {
	// The refusal is a fact even when the request that saw it is gone.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	old, err := qtx.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: version, Reason: reason,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: acc.OrganizationID,
		Actor:          audit.System("email-hub"),
		Action:         audit.ActionEmailHubAccountAuthFailed,
		ResourceType:   "email_hub_account",
		ResourceID:     acc.ID,
		Metadata:       map[string]any{"reason": reason},
	}, audit.Event{
		Topic:   "email_hub.inbox_changed",
		Version: 1,
		Payload: map[string]string{"account_id": acc.ID, "user_id": acc.UserID},
	}); err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	if err := tx.Commit(ctx); err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	s.log.Warn("email hub account needs reconnect", "account_id", acc.ID, "reason", reason)
	if reason != "oauth_invalid_grant" {
		// invalid_grant: the provider already ended the grant. Any other
		// refusal leaves a live grant behind that this row no longer holds.
		s.revokeEmailHubToken(ctx, acc.ID, old.AuthKind, old.OauthRefreshTokenEnc)
	}
	s.hubWatch.forceStop(acc.ID) // last: it may cancel ctx when the watcher calls us
	return true
}

// isEmailHubWatchRoundEnd reports the normal end of one IDLE round (timeout renews the watch).
func isEmailHubWatchRoundEnd(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}

func (s *EmailHubService) waitInboxIDLE(ctx context.Context, acc db.EmailHubAccount) (bool, error) {
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, err
	}
	sess, err := imapclient.OpenSessionIdle(creds.IMAP)
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
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
