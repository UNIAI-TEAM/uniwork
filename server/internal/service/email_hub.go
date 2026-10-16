package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	ErrEmailHubNotConfigured = errors.New("email hub not configured")
	ErrEmailHubUnsupported   = errors.New("unsupported email provider")
	ErrEmailHubConnectFailed = errors.New("imap connection failed")
	ErrEmailHubSendFailed    = errors.New("smtp send failed")
	// ErrEmailHubReauthRequired: the mailbox's credential was refused; only a
	// reconnect by the owner brings it back.
	ErrEmailHubReauthRequired = errors.New("email hub account needs reconnect")
	ErrEmailHubSMTPDisabled   = errors.New("smtp auth disabled for mailbox")
	// errEmailHubSentNotCached wraps failures after SMTP accepted the mail: the
	// recipient has it, only our Sent copy is missing, so it must not be retried.
	errEmailHubSentNotCached = errors.New("sent but not cached")
)

// EmailHubService syncs IMAP mailboxes for workspace members.
type EmailHubService struct {
	q        *db.Queries
	ws       *WorkspaceService
	box      *secretbox.Box
	store    storage.Storage
	log      *slog.Logger
	gov      *emailHubGovernor
	hubWatch *emailHubHubWatcher

	// refreshLocks holds one *sync.Mutex per account id (refreshLock).
	refreshLocks sync.Map
	// AI and Tasks are wired from main after construction; nil disables summarize → task.
	AI    *ai.Gateway
	Tasks *TaskService
	// oauth holds the sign-in providers ConfigureOAuth enabled; oauthHTTP
	// bounds every token and revoke call. Tests point both at httptest servers.
	oauth     map[string]*emailHubOAuthProvider
	oauthHTTP *http.Client

	// scheduleWorkerOwnerFn, testHookScheduledSend, testHookSMTPSend and
	// testHookAppendSent are set only in tests.
	scheduleWorkerOwnerFn func() string
	testHookScheduledSend func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error
	testHookSMTPSend      func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error)
	testHookAppendSent    func(ctx context.Context, acc db.EmailHubAccount, raw []byte) (uint32, error)
	// testHookVerify replaces the IMAP+SMTP login check and testHookInitialSync
	// the first sync after Connect; both are set only in tests.
	testHookVerify      func(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error
	testHookInitialSync func(ctx context.Context, acc db.EmailHubAccount)
}

func NewEmailHubService(q *db.Queries, ws *WorkspaceService, box *secretbox.Box) *EmailHubService {
	svc := &EmailHubService{
		q: q, ws: ws, box: box, log: slog.Default(), gov: newEmailHubGovernor(),
		oauthHTTP: &http.Client{Timeout: 15 * time.Second},
	}
	svc.hubWatch = newEmailHubHubWatcher(svc)
	return svc
}

func (s *EmailHubService) Enabled() bool {
	return s.box != nil
}

type EmailHubAccountView struct {
	ID               string
	EmailAddress     string
	Provider         string
	ConnectedAt      time.Time
	LastSyncAt       *time.Time
	AuthKind         string
	NeedsReconnect   bool
	AuthFailedReason string
	// Server settings refill the reconnect form; the password never leaves the row.
	ImapHost     string
	ImapPort     int
	ImapSecurity string
	SmtpHost     string
	SmtpPort     int
	SmtpSecurity string
	Username     string
}

type EmailHubThreadView struct {
	ID                       string
	AccountID                string
	Folder                   string
	Subject                  string
	Snippet                  string
	FromAddr                 string
	FromName                 string
	ToAddrs                  []string
	SentAt                   time.Time
	IsRead                   bool
	IsStarred                bool
	HasAttachments           bool
	ImapLabels               []string
	SnoozedUntil             *time.Time
	Attachments              []EmailHubAttachmentView
	BodyText                 string
	BodyHTML                 string
	BodyCached               bool
	ConversationMessageCount int
}

type EmailHubCounts struct {
	Total  int64
	Unread int64
}

