package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingHandler counts log records whose message contains match.
type countingHandler struct {
	match string
	n     *atomic.Int32
}

func (h countingHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h countingHandler) WithAttrs([]slog.Attr) slog.Handler       { return h }
func (h countingHandler) WithGroup(string) slog.Handler            { return h }
func (h countingHandler) Handle(_ context.Context, r slog.Record) error {
	if strings.Contains(r.Message, h.match) {
		h.n.Add(1)
	}
	return nil
}

func emailHubCount(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const emailHubInboxChangedFor = `SELECT count(*) FROM outbox_events
	WHERE topic = 'email_hub.inbox_changed' AND payload::jsonb->>'account_id' = $1`

func TestEmailHubWatchLoopBacksOffAfterIMAPFailures(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	// The seeded account points at 127.0.0.1:1, so every IDLE attempt fails at once.
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	var failures atomic.Int32
	svc.log = slog.New(countingHandler{match: "watcher idle failed", n: &failures})
	svc.hubWatch.lastSeen[acc.ID] = time.Now() // a live client lease, so only backoff paces the loop

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	svc.runHubWatchLoop(ctx, acc.ID)

	if n := failures.Load(); n > 2 {
		t.Fatalf("expected at most 2 IMAP attempts in 1s, got %d", n)
	}
	if svc.gov.isWatching(acc.ID) {
		t.Fatal("the loop must release its watch on exit")
	}
}

func TestEmailHubCredentialsOpenTheStoredPassword(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	creds, err := svc.credentials(context.Background(), acc)
	if err != nil {
		t.Fatal(err)
	}
	if creds.IMAP.Password != "app-password" || creds.SMTP.Password != "app-password" {
		t.Fatal("both protocols must carry the opened app password")
	}
	if creds.IMAP.Host != acc.ImapHost || creds.IMAP.Port != int(acc.ImapPort) ||
		creds.IMAP.Security != acc.ImapSecurity || creds.IMAP.Email != acc.EmailAddress || creds.IMAP.Username != acc.Username {
		t.Fatalf("imap credentials do not mirror the row: %+v", creds.IMAP)
	}
	if creds.SMTP.Host != acc.SmtpHost || creds.SMTP.Port != int(acc.SmtpPort) ||
		creds.SMTP.Security != acc.SmtpSecurity || creds.SMTP.Email != acc.EmailAddress || creds.SMTP.Username != acc.Username {
		t.Fatalf("smtp credentials do not mirror the row: %+v", creds.SMTP)
	}
	if creds.Version != acc.CredentialVersion {
		t.Fatalf("snapshot version %d, row %d", creds.Version, acc.CredentialVersion)
	}
}

func TestEmailHubAuthFailureMarksTheAccountAndKeepsItsMail(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	if err := svc.SubscribeInboxWatch(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}

	refused := fmt.Errorf("imap login: %w", imapclient.ErrAuthFailed)
	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, errors.New("imap dial: connection refused")) {
		t.Fatal("a network error is not a bad credential")
	}
	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatal("AUTHENTICATIONFAILED must mark the account")
	}
	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatal("an account already marked is not marked again")
	}

	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !row.AuthFailedAt.Valid || row.AuthFailedReason != "imap_auth_failed" {
		t.Fatalf("expected auth_failed_at with imap_auth_failed, got valid=%v reason=%q", row.AuthFailedAt.Valid, row.AuthFailedReason)
	}
	if row.DisconnectedAt.Valid {
		t.Fatal("an auth failure asks for a reconnect; it does not disconnect")
	}
	if row.PasswordEnc != "" {
		t.Fatal("the refused credential must be dropped")
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
		t.Fatalf("cached mail must survive an auth failure, %d threads left", n)
	}
	claimed, err := q.ClaimEmailHubAccountsForSync(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range claimed {
		if c.ID == acc.ID {
			t.Fatal("the background worker must not pick an account that needs reconnect")
		}
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND actor_kind = 'system'`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 1 {
		t.Fatalf("expected one system auth_failed audit row, got %d", n)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountDisconnected, acc.ID); n != 0 {
		t.Fatalf("an auth failure must not audit a disconnect, got %d", n)
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
		t.Fatalf("the open client must hear about it, got %d inbox_changed events", n)
	}
	waitWatchStopped(t, svc, acc.ID)
	svc.hubWatch.mu.Lock()
	_, leased := svc.hubWatch.lastSeen[acc.ID]
	svc.hubWatch.mu.Unlock()
	if leased {
		t.Fatal("the watcher must drop its subscription")
	}

	if _, err := svc.credentials(ctx, row); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("credentials of a marked account: want ErrEmailHubReauthRequired, got %v", err)
	}
	if _, _, err := svc.syncSingleFolder(ctx, row, emailHubFolderInbox, false, true, false, true); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("a sync must stop before dialing, got %v", err)
	}
}

func TestEmailHubStaleCredentialVersionDoesNotMarkTheAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	stale := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	if err := svc.SubscribeInboxWatch(ctx, Human(user.ID), ws.ID, stale.ID); err != nil {
		t.Fatal(err)
	}
	// The owner reconnects while an operation still holds the old snapshot.
	fresh, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: stale.ID, OrganizationID: stale.OrganizationID, Provider: stale.Provider,
		ImapHost: stale.ImapHost, ImapPort: stale.ImapPort, ImapSecurity: stale.ImapSecurity,
		SmtpHost: stale.SmtpHost, SmtpPort: stale.SmtpPort, SmtpSecurity: stale.SmtpSecurity,
		Username: stale.Username, AuthKind: stale.AuthKind, PasswordEnc: stale.PasswordEnc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.CredentialVersion <= stale.CredentialVersion {
		t.Fatalf("a reconnect must bump credential_version: %d -> %d", stale.CredentialVersion, fresh.CredentialVersion)
	}

	if svc.handleAuthError(ctx, stale, stale.CredentialVersion, fmt.Errorf("imap login: %w", imapclient.ErrAuthFailed)) {
		t.Fatal("a failure seen with the replaced credential must not mark the reconnected account")
	}
	row, err := q.GetEmailHubAccountByID(ctx, stale.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.PasswordEnc != fresh.PasswordEnc {
		t.Fatal("the new credential must stay untouched")
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, stale.ID); n != 0 {
		t.Fatalf("a stale failure writes no audit row, got %d", n)
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, stale.ID); n != 0 {
		t.Fatalf("a stale failure emits nothing, got %d events", n)
	}
	svc.hubWatch.mu.Lock()
	_, running := svc.hubWatch.stop[stale.ID]
	svc.hubWatch.mu.Unlock()
	if !running {
		t.Fatal("the watcher belongs to the new credential and must keep running")
	}
}

// A bare NO to LOGIN is also how a throttling provider answers, so it must repeat.
func TestEmailHubBareLoginRefusalMarksOnlyWhenItRepeats(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	refused := fmt.Errorf("imap login: %w", imapclient.ErrLoginRefused)

	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
			t.Fatalf("refusal %d must not mark the account", i+1)
		}
	}
	svc.gov.loginSucceeded(acc.ID) // a good LOGIN in between restarts the run
	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
			t.Fatalf("refusal %d after a good login must not mark the account", i+1)
		}
	}
	if row, err := q.GetEmailHubAccountByID(ctx, acc.ID); err != nil || row.AuthFailedAt.Valid {
		t.Fatalf("account must stay active, err=%v", err)
	}

	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatalf("refusal %d in a row must mark the account", emailHubRefusedLoginsBeforeDisconnect)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid || row.AuthFailedReason != "imap_login_refused" {
		t.Fatalf("expected imap_login_refused, err=%v reason=%q", err, row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n == 0 {
		t.Fatal("cached mail must survive")
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
		t.Fatalf("the open client must hear about it, got %d inbox_changed events", n)
	}
}

func TestEmailHubSMTPAuthFailureMarksButDisabledSMTPDoesNot(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled)) {
		t.Fatal("SMTP AUTH switched off for the mailbox is not a bad credential")
	}
	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed)) {
		t.Fatal("a 535 must mark the account")
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid || row.AuthFailedReason != "smtp_auth_failed" {
		t.Fatalf("expected smtp_auth_failed, err=%v reason=%q", err, row.AuthFailedReason)
	}
}

func TestEmailHubWatchLoopExitsOnceTheAccountNeedsReconnect(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil || n != 1 {
		t.Fatalf("mark: n=%d err=%v", n, err)
	}
	var attempts atomic.Int32
	svc.log = slog.New(countingHandler{match: "watcher idle failed", n: &attempts})
	svc.hubWatch.lastSeen[acc.ID] = time.Now()

	loopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	start := time.Now()
	svc.runHubWatchLoop(loopCtx, acc.ID)
	if time.Since(start) > time.Second {
		t.Fatal("the loop must end at once for an account that needs reconnect")
	}
	if n := attempts.Load(); n != 0 {
		t.Fatalf("no IDLE attempt may be made, got %d", n)
	}
	if svc.gov.isWatching(acc.ID) {
		t.Fatal("the loop must release its watch on exit")
	}
}

func TestEmailHubDisconnectAuditsTheOwner(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatalf("a repeated disconnect stays a no-op, got %v", err)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND actor_kind = $3 AND actor_id = $4`,
		audit.ActionEmailHubAccountDisconnected, acc.ID, string(audit.KindHuman), user.ID); n != 1 {
		t.Fatalf("expected one human disconnect audit row, got %d", n)
	}
}
