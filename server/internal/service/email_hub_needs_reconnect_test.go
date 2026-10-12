package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// markSeedAccountAuthFailed puts acc into needs_reconnect the way markAuthFailed does.
func markSeedAccountAuthFailed(t *testing.T, q *db.Queries, acc db.EmailHubAccount) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid {
		t.Fatalf("auth_failed_at not set: err=%v", err)
	}
	return row
}

func seedDueEmailHubScheduledSend(t *testing.T, q *db.Queries, ws db.Workspace, userID, accountID string) string {
	t.Helper()
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(context.Background(), db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: accountID, OrganizationID: ws.OrganizationID,
		UserID: userID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func scheduledSendOutcome(t *testing.T, pool *pgxpool.Pool, id string) (status, lastErr string) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT status, coalesce(last_error, '') FROM email_hub_scheduled_sends WHERE id = $1`, id,
	).Scan(&status, &lastErr); err != nil {
		t.Fatal(err)
	}
	return status, lastErr
}

func countSMTPSends(svc *EmailHubService, err error) *atomic.Int32 {
	var calls atomic.Int32
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error) {
		calls.Add(1)
		if err != nil {
			return "", nil, err
		}
		return "<sent@example.com>", nil, nil
	}
	return &calls
}

// Every operation that has to reach the mail server answers 409 before it dials
// or writes anything, while the account waits for its owner to reconnect.
func TestEmailHubNeedsReconnectRefusesServerWorkBeforeDial(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	views, err := svc.ListAccounts(ctx, actor, ws.ID)
	if err != nil || len(views) != 1 || !views[0].NeedsReconnect || views[0].AuthFailedReason != "imap_auth_failed" || views[0].AuthKind != "password" {
		t.Fatalf("ListAccounts must expose needs_reconnect: %+v err=%v", views, err)
	}
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	att, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Filename: "a.pdf", MimeType: "application/pdf", SizeBytes: 10, PartID: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	smtpCalls := countSMTPSends(svc, nil)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	mail := SendEmailHubInput{AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body"}

	calls := map[string]func() error{
		"mark read": func() error {
			_, err := svc.MarkThreadRead(ctx, actor, ws.ID, acc.ID, thread.ID, true)
			return err
		},
		"star": func() error {
			_, err := svc.MarkThreadStarred(ctx, actor, ws.ID, acc.ID, thread.ID, true)
			return err
		},
		"move": func() error {
			return svc.MoveThread(ctx, actor, ws.ID, acc.ID, thread.ID, emailhub.FolderTrash)
		},
		"send": func() error {
			_, err := svc.Send(ctx, actor, ws.ID, mail)
			return err
		},
		"schedule send": func() error {
			_, err := svc.ScheduleSend(ctx, actor, ws.ID, mail, time.Now().Add(time.Hour))
			return err
		},
		"attachment": func() error {
			_, _, err := svc.OpenAttachment(ctx, actor, ws.ID, acc.ID, thread.ID, att.ID)
			return err
		},
		"sync": func() error {
			_, err := svc.Sync(ctx, actor, ws.ID, acc.ID, "", true, false, false)
			return err
		},
		"watch": func() error {
			_, err := svc.WatchInbox(ctx, actor, ws.ID, acc.ID)
			return err
		},
		"subscribe watch": func() error {
			return svc.SubscribeInboxWatch(ctx, actor, ws.ID, acc.ID)
		},
	}
	for name, call := range calls {
		if err := call(); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Errorf("%s: err = %v, want ErrEmailHubReauthRequired", name, err)
		}
	}

	if n := smtpCalls.Load(); n != 0 {
		t.Fatalf("SMTP called %d times for a needs_reconnect account", n)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		t.Fatalf("the thread must survive a refused move: %v", err)
	}
	if row.IsRead || row.IsStarred {
		t.Fatalf("a refused PATCH must not write the cache: read=%v starred=%v", row.IsRead, row.IsStarred)
	}
	var queued int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_scheduled_sends WHERE account_id = $1`, acc.ID).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 0 {
		t.Fatalf("a refused schedule must not queue a send, got %d", queued)
	}
	svc.hubWatch.mu.Lock()
	_, running := svc.hubWatch.stop[acc.ID]
	svc.hubWatch.mu.Unlock()
	if running || svc.gov.isWatching(acc.ID) {
		t.Fatal("a refused subscribe must not start the watcher")
	}

	// The cached list stays readable, and a search answers from the cache only
	// (no IMAP SEARCH): spec §3 blocks only the IMAP half of a search.
	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 {
		t.Fatalf("cached list: err=%v threads=%d", err, len(page.Threads))
	}
	searched, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Query: thread.Subject, Limit: 50,
	})
	if err != nil || len(searched.Threads) != 1 {
		t.Fatalf("cache search on a needs_reconnect account: err=%v threads=%d", err, len(searched.Threads))
	}
}

