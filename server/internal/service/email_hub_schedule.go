package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const emailHubScheduleBatch = 20

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

func (s *EmailHubService) runScheduledSendBatch(ctx context.Context) {
	rows, err := s.q.ListDueEmailHubScheduledSends(ctx, emailHubScheduleBatch)
	if err != nil {
		s.log.Warn("email hub scheduled send list", "err", err)
		return
	}
	for _, row := range rows {
		s.deliverScheduledSend(ctx, row)
	}
}

func (s *EmailHubService) deliverScheduledSend(ctx context.Context, row db.EmailHubScheduledSend) {
	var payload scheduledSendPayload
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		_ = s.q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
			ID: row.ID, LastError: pgtype.Text{String: "invalid payload", Valid: true},
		})
		return
	}
	attachments, err := decodeSendAttachmentsSDI(payload.Attachments)
	if err != nil {
		_ = s.q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
			ID: row.ID, LastError: pgtype.Text{String: err.Error(), Valid: true},
		})
		return
	}
	acc, err := s.q.GetEmailHubAccountByID(ctx, row.AccountID)
	if err != nil {
		_ = s.q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
			ID: row.ID, LastError: pgtype.Text{String: "account missing", Valid: true},
		})
		return
	}
	if _, err := s.sendOutboundMail(ctx, acc, row.OrganizationID, SendEmailHubInput{
		AccountID: row.AccountID, To: payload.To, Cc: payload.Cc, Bcc: payload.Bcc, Subject: payload.Subject,
		BodyText: payload.BodyText, BodyHTML: payload.BodyHTML, Attachments: attachments,
		ReplyToThreadID: payload.ReplyToThreadID,
	}); err != nil && !errors.Is(err, errEmailHubSentNotCached) {
		_ = s.q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
			ID: row.ID, LastError: pgtype.Text{String: err.Error(), Valid: true},
		})
		return
	} else if err != nil {
		s.log.Warn("email hub scheduled send not cached", "scheduled_id", row.ID, "err", err)
	}
	_ = s.q.MarkEmailHubScheduledSendSent(ctx, row.ID)
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
