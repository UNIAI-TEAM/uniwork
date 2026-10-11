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

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
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

func TestEmailHubAuthFailureDisconnectsTheAccount(t *testing.T) {
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

	if svc.disconnectOnAuthFailure(ctx, acc, errors.New("imap dial: connection refused")) {
		t.Fatal("a network error must not disconnect the account")
	}
	if !svc.disconnectOnAuthFailure(ctx, acc, fmt.Errorf("imap login: %w", imapclient.ErrAuthFailed)) {
		t.Fatal("a refused LOGIN must disconnect the account")
	}

	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.DisconnectedAt.Valid {
		t.Fatalf("expected disconnected_at set, err=%v", err)
	}
	connected, err := q.ClaimEmailHubAccountsForSync(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range connected {
		if c.ID == acc.ID {
			t.Fatal("the background worker must not pick a disconnected account")
		}
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND actor_kind = 'system'`,
		audit.ActionEmailHubAccountDisconnected, acc.ID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("expected one system audit row, got %d", audits)
	}
	var threads int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID).Scan(&threads); err != nil {
		t.Fatal(err)
	}
	if threads != 0 {
		t.Fatalf("a disconnected account keeps no cached mail, %d threads left", threads)
	}
	deadline := time.Now().Add(2 * time.Second)
	for svc.gov.isWatching(acc.ID) {
		if time.Now().After(deadline) {
			t.Fatal("the watcher must exit after the account is disconnected")
		}
		time.Sleep(20 * time.Millisecond)
	}
	svc.hubWatch.mu.Lock()
	_, leased := svc.hubWatch.lastSeen[acc.ID]
	svc.hubWatch.mu.Unlock()
	if leased {
		t.Fatal("the watcher must drop its subscription")
	}
}

// A bare NO to LOGIN is also how a throttling provider answers, and a
// disconnect wipes the cache and cancels queued sends, so it must repeat.
func TestEmailHubBareLoginRefusalDisconnectsOnlyWhenItRepeats(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	refused := fmt.Errorf("imap login: %w", imapclient.ErrLoginRefused)

	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.disconnectOnAuthFailure(ctx, acc, refused) {
			t.Fatalf("refusal %d must not disconnect", i+1)
		}
	}
	svc.gov.loginSucceeded(acc.ID) // a good LOGIN in between restarts the run
	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.disconnectOnAuthFailure(ctx, acc, refused) {
			t.Fatalf("refusal %d after a good login must not disconnect", i+1)
		}
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || row.DisconnectedAt.Valid {
		t.Fatalf("account must stay connected, err=%v", err)
	}
	var threads int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID).Scan(&threads); err != nil || threads == 0 {
		t.Fatalf("cached mail must survive transient refusals, threads=%d err=%v", threads, err)
	}

	if !svc.disconnectOnAuthFailure(ctx, acc, refused) {
		t.Fatalf("refusal %d in a row must disconnect", emailHubRefusedLoginsBeforeDisconnect)
	}
	if row, err := q.GetEmailHubAccountByID(ctx, acc.ID); err != nil || !row.DisconnectedAt.Valid {
		t.Fatalf("expected disconnected_at set, err=%v", err)
	}
	var events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events
		WHERE topic = 'email_hub.inbox_changed' AND payload::jsonb->>'account_id' = $1`, acc.ID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 1 {
		t.Fatalf("the open client must hear about the disconnect, got %d inbox_changed events", events)
	}
}