func (s *EmailHubService) workspace(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Workspace{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return ws, err
}

func (s *EmailHubService) ListAccounts(ctx context.Context, actor Actor, workspaceID string) ([]EmailHubAccountView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListEmailHubAccountsByUser(ctx, db.ListEmailHubAccountsByUserParams{
		UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]EmailHubAccountView, 0, len(rows))
	for _, r := range rows {
		out = append(out, accountView(r))
	}
	return out, nil
}

func (s *EmailHubService) Disconnect(ctx context.Context, actor Actor, workspaceID, accountID string) error {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	// Only the caller's own live mailbox in this organization is theirs to
	// disconnect. Nothing below may run for any other id: the cleanup deletes
	// a mailbox's cached mail, and the account id is all a caller supplies
	// (ADR 0008 isolation matrix).
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	old, err := qtx.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	disconnected := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if disconnected {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			Actor:          actor,
			Action:         audit.ActionEmailHubAccountDisconnected,
			ResourceType:   "email_hub_account",
			ResourceID:     accountID,
		}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if !disconnected {
		// Either not the caller's mailbox, or theirs and already disconnected.
		// The second case runs the cleanup again: the flip and the deletes
		// are not one transaction, so a cleanup that failed last time must
		// be retryable, and a repeated disconnect must not turn into a 404.
		acc, err := s.q.GetEmailHubAccountByID(ctx, accountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if acc.UserID != actor.ID || acc.OrganizationID != ws.OrganizationID || !acc.DisconnectedAt.Valid {
			return ErrNotFound
		}
	}
	s.hubWatch.forceStop(accountID)
	// old is the zero row on a repeated disconnect: no token is left to revoke.
	s.revokeEmailHubToken(ctx, accountID, old.AuthKind, old.OauthRefreshTokenEnc)
	return cleanUpDisconnectedEmailHubAccount(ctx, s.q, s.store, accountID, ws.OrganizationID)
}

// cleanUpDisconnectedEmailHubAccount cancels a disconnected mailbox's queued
// sends and drops its cached mail, the body objects in store included (nil:
// bodies are inline only). It is safe to run again, and runs after the
// disconnect commits: a large mailbox would hold that transaction's locks.
func cleanUpDisconnectedEmailHubAccount(
	ctx context.Context, q *db.Queries, store storage.Storage, accountID, organizationID string,
) error {
	scope := db.DeleteEmailHubAttachmentsForAccountParams{AccountID: accountID, OrganizationID: organizationID}
	// Only the thread rows know the body keys, so they are read before the rows
	// go; the objects go only after the rows did, so a failed run is found again.
	var keys []string
	if store != nil {
		var err error
		keys, err = q.ListEmailHubBodyObjectKeysForAccount(ctx, db.ListEmailHubBodyObjectKeysForAccountParams(scope))
		if err != nil {
			return err
		}
	}
	if err := errors.Join(
		q.CancelEmailHubScheduledSendsForAccount(ctx, db.CancelEmailHubScheduledSendsForAccountParams(scope)),
		q.DeleteEmailHubAttachmentsForAccount(ctx, scope),
		q.DeleteEmailHubThreadAiSummariesForAccount(ctx, db.DeleteEmailHubThreadAiSummariesForAccountParams(scope)),
		q.DeleteEmailHubThreadsForAccount(ctx, db.DeleteEmailHubThreadsForAccountParams(scope)),
	); err != nil {
		return err
	}
	deleteEmailHubBodyObjects(ctx, store, keys)
	return nil
}

// cleanUpEmailHubAccountsAfterCommit cleans up the mailboxes a lifecycle
// command (leave, account deletion) disconnected, and revokes the refresh
// tokens that command removed when hub is wired (nil: no revoke). That command
// already committed, so a failure is logged rather than returned. Nobody can
// retry it (the caller is gone from the organization), so it outlives the request.
func cleanUpEmailHubAccountsAfterCommit(ctx context.Context, q *db.Queries, hub *EmailHubService, rows []db.DisconnectEmailHubAccountsForUserRow) {
	ctx = context.WithoutCancel(ctx)
	for _, r := range rows {
		if err := cleanUpDisconnectedEmailHubAccount(ctx, q, hub.objectStore(), r.ID, r.OrganizationID); err != nil {
			slog.Warn("email hub cleanup after disconnect failed", "account_id", r.ID, "err", err)
		}
		if hub != nil {
			hub.revokeEmailHubToken(ctx, r.ID, r.AuthKind, r.OauthRefreshTokenEnc)
		}
	}
}

func (s *EmailHubService) GetThread(ctx context.Context, actor Actor, workspaceID, accountID, threadID string, fetchBody, markRead bool) (EmailHubThreadView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	view := threadView(row)
	attachments, err := s.listThreadAttachments(ctx, threadID, accountID, ws.OrganizationID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	view.Attachments = attachments
	// An object-stored body is not hydrated yet and was vetted before upload.
	if view.BodyCached && strings.TrimSpace(row.BodyObjectKey) == "" && shouldInvalidateCachedBody(view) {
		key, invErr := s.q.InvalidateEmailHubThreadBody(ctx, threadID)
		if invErr == nil {
			s.deleteEmailHubBodyObjects(ctx, []string{key})
		}
		view.BodyCached = false
		view.BodyText = ""
		view.BodyHTML = ""
	}
	if markRead {
		view = s.markThreadReadIfNeeded(ctx, acc, row, view)
	}
	if !fetchBody {
		return view, nil
	}
	if view.BodyCached {
		if err := s.hydrateThreadBodyFromObject(ctx, &view, row); err != nil {
			s.log.Warn("email hub hydrate body failed", "thread_id", threadID, "err", err)
		}
		if view.BodyText != "" || view.BodyHTML != "" {
			return view, nil
		}
		if strings.TrimSpace(row.BodyObjectKey) == "" {
			return view, nil
		}
	}
	// needs_reconnect: serve what is cached, never dial (spec §3).
	if !s.Enabled() || acc.AuthFailedAt.Valid {
		return view, nil
	}
	s.gov.beginInteractive(accountID)
	defer s.gov.endInteractive(accountID)
	body, err := s.fetchThreadBodyInteractive(ctx, acc, row)
	if err != nil {
		s.log.Warn("email hub fetch body failed", "thread_id", threadID, "code", emailHubErrCode(err))
		return view, nil
	}
	if imapclient.BodyIsSnippetPlaceholder(body.HTML, body.Text, view.Snippet) {
		s.log.Warn("email hub fetch body placeholder only", "thread_id", threadID)
		return view, nil
	}
	view.BodyText = body.Text
	view.BodyHTML = body.HTML
	view.BodyCached = true
	return view, nil
}

func (s *EmailHubService) markThreadReadIfNeeded(
	ctx context.Context,
	acc db.EmailHubAccount,
	row db.EmailHubThread,
	view EmailHubThreadView,
) EmailHubThreadView {
	if !s.Enabled() {
		return view
	}
	// Opening an inbox conversation reads all of it, not only the row opened.
	rows, err := s.inboxConversationRows(ctx, row)
	if err != nil {
		return view
	}
	for _, r := range rows {
		if r.IsRead {
			continue
		}
		if _, err := s.q.UpdateEmailHubThreadRead(ctx, db.UpdateEmailHubThreadReadParams{
			ID: r.ID, IsRead: true, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
		}); err != nil {
			continue
		}
		if !acc.AuthFailedAt.Valid {
			go s.syncMarkReadOnIMAP(acc, r, r.ID)
		}
		if r.ID == row.ID {
			view.IsRead = true // keep the view's body and attachments as they are
		}
	}
	return view
}

type SendEmailHubInput struct {
	AccountID       string
	To              []string
	Cc              []string
	Bcc             []string
	Subject         string
	BodyText        string
	BodyHTML        string
	Attachments     []SendEmailHubAttachmentInput
	ReplyToThreadID string
}

func (s *EmailHubService) Send(ctx context.Context, actor Actor, workspaceID string, in SendEmailHubInput) (EmailHubThreadView, error) {
	if !s.Enabled() {
		return EmailHubThreadView{}, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: in.AccountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	if err := validateSendInput(in); err != nil {
		return EmailHubThreadView{}, err
	}
	return s.sendOutboundMail(ctx, acc, ws.OrganizationID, in)
}

func (s *EmailHubService) sendOutboundMail(
	ctx context.Context, acc db.EmailHubAccount, organizationID string, in SendEmailHubInput,
) (EmailHubThreadView, error) {
	to := cleanEmailList(in.To)
	subject := strings.TrimSpace(in.Subject)
	body := strings.TrimSpace(in.BodyText)
	bodyHTML := bodyHTMLForSend(body, in.BodyHTML)
	attachments, err := normalizeSendAttachments(in.Attachments)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	var inReplyTo, references, convKey string
	if in.ReplyToThreadID != "" {
		parent, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
			ID: in.ReplyToThreadID, AccountID: in.AccountID, OrganizationID: organizationID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return EmailHubThreadView{}, ErrNotFound
			}
			return EmailHubThreadView{}, err
		}
		inReplyTo, references = replyThreading(parent)
		convKey = strings.TrimSpace(parent.ConversationKey)
		if convKey == "" {
			convKey = emailhub.ConversationKey(acc.ID, parent.Subject, "", inReplyTo, "")
		}
		if subject == "" {
			subject = replySubject(parent.Subject)
		}
	}
	if convKey == "" {
		convKey = emailhub.ConversationKey(acc.ID, subject, "", "", "")
	}
	if subject == "" {
		return EmailHubThreadView{}, Invalid("subject required")
	}
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		// A token endpoint that is down is retryable like an SMTP outage; the code, never the provider's text, travels on.
		if errors.Is(err, errEmailHubOAuthRefreshFailed) || errors.Is(err, errEmailHubOAuthNotConfigured) {
			code := emailHubErrCode(err)
			s.log.Warn("email hub send failed", "account_id", acc.ID, "code", code)
			return EmailHubThreadView{}, fmt.Errorf("%w: %s", ErrEmailHubSendFailed, code)
		}
		return EmailHubThreadView{}, err
	}
	send := smtpclient.Send
	if s.testHookSMTPSend != nil {
		send = s.testHookSMTPSend
	}
	msgID, raw, err := send(ctx, creds.SMTP, smtpclient.Message{
		To: to, Cc: cleanEmailList(in.Cc), Bcc: cleanEmailList(in.Bcc), Subject: subject,
		BodyText: body, BodyHTML: bodyHTML, Attachments: attachments, InReplyTo: inReplyTo, References: references,
	})
	if err != nil {
		code, _ := classifyEmailHubConnectError(err) // the raw reply carries hosts and addresses
		s.log.Warn("email hub send failed", "account_id", acc.ID, "code", code)
		// Classified before wrapping: the handler maps these sentinels, not ErrEmailHubSendFailed.
		switch {
		case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
			return EmailHubThreadView{}, ErrEmailHubSMTPDisabled
		case errors.Is(err, smtpclient.ErrAuthFailed):
			s.handleAuthError(ctx, acc, creds.Version, err)
			return EmailHubThreadView{}, ErrEmailHubReauthRequired
		}
		return EmailHubThreadView{}, fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)
	}
	now := time.Now().UTC()
	// Placeholder until the Sent sync adopts the server's copy by Message-ID.
	uid := int32(now.Unix() & 0x7fffffff)
	if acc.Provider == "custom" && !emailhub.ServerSavesSent(acc.ImapHost) {
		if appended := s.appendSentCopy(ctx, acc, raw, now); appended != 0 {
			uid = int32(appended)
		}
	}
	snippet := imapclient.CleanSnippet(imapclient.SnippetFromBody(body, bodyHTML))
	row, err := s.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: organizationID,
		Folder: emailhub.FolderSent, ImapUid: uid,
		MessageID: pgtype.Text{String: msgID, Valid: true},
		Subject:   subject, Snippet: snippet, FromAddr: acc.EmailAddress,
		ToAddrs: to, SentAt: pgtype.Timestamptz{Time: now, Valid: true},
		IsRead: true, IsStarred: false, HasAttachments: len(attachments) > 0,
		ImapLabels: []string{}, ConversationKey: convKey,
	})
	if err != nil {
		return EmailHubThreadView{}, fmt.Errorf("%w: %w", errEmailHubSentNotCached, err)
	}
	if err := s.persistThreadBody(ctx, acc.ID, organizationID, row.ID, body, bodyHTML); err != nil {
		s.log.Warn("email hub sent body cache failed", "thread_id", row.ID, "err", err)
		return threadView(row), nil
	}
	updated, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: row.ID, AccountID: acc.ID, OrganizationID: organizationID,
	})
	if err != nil {
		return threadView(row), nil
	}
	if len(attachments) > 0 {
		if attachErr := s.replaceOutboundAttachments(ctx, acc, row.ID, attachments); attachErr != nil {
			s.log.Warn("email hub outbound attachments cache failed", "thread_id", row.ID, "err", attachErr)
		}
	}
	view := threadView(updated)
	if len(attachments) > 0 {
		cached, listErr := s.listThreadAttachments(ctx, row.ID, acc.ID, organizationID)
		if listErr == nil {
			view.Attachments = cached
		}
	}
	return view, nil
}

