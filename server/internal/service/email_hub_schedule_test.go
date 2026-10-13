package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestEmailHubScheduleSendRequiresConfiguration(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	svc.box = nil

	_, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"a@example.com"}, Subject: "Hi", BodyText: "Body",
	}, time.Now().UTC().Add(time.Minute))
	if !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("expected not configured, got %v", err)
	}
}

func TestEmailHubScheduledSendBatchMarksBadPayloadFailed(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	id := util.NewID()
	// Valid JSON for jsonb, but not an object — deliverScheduledSend must reject it.
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: []byte(`[]`), SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	svc.runScheduledSendBatch(ctx)

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %q, want failed", status)
	}
}

func TestEmailHubScheduledSendBatchRejectsBadAttachmentPayload(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
		Attachments: []sendEmailHubAttachmentPayload{{Filename: "a.bin", ContentBase64: "!!!"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	svc.runScheduledSendBatch(ctx)

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %q, want failed", status)
	}
}

func TestEmailHubScheduledSendBatchSMTPFailureMarksFailed(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	svc.runScheduledSendBatch(ctx)

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "failed" {
		t.Fatalf("status = %q, want failed after SMTP error", status)
	}
}

func TestEmailHubScheduledSendClassifiesOutboundResult(t *testing.T) {
	tests := []struct {
		name          string
		sendErr       error
		wantStatus    string
		wantLastError string
	}{
		{
			name:       "sent but not cached is final success",
			sendErr:    fmt.Errorf("cache insert: %w", errEmailHubSentNotCached),
			wantStatus: "sent",
		},
		{
			name:          "ordinary send failure remains failed",
			sendErr:       errors.New("smtp unavailable"),
			wantStatus:    "failed",
			wantLastError: "smtp unavailable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, q, user, ws, pool := emailHubFixture(t)
			ctx := context.Background()
			acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
			payload, err := json.Marshal(scheduledSendPayload{
				To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
			})
			if err != nil {
				t.Fatal(err)
			}
			id := util.NewID()
			if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
				ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
				UserID: user.ID, Payload: payload,
				SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
			}); err != nil {
				t.Fatal(err)
			}

			var sends atomic.Int32
			svc.testHookScheduledSend = func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error {
				sends.Add(1)
				return tt.sendErr
			}
			if n := svc.runScheduledSendOnce(ctx); n != 1 {
				t.Fatalf("claimed %d rows, want 1", n)
			}

			var (
				status  string
				lastErr pgtype.Text
			)
			if err := pool.QueryRow(ctx,
				`SELECT status, last_error FROM email_hub_scheduled_sends WHERE id=$1`, id,
			).Scan(&status, &lastErr); err != nil {
				t.Fatal(err)
			}
			if status != tt.wantStatus {
				t.Fatalf("status = %q, want %q", status, tt.wantStatus)
			}
			if got := lastErr.String; lastErr.Valid != (tt.wantLastError != "") || got != tt.wantLastError {
				t.Fatalf("last_error = %+v, want %q", lastErr, tt.wantLastError)
			}

			// Neither a final sent row nor a terminal failed row is picked up again
			// without an explicit user retry.
			if n := svc.runScheduledSendOnce(ctx); n != 0 {
				t.Fatalf("second run claimed %d rows, want 0", n)
			}
			if got := sends.Load(); got != 1 {
				t.Fatalf("outbound calls = %d, want 1", got)
			}
		})
	}
}

func TestEmailHubScheduledSendRealCacheFailureStaysSent(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload,
		SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	var sends atomic.Int32
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error) {
		sends.Add(1)
		cancel() // SMTP accepted the message; force the following cache write to fail.
		return "<scheduled@example.com>", []byte("accepted"), nil
	}
	if n := svc.runScheduledSendOnce(ctx); n != 1 {
		t.Fatalf("claimed %d rows, want 1", n)
	}

	var (
		status  string
		lastErr pgtype.Text
	)
	if err := pool.QueryRow(context.Background(),
		`SELECT status, last_error FROM email_hub_scheduled_sends WHERE id=$1`, id,
	).Scan(&status, &lastErr); err != nil {
		t.Fatal(err)
	}
	if status != "sent" || lastErr.Valid {
		t.Fatalf("status=%q last_error=%+v, want sent with no error", status, lastErr)
	}
	if got := sends.Load(); got != 1 {
		t.Fatalf("SMTP sends = %d, want 1", got)
	}
}

