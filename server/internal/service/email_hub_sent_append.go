package service

import (
	"context"
	"math"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// appendSentCopy files the MIME just sent over SMTP in the server's Sent
// mailbox, for hosts that do not file it themselves (spec §4.5). It returns the
// APPENDUID when the server gives one that fits imap_uid (INTEGER), otherwise 0
// and the caller keeps its placeholder UID. A failure is only logged, by code:
// the recipient already has the mail, so the send never fails and is not retried.
func (s *EmailHubService) appendSentCopy(ctx context.Context, acc db.EmailHubAccount, raw []byte, at time.Time) uint32 {
	var uid uint32
	var err error
	if s.testHookAppendSent != nil {
		uid, err = s.testHookAppendSent(ctx, acc, raw)
	} else {
		err = s.gov.withIMAPCtx(ctx, acc.ID, func() error {
			// An auth refusal here already went through handleAuthError.
			sess, mailboxes, openErr := s.openIMAPWithMailboxes(ctx, acc)
			if openErr != nil {
				return openErr
			}
			defer sess.Close()
			var appendErr error
			uid, appendErr = sess.Append(mailboxes.Resolve(emailhub.FolderSent), []string{`\Seen`}, at, raw)
			return appendErr
		})
	}
	if err != nil {
		s.log.Warn("email hub sent copy append failed", "account_id", acc.ID, "code", emailHubErrCode(err))
		return 0
	}
	if uid > math.MaxInt32 {
		return 0 // the next Sent sync adopts the placeholder row by Message-ID
	}
	return uid
}