// replyThreading derives In-Reply-To and References for a reply to parent.
// The parent's own References are not stored; its "mid:" key is the root.
func replyThreading(parent db.EmailHubThread) (inReplyTo, references string) {
	if !parent.MessageID.Valid || parent.MessageID.String == "" {
		return "", ""
	}
	root, ok := strings.CutPrefix(parent.ConversationKey, "mid:")
	if !ok {
		root = ""
	}
	return emailhub.NormalizeMessageID(parent.MessageID.String), emailhub.ReferencesHeader(parent.MessageID.String, root)
}

func (s *EmailHubService) MarkThreadRead(ctx context.Context, actor Actor, workspaceID, accountID, threadID string, read bool) (EmailHubThreadView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	if acc.AuthFailedAt.Valid {
		return EmailHubThreadView{}, ErrEmailHubReauthRequired
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	rows, err := s.inboxConversationRows(ctx, row)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	updated := row
	for _, r := range rows {
		if r.IsRead == read && r.ID != threadID {
			continue
		}
		u, err := s.q.UpdateEmailHubThreadRead(ctx, db.UpdateEmailHubThreadReadParams{
			ID: r.ID, IsRead: read, AccountID: accountID, OrganizationID: ws.OrganizationID,
		})
		if err != nil {
			return EmailHubThreadView{}, err
		}
		if r.ID == threadID {
			updated = u
		}
		if s.Enabled() && r.IsRead != read {
			if read {
				go s.syncMarkReadOnIMAP(acc, r, r.ID)
			} else {
				go s.syncMarkUnreadOnIMAP(acc, r, r.ID)
			}
		}
	}
	return threadView(updated), nil
}

func (s *EmailHubService) MarkThreadStarred(
	ctx context.Context, actor Actor, workspaceID, accountID, threadID string, starred bool,
) (EmailHubThreadView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	if acc.AuthFailedAt.Valid {
		return EmailHubThreadView{}, ErrEmailHubReauthRequired
	}
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	updated, err := s.q.UpdateEmailHubThreadStarred(ctx, db.UpdateEmailHubThreadStarredParams{
		ID: threadID, IsStarred: starred, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubThreadView{}, err
	}
	if starred != row.IsStarred && s.Enabled() {
		accCopy := acc
		rowCopy := row
		go s.syncMarkStarredOnIMAP(accCopy, rowCopy, threadID, starred)
	}
	return threadView(updated), nil
}

func (s *EmailHubService) syncMarkUnreadOnIMAP(acc db.EmailHubAccount, row db.EmailHubThread, threadID string) {
	_ = s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPWithMailboxes(context.Background(), acc)
		if err != nil {
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkUnread(mailbox, uint32(row.ImapUid)); imapErr != nil {
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
			return imapErr
		}
		return nil
	})
}

func (s *EmailHubService) syncMarkReadOnIMAP(acc db.EmailHubAccount, row db.EmailHubThread, threadID string) {
	_ = s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPWithMailboxes(context.Background(), acc)
		if err != nil {
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkRead(mailbox, uint32(row.ImapUid)); imapErr != nil {
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
			return imapErr
		}
		return nil
	})
}