// A row whose mailbox is gone is never claimed: the worker sends only from a
// connected mailbox whose owner still passes the membership gates (UNI-1106).
func TestEmailHubScheduledSendBatchSkipsMissingAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	missingAccount := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: missingAccount, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	svc.runScheduledSendBatch(ctx)

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("status = %q, want pending (unclaimed) for missing account", status)
	}
}

func TestEmailHubScheduleSendWithAttachment(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	sendAt := time.Now().UTC().Add(2 * time.Minute)
	created, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Files", BodyText: "See attached",
		Attachments: []SendEmailHubAttachmentInput{{
			Filename: "note.txt", ContentType: "text/plain", Data: []byte("hello"),
		}},
	}, sendAt)
	if err != nil {
		t.Fatal(err)
	}
	list, err := svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID)
	if err != nil || len(list) != 1 || list[0].ID != created.ID {
		t.Fatalf("list: err=%v list=%+v created=%+v", err, list, created)
	}
}

func TestEmailHubCancelScheduledSendNotFound(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, "01SCHD00000000000000000001")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestEmailHubListScheduledSendsWrongAccountNotFound(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	_, err := svc.ListScheduledSends(ctx, actor, ws.ID, util.NewID())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestEmailHubScheduledListRequiresConfiguration(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	svc.box = nil

	if _, err := svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("list: %v", err)
	}
	if err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, util.NewID()); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("cancel: %v", err)
	}
}

// seedFailedScheduledSend inserts a scheduled send and marks it failed the way
// the worker does.
func seedFailedScheduledSend(
	t *testing.T, q *db.Queries, wsID, orgID, accID, userID, subject string, sendAt time.Time,
) string {
	t.Helper()
	ctx := context.Background()
	payload, err := json.Marshal(scheduledSendPayload{To: []string{"dest@example.com"}, Subject: subject, BodyText: "x"})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: wsID, AccountID: accID, OrganizationID: orgID,
		UserID: userID, Payload: payload, SendAt: pgtype.Timestamptz{Time: sendAt, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: id, LeaseOwner: pgtype.Text{String: "", Valid: true}, LastError: pgtype.Text{String: "smtp: 550 mailbox unavailable", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestEmailHubListScheduledSendsIncludesFailedFirst(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	pending, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Soon", BodyText: "Hi",
	}, time.Now().UTC().Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	// Failed with a later send_at than the pending one: must still come first.
	failedID := seedFailedScheduledSend(t, q, ws.ID, ws.OrganizationID, acc.ID, user.ID, "Broke",
		time.Now().UTC().Add(time.Hour))

	list, err := svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list: err=%v list=%+v", err, list)
	}
	if list[0].ID != failedID || list[0].Status != "failed" || list[0].Subject != "Broke" {
		t.Fatalf("first item = %+v, want failed %s", list[0], failedID)
	}
	if list[1].ID != pending.ID || list[1].Status != "pending" {
		t.Fatalf("second item = %+v, want pending %s", list[1], pending.ID)
	}
}

func TestEmailHubCancelScheduledSendDismissesFailed(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	failedID := seedFailedScheduledSend(t, q, ws.ID, ws.OrganizationID, acc.ID, user.ID, "Broke",
		time.Now().UTC().Add(-time.Minute))

	if err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, failedID); err != nil {
		t.Fatalf("dismiss failed: %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, failedID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", status)
	}
	list, err := svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("expected empty after dismiss: err=%v list=%+v", err, list)
	}
}