func TestEmailHubNeedsReconnectGetThreadServesCacheWithoutDialing(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	cached := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	uncached, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: 43, Subject: "Other",
		Snippet: "other", FromAddr: "c@d.co", ToAddrs: []string{"seed@gmail.com"},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ImapLabels: []string{}, ConversationKey: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	const html = "<p>The whole message body.</p>"
	if _, err := q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID:       cached.ID,
		BodyText: pgtype.Text{String: "The whole message body.", Valid: true},
		BodyHtml: pgtype.Text{String: html, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	var failures atomic.Int32
	svc.log = slog.New(countingHandler{match: "failed", n: &failures})

	view, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, cached.ID, true, true)
	if err != nil {
		t.Fatalf("GetThread must never refuse a needs_reconnect account: %v", err)
	}
	if view.BodyHTML != html || !view.IsRead {
		t.Fatalf("cached body/read: html=%q read=%v", view.BodyHTML, view.IsRead)
	}
	view, err = svc.GetThread(ctx, actor, ws.ID, acc.ID, uncached.ID, true, false)
	if err != nil || view.BodyCached || view.BodyText != "" || view.BodyHTML != "" {
		t.Fatalf("uncached: err=%v cached=%v", err, view.BodyCached)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: cached.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil || !row.IsRead {
		t.Fatalf("opening must still mark the cache read: err=%v", err)
	}
	time.Sleep(300 * time.Millisecond) // a spawned IMAP mark-read would have logged by now
	if n := failures.Load(); n != 0 {
		t.Fatalf("%d IMAP attempts logged; a needs_reconnect account must not dial", n)
	}
}

func TestEmailHubNeedsReconnectAfterSMTPRejectsCredentials(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed))

	_, err := svc.Send(ctx, Human(user.ID), ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
	})
	if !errors.Is(err, ErrEmailHubReauthRequired) || errors.Is(err, ErrEmailHubSendFailed) {
		t.Fatalf("err = %v, want bare ErrEmailHubReauthRequired", err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !row.AuthFailedAt.Valid || row.AuthFailedReason != "smtp_auth_failed" || row.DisconnectedAt.Valid {
		t.Fatalf("want needs_reconnect/smtp_auth_failed, got failed=%v reason=%q disconnected=%v",
			row.AuthFailedAt.Valid, row.AuthFailedReason, row.DisconnectedAt.Valid)
	}
	var sent, total int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE folder = $2), count(*)
		FROM email_hub_threads WHERE account_id = $1`, acc.ID, emailhub.FolderSent).Scan(&sent, &total); err != nil {
		t.Fatal(err)
	}
	if sent != 0 || total != 1 {
		t.Fatalf("no Sent row for a refused send and the cache kept: sent=%d total=%d", sent, total)
	}
}

func TestEmailHubNeedsReconnectNotSetWhenSMTPAuthDisabled(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled))

	_, err := svc.Send(ctx, Human(user.ID), ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
	})
	if !errors.Is(err, ErrEmailHubSMTPDisabled) || errors.Is(err, ErrEmailHubSendFailed) {
		t.Fatalf("err = %v, want bare ErrEmailHubSMTPDisabled", err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.PasswordEnc != acc.PasswordEnc {
		t.Fatalf("SMTP AUTH disabled is not an auth failure: failed=%v password kept=%v",
			row.AuthFailedAt.Valid, row.PasswordEnc == acc.PasswordEnc)
	}
}

func TestEmailHubNeedsReconnectScheduledSendFailsAuthRequired(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	calls := countSMTPSends(svc, nil)

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "auth_required" {
		t.Fatalf("status=%q last_error=%q, want failed/auth_required", status, lastErr)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a due send of a needs_reconnect account went to SMTP %d times", n)
	}
}

func TestEmailHubNeedsReconnectScheduledSendSMTPAuthFailure(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed))

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "auth_required" {
		t.Fatalf("status=%q last_error=%q, want failed/auth_required", status, lastErr)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil || !row.AuthFailedAt.Valid {
		t.Fatalf("a 535 on a scheduled send must mark the account: err=%v", err)
	}
}

func TestEmailHubNeedsReconnectScheduledSendSMTPDisabled(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled))

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "smtp_disabled" {
		t.Fatalf("status=%q last_error=%q, want failed/smtp_disabled", status, lastErr)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil || row.AuthFailedAt.Valid {
		t.Fatalf("SMTP AUTH disabled must leave the account active: err=%v", err)
	}
}

// A due reply whose parent was deleted still answers auth_required: the
// account's state is checked before the parent lookup (spec §3).
func TestEmailHubNeedsReconnectScheduledReplyToDeletedParentFailsAuthRequired(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	if _, err := pool.Exec(context.Background(),
		`UPDATE email_hub_scheduled_sends SET payload = jsonb_set(payload::jsonb, '{reply_to_thread_id}', to_jsonb($2::text)) WHERE id = $1`,
		id, util.NewID()); err != nil {
		t.Fatal(err)
	}

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "auth_required" {
		t.Fatalf("status=%q last_error=%q, want failed/auth_required", status, lastErr)
	}
}

// A refused watch never takes a watch slot on the governor.
func TestEmailHubNeedsReconnectWatchTakesNoWatchSlot(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))

	if _, err := svc.WatchInbox(context.Background(), Human(user.ID), ws.ID, acc.ID); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("err = %v, want ErrEmailHubReauthRequired", err)
	}
	svc.gov.mu.Lock()
	_, registered := svc.gov.gates[acc.ID]
	svc.gov.mu.Unlock()
	if registered {
		t.Fatal("a refused watch registered a watch slot")
	}
}

// The send-failed log carries the classified code, never the server's reply.
func TestEmailHubSendFailureLogsTheClassifiedCode(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	const reply = "535 5.7.8 rejected for seed@gmail.com at smtp.secret.example"
	for _, sentinel := range []error{smtpclient.ErrAuthFailed, smtpclient.ErrSMTPAuthDisabled} {
		acc := seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, util.NewID()+"@gmail.com")
		countSMTPSends(svc, fmt.Errorf("%s: %w", reply, sentinel))
		if _, err := svc.Send(context.Background(), Human(user.ID), ws.ID, SendEmailHubInput{
			AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
		}); err == nil {
			t.Fatalf("%v: send succeeded", sentinel)
		}
	}
	out := logs.String()
	if strings.Contains(out, "smtp.secret.example") || strings.Contains(out, "seed@gmail.com") {
		t.Fatalf("the log carries the raw SMTP reply:\n%s", out)
	}
	if !strings.Contains(out, "code=auth_failed") || !strings.Contains(out, "code=smtp_disabled") {
		t.Fatalf("the log must carry the classified codes:\n%s", out)
	}
}
