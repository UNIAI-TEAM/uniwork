package service

import (
	"context"
	"errors"
	"io"

	"github.com/jackc/pgx/v5"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const maxEmailHubAttachmentBytes = 25 << 20

type EmailHubAttachmentView struct {
	ID        string
	ThreadID  string
	Filename  string
	MimeType  string
	SizeBytes int64
	PartID    string
}

func attachmentView(r db.EmailHubAttachment) EmailHubAttachmentView {
	return EmailHubAttachmentView{
		ID: r.ID, ThreadID: r.ThreadID, Filename: r.Filename,
		MimeType: r.MimeType, SizeBytes: r.SizeBytes, PartID: r.PartID,
	}
}

func (s *EmailHubService) replaceThreadAttachments(ctx context.Context, acc db.EmailHubAccount, threadID string, items []imapclient.AttachmentMeta) error {
	if err := s.q.DeleteEmailHubAttachmentsForThread(ctx, threadID); err != nil {
		return err
	}
	for _, it := range items {
		_, err := s.q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
			ID: util.NewID(), ThreadID: threadID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			Filename: it.Filename, MimeType: it.MimeType, SizeBytes: int64(it.Size), PartID: it.PartID,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *EmailHubService) listThreadAttachments(ctx context.Context, threadID, accountID, organizationID string) ([]EmailHubAttachmentView, error) {
	rows, err := s.q.ListEmailHubAttachments(ctx, db.ListEmailHubAttachmentsParams{
		ThreadID: threadID, AccountID: accountID, OrganizationID: organizationID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]EmailHubAttachmentView, 0, len(rows))
	for _, r := range rows {
		out = append(out, attachmentView(r))
	}
	return out, nil
}

// OpenAttachment streams one attachment from IMAP after verifying ownership.
func (s *EmailHubService) OpenAttachment(
	ctx context.Context, actor Actor, workspaceID, accountID, threadID, attachmentID string,
) (EmailHubAttachmentView, io.ReadCloser, error) {
	if !s.Enabled() {
		return EmailHubAttachmentView{}, nil, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAttachmentView{}, nil, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubAttachmentView{}, nil, err
	}
	thread, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubAttachmentView{}, nil, err
	}
	row, err := s.q.GetEmailHubAttachment(ctx, db.GetEmailHubAttachmentParams{
		ID: attachmentID, ThreadID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubAttachmentView{}, nil, ErrNotFound
		}
		return EmailHubAttachmentView{}, nil, err
	}
	if row.SizeBytes > maxEmailHubAttachmentBytes {
		return EmailHubAttachmentView{}, nil, Invalid("attachment too large")
	}
	password, err := s.openPassword(acc.PasswordEnc)
	if err != nil {
		return EmailHubAttachmentView{}, nil, err
	}
	meta, r, err := imapclient.FetchAttachment(imapclient.Credentials{
		Host: acc.ImapHost, Port: int(acc.ImapPort), Email: acc.EmailAddress, Password: password,
	}, s.mailboxFor(acc, thread.Folder), uint32(thread.ImapUid), row.PartID)
	if err != nil {
		return EmailHubAttachmentView{}, nil, err
	}
	view := attachmentView(row)
	if view.Filename == "" && meta.Filename != "" {
		view.Filename = meta.Filename
	}
	if view.MimeType == "" && meta.MimeType != "" {
		view.MimeType = meta.MimeType
	}
	return view, r, nil
}