func TestEmailHubRetryScheduledSend(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	failedID := seedFailedScheduledSend(t, q, ws.ID, ws.OrganizationID, acc.ID, user.ID, "Broke",
		time.Now().UTC().Add(-time.Hour))

	if err := svc.RetryScheduledSend(ctx, actor, ws.ID, acc.ID, failedID); err != nil {
		t.Fatalf("retry: %v", err)
	}
	var (
		status  string
		lastErr pgtype.Text
		sendAt  time.Time
	)
	if err := pool.QueryRow(ctx,
		`SELECT status, last_error, send_at FROM email_hub_scheduled_sends WHERE id=$1`, failedID,
	).Scan(&status, &lastErr, &sendAt); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || lastErr.Valid {
		t.Fatalf("after retry: status=%q last_error=%+v", status, lastErr)
	}
	// send_at is reset to the DB's now(); allow for container clock skew.
	if d := time.Since(sendAt); d > time.Minute || d < -time.Minute {
		t.Fatalf("send_at = %v, want about now", sendAt)
	}

	// Now pending: retry again is not found.
	if err := svc.RetryScheduledSend(ctx, actor, ws.ID, acc.ID, failedID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retry pending: expected not found, got %v", err)
	}
	if err := svc.RetryScheduledSend(ctx, actor, ws.ID, acc.ID, util.NewID()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retry unknown: expected not found, got %v", err)
	}
	if err := svc.RetryScheduledSend(ctx, actor, ws.ID, util.NewID(), failedID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("retry wrong account: expected not found, got %v", err)
	}
	svc.box = nil
	if err := svc.RetryScheduledSend(ctx, actor, ws.ID, acc.ID, failedID); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("retry unconfigured: %v", err)
	}
}

// A cancel that lands while the worker is mid-send must stay cancelled: a late
// failure report cannot turn it into a retryable failed row.
func TestEmailHubScheduledSendFailureKeepsCancelled(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	sent, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Soon", BodyText: "Hi",
	}, time.Now().UTC().Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, sent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: sent.ID, LeaseOwner: pgtype.Text{String: "", Valid: true}, LastError: pgtype.Text{String: "smtp: timeout", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, sent.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "cancelled" {
		t.Fatalf("status = %q, want cancelled", status)
	}
}

func TestEmailHubScheduledSendOnceAcrossTwoWorkers(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	due := pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true}
	for i := 0; i < 50; i++ {
		if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
			ID: util.NewID(), WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
			UserID: user.ID, Payload: payload, SendAt: due,
		}); err != nil {
			t.Fatal(err)
		}
	}
	var sendCount atomic.Int32
	hook := func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error {
		sendCount.Add(1)
		return nil
	}
	worker := func(owner string) {
		w := NewEmailHubService(svc.q, svc.ws, svc.box) // not *svc: that would copy refreshLocks
		w.scheduleWorkerOwnerFn = func() string { return owner }
		w.testHookScheduledSend = hook
		for {
			if n := w.runScheduledSendOnce(ctx); n == 0 {
				return
			}
		}
	}
	var wg sync.WaitGroup
	for _, owner := range []string{"worker-a", "worker-b"} {
		wg.Add(1)
		go func(o string) {
			defer wg.Done()
			worker(o)
		}(owner)
	}
	wg.Wait()
	if n := int(sendCount.Load()); n != 50 {
		t.Fatalf("hook send count = %d, want 50", n)
	}
}

