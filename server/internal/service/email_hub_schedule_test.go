package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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

func TestEmailHubScheduledSendBatchMissingAccountMarksFailed(t *testing.T) {
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
	if status != "failed" {
		t.Fatalf("status = %q, want failed for missing account", status)
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
	if err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: id, LastError: pgtype.Text{String: "smtp: 550 mailbox unavailable", Valid: true},
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
	if err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: sent.ID, LastError: pgtype.Text{String: "smtp: timeout", Valid: true},
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