func (s *EmailHubService) syncMarkStarredOnIMAP(acc db.EmailHubAccount, row db.EmailHubThread, threadID string, starred bool) {
	_ = s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPWithMailboxes(context.Background(), acc)
		if err != nil {
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "code", emailHubErrCode(err))
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkStarred(mailbox, uint32(row.ImapUid), starred); imapErr != nil {
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "code", emailHubErrCode(imapErr))
			return imapErr
		}
		return nil
	})
}

func (s *EmailHubService) Sync(
	ctx context.Context, actor Actor, workspaceID, accountID, folder string, force, live, reconcile bool,
) (bool, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return false, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, err
	}
	if acc.AuthFailedAt.Valid {
		return false, ErrEmailHubReauthRequired
	}
	folder = normalizeEmailHubFolder(folder)
	beforeUnread := s.inboxUnreadForAccount(ctx, acc)
	var synced bool
	var newUnread int
	var syncErr error
	switch {
	case folder == emailhub.FolderStarred:
		// Virtual folder: IMAP SEARCH \Flagged (and Gmail \Starred), not a mailbox.
		synced, newUnread, syncErr = s.syncStarred(ctx, acc, force)
	case folder == "":
		synced, newUnread, syncErr = s.syncAccount(ctx, acc, reconcile, force)
	default:
		synced, newUnread, syncErr = s.syncSingleFolder(ctx, acc, folder, reconcile, force, live, false)
	}
	if syncErr != nil {
		return false, redactEmailHubMailErr(syncErr)
	}
	if synced {
		s.emitInboxChanged(ctx, acc)
		if newUnread > 0 || s.inboxUnreadForAccount(ctx, acc) > beforeUnread {
			s.emitEmailHubNewMail(ctx, acc, workspaceID)
		}
	}
	return synced, nil
}