func TestEmailHubScheduledSendMarkSentFailureStaysSending(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	owner := "worker-mark-sent"
	svc.scheduleWorkerOwnerFn = func() string { return owner }
	svc.testHookScheduledSend = func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error { return nil }

	if n := svc.runScheduledSendOnce(ctx); n != 1 {
		t.Fatalf("claimed %d rows, want 1", n)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "sent" {
		t.Fatalf("after deliver status = %q, want sent", status)
	}

	// Simulate SMTP ok but bookkeeping lost the lease owner: row stays sending, not pending.
	id2 := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id2, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := q.ClaimDueEmailHubScheduledSends(ctx, db.ClaimDueEmailHubScheduledSendsParams{
		LeaseOwner: fileText(owner), LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(emailHubScheduleLease), Valid: true},
		Now: pgtype.Timestamptz{Time: now, Valid: true}, LimitN: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if n, err := q.MarkEmailHubScheduledSendSent(ctx, db.MarkEmailHubScheduledSendSentParams{
		ID: id2, LeaseOwner: fileText("wrong-owner"),
	}); err != nil || n != 0 {
		t.Fatalf("mark sent wrong owner: n=%d err=%v", n, err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id=$1`, id2).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "sending" {
		t.Fatalf("status = %q, want sending (never pending)", status)
	}
}

func TestEmailHubScheduledSendExpiredLeaseMarksFailedNotPending(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: user.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	owner := "worker-expired"
	now := time.Now().UTC()
	claimed, err := q.ClaimDueEmailHubScheduledSends(ctx, db.ClaimDueEmailHubScheduledSendsParams{
		LeaseOwner: fileText(owner), LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(-time.Minute), Valid: true},
		Now: pgtype.Timestamptz{Time: now, Valid: true}, LimitN: 1,
	})
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim: err=%v rows=%d", err, len(claimed))
	}
	if _, err := q.FailExpiredEmailHubScheduledSendLeases(ctx, pgtype.Timestamptz{Time: now, Valid: true}); err != nil {
		t.Fatal(err)
	}
	var status, lastErr string
	if err := pool.QueryRow(ctx, `SELECT status, last_error FROM email_hub_scheduled_sends WHERE id=$1`, id).
		Scan(&status, &lastErr); err != nil {
		t.Fatal(err)
	}
	if status != "failed" || lastErr != "worker lease expired" {
		t.Fatalf("status=%q last_error=%q, want failed / worker lease expired", status, lastErr)
	}
}

// emailHubLifecycle is a plain member's mailbox (not the owner's, so it can be
// deactivated, leave or be deleted) with one cached thread and one due
// scheduled send, plus a send hook that counts what would go out (UNI-1106).
type emailHubLifecycle struct {
	svc     *EmailHubService
	q       *db.Queries
	pool    *pgxpool.Pool
	auth    *AuthService
	members *OrganizationMemberService
	owner   db.User
	member  db.User
	ws      db.Workspace
	acc     db.EmailHubAccount
	sendID  string
	sends   *atomic.Int32
}

func newEmailHubLifecycle(t *testing.T) emailHubLifecycle {
	t.Helper()
	svc, q, owner, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	member := registerVerified(t, q, as, "eh-member@example.com", "EH Member")
	addOrgMember(t, q, ws.OrganizationID, member.ID)
	addWorkspaceMember(t, q, ws.ID, member.ID)
	acc := seedEmailHubAccount(t, q, svc.box, member.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	sent, err := svc.ScheduleSend(ctx, Human(member.ID), ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"client@example.com"}, Subject: "Tomorrow 9:00", BodyText: "Hi",
	}, time.Now().UTC().Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_scheduled_sends SET send_at = now() - interval '1 minute' WHERE id = $1`, sent.ID); err != nil {
		t.Fatal(err)
	}
	sends := &atomic.Int32{}
	svc.testHookScheduledSend = func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error {
		sends.Add(1)
		return nil
	}
	return emailHubLifecycle{
		svc: svc, q: q, pool: pool, auth: as, members: NewOrganizationMemberService(pool, q, svc.ws.orgs),
		owner: owner, member: member, ws: ws, acc: acc, sendID: sent.ID, sends: sends,
	}
}

// tick runs the send-later worker once and reports how many mails went out.
func (l emailHubLifecycle) tick(t *testing.T) int32 {
	t.Helper()
	before := l.sends.Load()
	l.svc.runScheduledSendOnce(context.Background())
	return l.sends.Load() - before
}

func (l emailHubLifecycle) column(t *testing.T, query string) string {
	t.Helper()
	var v string
	if err := l.pool.QueryRow(context.Background(), query, l.acc.ID).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func (l emailHubLifecycle) sendStatus(t *testing.T) string {
	t.Helper()
	return l.column(t, `SELECT status FROM email_hub_scheduled_sends WHERE account_id = $1`)
}

func (l emailHubLifecycle) passwordEnc(t *testing.T) string {
	t.Helper()
	return l.column(t, `SELECT password_enc FROM email_hub_accounts WHERE id = $1`)
}

func (l emailHubLifecycle) cachedThreads(t *testing.T) string {
	t.Helper()
	return l.column(t, `SELECT count(*)::text FROM email_hub_threads WHERE account_id = $1`)
}

// syncPicksUp reports whether the sync worker would log in to the mailbox.
func (l emailHubLifecycle) syncPicksUp(t *testing.T) bool {
	t.Helper()
	rows, err := l.q.ClaimEmailHubAccountsForSync(context.Background(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ID == l.acc.ID {
			return true
		}
	}
	return false
}

// assertRevoked is the state a mailbox is left in once its owner disconnected,
// left the organization or deleted their account.
func (l emailHubLifecycle) assertRevoked(t *testing.T) {
	t.Helper()
	if n := l.tick(t); n != 0 {
		t.Fatalf("%d scheduled mails went out from a revoked mailbox", n)
	}
	if got := l.sendStatus(t); got != "cancelled" {
		t.Fatalf("scheduled send status = %q, want cancelled", got)
	}
	if got := l.passwordEnc(t); got != "" {
		t.Fatalf("app password still stored: %q", got)
	}
	if got := l.cachedThreads(t); got != "0" {
		t.Fatalf("cached threads = %s, want 0", got)
	}
	if l.syncPicksUp(t) {
		t.Fatal("the sync worker still picks the mailbox up")
	}
}

func TestEmailHubDisconnectCancelsScheduledSendsAndWipesThePassword(t *testing.T) {
	l := newEmailHubLifecycle(t)
	if err := l.svc.Disconnect(context.Background(), Human(l.member.ID), l.ws.ID, l.acc.ID); err != nil {
		t.Fatal(err)
	}
	l.assertRevoked(t)
}

// A deactivated member or a suspended organization keeps the mailbox and its
// queue as they are; the workers skip them, and lifting the block resumes both
// with no further code.
func TestEmailHubWorkersSkipDeactivatedMembersAndSuspendedOrganizations(t *testing.T) {
	ctx := context.Background()
	for _, how := range []string{"deactivate", "suspend"} {
		t.Run(how, func(t *testing.T) {
			l := newEmailHubLifecycle(t)
			block, unblock := func() error {
				_, err := l.members.Deactivate(ctx, l.owner.ID, l.ws.OrganizationID, l.member.ID)
				return err
			}, func() error {
				_, err := l.members.Reactivate(ctx, l.owner.ID, l.ws.OrganizationID, l.member.ID)
				return err
			}
			if how == "suspend" {
				setStatus := func(status string) func() error {
					return func() error {
						_, err := l.pool.Exec(ctx, `UPDATE organizations SET status = $2 WHERE id = $1`, l.ws.OrganizationID, status)
						return err
					}
				}
				block, unblock = setStatus("suspended"), setStatus("active")
			}
			if err := block(); err != nil {
				t.Fatal(err)
			}
			if n := l.tick(t); n != 0 {
				t.Fatalf("%d scheduled mails went out while blocked", n)
			}
			if got := l.sendStatus(t); got != "pending" {
				t.Fatalf("scheduled send status = %q, want pending (not claimed)", got)
			}
			if l.syncPicksUp(t) {
				t.Fatal("the sync worker picks up a blocked mailbox")
			}
			if err := unblock(); err != nil {
				t.Fatal(err)
			}
			if !l.syncPicksUp(t) {
				t.Fatal("sync did not resume once the block was lifted")
			}
			if n := l.tick(t); n != 1 {
				t.Fatalf("after unblocking %d mails went out, want 1", n)
			}
		})
	}
}

// A row claimed just before the disconnect committed still does not go out.
func TestEmailHubScheduledSendClaimedBeforeDisconnectFails(t *testing.T) {
	l := newEmailHubLifecycle(t)
	ctx := context.Background()
	now := time.Now().UTC()
	rows, err := l.q.ClaimDueEmailHubScheduledSends(ctx, db.ClaimDueEmailHubScheduledSendsParams{
		LeaseOwner: fileText("w"), LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(emailHubScheduleLease), Valid: true},
		Now: pgtype.Timestamptz{Time: now, Valid: true}, LimitN: 1,
	})
	if err != nil || len(rows) != 1 {
		t.Fatalf("claim: %v len=%d", err, len(rows))
	}
	if err := l.svc.Disconnect(ctx, Human(l.member.ID), l.ws.ID, l.acc.ID); err != nil {
		t.Fatal(err)
	}
	l.svc.deliverScheduledSend(ctx, rows[0], "w")
	if n := l.sends.Load(); n != 0 {
		t.Fatalf("%d mails went out after the disconnect", n)
	}
	if got := l.sendStatus(t); got != "failed" {
		t.Fatalf("status = %q, want failed", got)
	}
}

// Leave and account deletion cannot be retried by their caller, so their
// after-commit cleanup outlives a request whose client already went away.
func TestEmailHubCleanupAfterCommitSurvivesACancelledRequest(t *testing.T) {
	l := newEmailHubLifecycle(t)
	rows, err := l.q.DisconnectEmailHubAccountsForUser(context.Background(), db.DisconnectEmailHubAccountsForUserParams{UserID: l.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cleanUpEmailHubAccountsAfterCommit(ctx, l.q, nil, rows)
	l.assertRevoked(t)
}
