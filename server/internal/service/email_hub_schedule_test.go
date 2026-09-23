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
	list, err := svc.ListPendingScheduledSends(ctx, actor, ws.ID, acc.ID)
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

	_, err := svc.ListPendingScheduledSends(ctx, actor, ws.ID, util.NewID())
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

	if _, err := svc.ListPendingScheduledSends(ctx, actor, ws.ID, acc.ID); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("list: %v", err)
	}
	if err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, util.NewID()); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("cancel: %v", err)
	}
}
