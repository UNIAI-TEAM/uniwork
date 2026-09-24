package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	ErrEmailHubBodyNotUsable          = errors.New("email hub: body not usable")
	ErrEmailHubBodySnippetPlaceholder = errors.New("email hub: body is snippet placeholder")
)

const (
	emailHubPrefetchBodyBatch          = 20
	emailHubPrefetchChunkSize          = 3 // release IMAP lock between chunks so opens stay fast
	emailHubPrefetchMaxDuration        = 3 * time.Minute
	emailHubPrefetchFailureBackoff     = 5 * time.Minute
	emailHubPrefetchPlaceholderBackoff = 30 * time.Minute
)

func (s *EmailHubService) cacheThreadBodyIMAP(
	ctx context.Context,
	row db.EmailHubThread,
	sess *imapclient.Session,
	mailboxes imapclient.MailboxMap,
) (imapclient.ThreadBody, error) {
	mailbox := mailboxes.Resolve(row.Folder)
	body, err := sess.FetchBody(mailbox, uint32(row.ImapUid))
	if err != nil {
		return imapclient.ThreadBody{}, err
	}
	body.Text = imapclient.SanitizeUTF8(body.Text)
	body.HTML = imapclient.SanitizeUTF8(body.HTML)
	if !imapclient.BodyWorthCaching(body.HTML, body.Text) {
		return imapclient.ThreadBody{}, ErrEmailHubBodyNotUsable
	}
	if imapclient.BodyIsSnippetPlaceholder(body.HTML, body.Text, row.Snippet) {
		return imapclient.ThreadBody{}, ErrEmailHubBodySnippetPlaceholder
	}
	s.gov.clearBodyPrefetchDefer(row.ID)
	_, err = s.q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID: row.ID, BodyText: pgtype.Text{String: body.Text, Valid: body.Text != ""},
		BodyHtml: pgtype.Text{String: body.HTML, Valid: body.HTML != ""},
	})
	if err != nil {
		return imapclient.ThreadBody{}, err
	}
	s.invalidateEmailHubThreadAiSummaries(ctx, row.ID)
	if snip := imapclient.CleanSnippet(imapclient.SnippetFromBody(body.Text, body.HTML)); snip != "" {
		_ = s.q.PatchEmailHubThreadSnippet(ctx, db.PatchEmailHubThreadSnippetParams{
			ID: row.ID, Snippet: snip,
		})
	}
	return body, nil
}

func (s *EmailHubService) maybeCacheBodyFromSync(ctx context.Context, row db.EmailHubThread, body imapclient.ThreadBody) {
	if !imapclient.BodyWorthCaching(body.HTML, body.Text) {
		return
	}
	text := imapclient.SanitizeUTF8(body.Text)
	html := imapclient.SanitizeUTF8(body.HTML)
	if row.BodyCached {
		existingHTML := pgTextString(row.BodyHtml)
		existingText := pgTextString(row.BodyText)
		if !imapclient.BodyNeedsRefetch(existingHTML, existingText) {
			return
		}
		if imapclient.BodyNeedsRefetch(html, text) {
			return
		}
	}
	if _, err := s.q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID: row.ID, BodyText: pgtype.Text{String: text, Valid: text != ""},
		BodyHtml: pgtype.Text{String: html, Valid: html != ""},
	}); err != nil {
		s.log.Warn("email hub sync body cache failed", "thread_id", row.ID, "err", err)
		return
	}
	if snip := imapclient.CleanSnippet(imapclient.SnippetFromBody(text, html)); snip != "" && snip != row.Snippet {
		_ = s.q.PatchEmailHubThreadSnippet(ctx, db.PatchEmailHubThreadSnippetParams{
			ID: row.ID, Snippet: snip,
		})
	}
}

func pgTextString(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func (s *EmailHubService) scheduleBodyPrefetch(acc db.EmailHubAccount, folder string) {
	if !s.Enabled() || s.gov.interactiveActive(acc.ID) {
		return
	}
	if !s.gov.tryBeginBodyPrefetch(acc.ID, folder) {
		return
	}
	go func() {
		defer s.gov.endBodyPrefetch(acc.ID, folder)
		ctx, cancel := context.WithTimeout(context.Background(), emailHubPrefetchMaxDuration)
		defer cancel()
		for ctx.Err() == nil {
			n := s.prefetchUncachedBodies(ctx, acc, folder, emailHubPrefetchBodyBatch)
			if n == 0 {
				return
			}
		}
	}()
}

func (s *EmailHubService) prefetchUncachedBodies(ctx context.Context, acc db.EmailHubAccount, folder string, limit int32) int {
	rows, err := s.q.ListEmailHubThreadsPendingBody(ctx, db.ListEmailHubThreadsPendingBodyParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: folder, Limit: limit,
	})
	if err != nil {
		s.log.Warn("email hub prefetch list failed", "account_id", acc.ID, "err", err)
		return 0
	}
	if len(rows) == 0 {
		return 0
	}
	eligible := make([]db.EmailHubThread, 0, len(rows))
	for _, row := range rows {
		if s.gov.bodyPrefetchDeferred(row.ID) {
			continue
		}
		eligible = append(eligible, row)
	}
	if len(eligible) == 0 {
		return 0
	}
	chunk := eligible
	if int32(len(chunk)) > emailHubPrefetchChunkSize {
		chunk = chunk[:emailHubPrefetchChunkSize]
	}
	cached := 0
	if !s.gov.tryWithIMAP(acc.ID, func() error {
		sess, mailboxes, openErr := s.openIMAPWithMailboxes(acc)
		if openErr != nil {
			s.log.Warn("email hub prefetch imap failed", "account_id", acc.ID, "err", openErr)
			return openErr
		}
		defer sess.Close()
		for _, row := range chunk {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if _, cacheErr := s.cacheThreadBodyIMAP(ctx, row, sess, mailboxes); cacheErr != nil {
				s.recordBodyPrefetchFailure(row.ID, cacheErr)
				continue
			}
			cached++
		}
		return nil
	}) {
		return 0
	}
	if cached == 0 {
		return 0
	}
	return cached
}

func (s *EmailHubService) recordBodyPrefetchFailure(threadID string, err error) {
	switch {
	case errors.Is(err, ErrEmailHubBodySnippetPlaceholder), errors.Is(err, ErrEmailHubBodyNotUsable):
		s.gov.deferBodyPrefetch(threadID, emailHubPrefetchPlaceholderBackoff)
		s.log.Debug("email hub prefetch body deferred", "thread_id", threadID, "err", err)
	default:
		s.gov.deferBodyPrefetch(threadID, emailHubPrefetchFailureBackoff)
		s.log.Warn("email hub prefetch body failed", "thread_id", threadID, "err", err)
	}
}

// fetchThreadBodyInteractive loads body on user open on a dedicated IMAP connection so
// background sync/prefetch cannot block the HTTP request.
func (s *EmailHubService) fetchThreadBodyInteractive(
	ctx context.Context, acc db.EmailHubAccount, row db.EmailHubThread,
) (imapclient.ThreadBody, error) {
	ctx, cancel := context.WithTimeout(ctx, imapclient.InteractiveTimeout())
	defer cancel()
	sess, mailboxes, err := s.openIMAPInteractive(acc)
	if err != nil {
		return imapclient.ThreadBody{}, err
	}
	defer sess.Close()
	return s.cacheThreadBodyIMAP(ctx, row, sess, mailboxes)
}
