package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	emailHubScheduleBatch       = 20
	emailHubScheduleLease       = 10 * time.Minute
	emailHubScheduleMarkTimeout = 30 * time.Second
)

var (
	emailHubScheduleOwnerOnce sync.Once
	emailHubScheduleOwner     string
)

// Delivery is at-most-once on lease expiry: a crash after SMTP accepts mail but
// before we mark sent leaves the row in sending until the lease times out, then
// FailExpiredEmailHubScheduledSendLeases marks it failed for the user to review.
// A live lease is never returned to pending for a blind resend.

type EmailHubScheduledSendView struct {
	ID        string
	SendAt    time.Time
	Subject   string
	To        []string
	AccountID string
}

func (s *EmailHubService) ScheduleSend(
	ctx context.Context, actor Actor, workspaceID string, in SendEmailHubInput, sendAt time.Time,
) (EmailHubScheduledSendView, error) {
	if !s.Enabled() {
		return EmailHubScheduledSendView{}, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubScheduledSendView{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: in.AccountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubScheduledSendView{}, ErrNotFound
		}
		return EmailHubScheduledSendView{}, err
	}
	if err := validateSendInput(in); err != nil {
		return EmailHubScheduledSendView{}, err
	}
	if _, err := normalizeSendAttachments(in.Attachments); err != nil {
		return EmailHubScheduledSendView{}, err
	}
	if !sendAt.After(time.Now().UTC().Add(30 * time.Second)) {
		return EmailHubScheduledSendView{}, Invalid("scheduled time must be at least 30 seconds in the future")
	}
	row, err := s.queueScheduledSend(ctx, actor, ws, acc, in, sendAt)
	if err != nil {
		return EmailHubScheduledSendView{}, err
	}
	return EmailHubScheduledSendView{
		ID: row.ID, SendAt: row.SendAt.Time, Subject: in.Subject, To: in.To, AccountID: acc.ID,
	}, nil
}

func (s *EmailHubService) scheduleWorkerOwner() string {
	if s.scheduleWorkerOwnerFn != nil {
		return s.scheduleWorkerOwnerFn()
	}
	emailHubScheduleOwnerOnce.Do(func() {
		host, _ := os.Hostname()
		emailHubScheduleOwner = fmt.Sprintf("emailhub-schedule:%s:%d", host, os.Getpid())
	})
	return emailHubScheduleOwner
}

func (s *EmailHubService) runScheduledSendBatch(ctx context.Context) {
	for {
		n := s.runScheduledSendOnce(ctx)
		if n == 0 || n < emailHubScheduleBatch {
			return
		}
	}
}

func (s *EmailHubService) runScheduledSendOnce(ctx context.Context) int {
	now := time.Now().UTC()
	owner := s.scheduleWorkerOwner()
	if _, err := s.q.FailExpiredEmailHubScheduledSendLeases(ctx, pgtype.Timestamptz{Time: now, Valid: true}); err != nil {
		s.log.Warn("email hub scheduled send expire leases", "err", err)
	}
	rows, err := s.q.ClaimDueEmailHubScheduledSends(ctx, db.ClaimDueEmailHubScheduledSendsParams{
		LeaseOwner: fileText(owner), LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(emailHubScheduleLease), Valid: true},
		Now: pgtype.Timestamptz{Time: now, Valid: true}, LimitN: emailHubScheduleBatch,
	})
	if err != nil {
		s.log.Warn("email hub scheduled send claim", "err", err)
		return 0
	}
	for _, row := range rows {
		s.deliverScheduledSend(ctx, row, owner)
	}
	return len(rows)
}

func (s *EmailHubService) deliverScheduledSend(ctx context.Context, row db.EmailHubScheduledSend, owner string) {
	markCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), emailHubScheduleMarkTimeout)
	defer cancel()

	markFailed := func(msg string) {
		n, err := s.q.MarkEmailHubScheduledSendFailed(markCtx, db.MarkEmailHubScheduledSendFailedParams{
			ID: row.ID, LeaseOwner: fileText(owner), LastError: pgtype.Text{String: msg, Valid: true},
		})
		if err != nil {
			s.log.Warn("email hub scheduled send mark failed", "scheduled_id", row.ID, "err", err)
			return
		}
		if n == 0 {
			s.log.Warn("email hub scheduled send mark failed no-op", "scheduled_id", row.ID)
		}
	}

	var payload scheduledSendPayload
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		markFailed("invalid payload")
		return
	}
	attachments, err := decodeSendAttachmentsSDI(payload.Attachments)
	if err != nil {
		markFailed(err.Error())
		return
	}
	acc, err := s.q.GetEmailHubAccountByID(ctx, row.AccountID)
	if err != nil {
		markFailed("account missing")
		return
	}
	sendErr := s.deliverScheduledSendOutbound(ctx, acc, row.OrganizationID, SendEmailHubInput{
		AccountID: row.AccountID, To: payload.To, Cc: payload.Cc, Bcc: payload.Bcc, Subject: payload.Subject,
		BodyText: payload.BodyText, BodyHTML: payload.BodyHTML, Attachments: attachments,
		ReplyToThreadID: payload.ReplyToThreadID,
	})
	if sendErr != nil {
		markFailed(sendErr.Error())
		return
	}
	n, err := s.q.MarkEmailHubScheduledSendSent(markCtx, db.MarkEmailHubScheduledSendSentParams{
		ID: row.ID, LeaseOwner: fileText(owner),
	})
	if err != nil {
		s.log.Error("email hub scheduled send mark sent", "scheduled_id", row.ID, "err", err)
		return
	}
	if n == 0 {
		s.log.Error("email hub scheduled send mark sent no-op", "scheduled_id", row.ID)
	}
}

func (s *EmailHubService) deliverScheduledSendOutbound(
	ctx context.Context, acc db.EmailHubAccount, organizationID string, in SendEmailHubInput,
) error {
	if s.testHookScheduledSend != nil {
		return s.testHookScheduledSend(ctx, acc, organizationID, in)
	}
	_, err := s.sendOutboundMail(ctx, acc, organizationID, in)
	if errors.Is(err, errEmailHubSentNotCached) {
		s.log.Warn("email hub scheduled send not cached", "account_id", acc.ID, "err", err)
		return nil
	}
	return err
}

func (s *EmailHubService) queueScheduledSend(
	ctx context.Context, actor Actor, ws db.Workspace, acc db.EmailHubAccount, in SendEmailHubInput, sendAt time.Time,
) (db.EmailHubScheduledSend, error) {
	attachments := make([]sendEmailHubAttachmentPayload, 0, len(in.Attachments))
	for _, att := range in.Attachments {
		attachments = append(attachments, sendEmailHubAttachmentPayload{
			Filename:      att.Filename,
			ContentType:   att.ContentType,
			ContentBase64: base64.StdEncoding.EncodeToString(att.Data),
		})
	}
	payload, err := json.Marshal(scheduledSendPayload{
		To: in.To, Cc: in.Cc, Bcc: in.Bcc, Subject: in.Subject, BodyText: in.BodyText, BodyHTML: in.BodyHTML,
		ReplyToThreadID: in.ReplyToThreadID, Attachments: attachments,
	})
	if err != nil {
		return db.EmailHubScheduledSend{}, err
	}
	return s.q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: util.NewID(), WorkspaceID: ws.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		UserID: actor.ID, Payload: payload, SendAt: pgtype.Timestamptz{Time: sendAt.UTC(), Valid: true},
	})
}