func (s *EmailHubService) inboxUnreadForAccount(ctx context.Context, acc db.EmailHubAccount) int64 {
	counts, err := s.q.CountEmailHubThreads(ctx, db.CountEmailHubThreadsParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: emailHubFolderInbox, LabelFilter: "",
	})
	if err != nil {
		return 0
	}
	return counts.Unread
}

// InboxUnreadTotal is the sum of unread INBOX threads across the user's connected mailboxes in the org.
func (s *EmailHubService) InboxUnreadTotal(ctx context.Context, actor Actor, workspaceID string) (int64, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return 0, err
	}
	n, err := s.q.SumEmailHubInboxUnreadByUser(ctx, db.SumEmailHubInboxUnreadByUserParams{
		UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (s *EmailHubService) openPassword(enc string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	plain, err := s.box.Open(raw)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func accountView(r db.EmailHubAccount) EmailHubAccountView {
	return EmailHubAccountView{
		ID: r.ID, EmailAddress: r.EmailAddress, Provider: r.Provider,
		ConnectedAt: r.CreatedAt.Time, LastSyncAt: lastSyncFromState(r.SyncState),
		AuthKind: r.AuthKind, NeedsReconnect: r.AuthFailedAt.Valid, AuthFailedReason: r.AuthFailedReason,
		ImapHost: r.ImapHost, ImapPort: int(r.ImapPort), ImapSecurity: r.ImapSecurity,
		SmtpHost: r.SmtpHost, SmtpPort: int(r.SmtpPort), SmtpSecurity: r.SmtpSecurity,
		Username: r.Username,
	}
}

func shouldInvalidateCachedBody(view EmailHubThreadView) bool {
	if !imapclient.BodyWorthCaching(view.BodyHTML, view.BodyText) {
		return true
	}
	if !imapclient.BodyIsSnippetPlaceholder(view.BodyHTML, view.BodyText, view.Snippet) {
		return false
	}
	// Send() may cache short bodies where body_text equals snippet; IMAP UID is local-only.
	return view.Folder != emailhub.FolderSent
}

func sentMessageHTML(body string) string {
	escaped := html.EscapeString(body)
	escaped = strings.ReplaceAll(escaped, "\r\n", "\n")
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	return "<p>" + escaped + "</p>"
}

func cleanEmailList(addrs []string) []string {
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		a = strings.ToLower(strings.TrimSpace(a))
		if a != "" {
			out = append(out, a)
		}
	}
	return out
}

func replySubject(subject string) string {
	subject = strings.TrimSpace(subject)
	if strings.HasPrefix(strings.ToLower(subject), "re:") {
		return subject
	}
	return "Re: " + subject
}

func threadView(r db.EmailHubThread) EmailHubThreadView {
	v := EmailHubThreadView{
		ID: r.ID, AccountID: r.AccountID, Folder: r.Folder, Subject: r.Subject,
		Snippet:  imapclient.CleanSnippet(r.Snippet),
		FromAddr: r.FromAddr, ToAddrs: r.ToAddrs, SentAt: r.SentAt.Time,
		IsRead: r.IsRead, IsStarred: r.IsStarred, HasAttachments: r.HasAttachments, BodyCached: r.BodyCached,
		ImapLabels: append([]string(nil), r.ImapLabels...),
	}
	if r.SnoozedUntil.Valid {
		t := r.SnoozedUntil.Time
		v.SnoozedUntil = &t
	}
	if r.FromName.Valid {
		v.FromName = r.FromName.String
	}
	if r.BodyText.Valid {
		v.BodyText = r.BodyText.String
	}
	if r.BodyHtml.Valid {
		v.BodyHTML = r.BodyHtml.String
	}
	return v
}
