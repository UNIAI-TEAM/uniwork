package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	ErrEmailHubNotConfigured = errors.New("email hub not configured")
	ErrEmailHubUnsupported   = errors.New("unsupported email provider")
	ErrEmailHubConnectFailed = errors.New("imap connection failed")
	ErrEmailHubSendFailed    = errors.New("smtp send failed")
)

// EmailHubService syncs IMAP mailboxes for workspace members.
type EmailHubService struct {
	q        *db.Queries
	ws       *WorkspaceService
	box      *secretbox.Box
	log      *slog.Logger
	gov      *emailHubGovernor
	hubWatch *emailHubHubWatcher
	// AI and Tasks are wired from main after construction; nil disables summarize → task.
	AI    *ai.Gateway
	Tasks *TaskService
}

func NewEmailHubService(q *db.Queries, ws *WorkspaceService, box *secretbox.Box) *EmailHubService {
	svc := &EmailHubService{q: q, ws: ws, box: box, log: slog.Default(), gov: newEmailHubGovernor()}
	svc.hubWatch = newEmailHubHubWatcher(svc)
	return svc
}

func (s *EmailHubService) Enabled() bool {
	return s.box != nil
}

type EmailHubAccountView struct {
	ID           string
	EmailAddress string
	Provider     string
	ConnectedAt  time.Time
	LastSyncAt   *time.Time
}

type EmailHubThreadView struct {
	ID             string
	AccountID      string
	Folder         string
	Subject        string
	Snippet        string
	FromAddr       string
	FromName       string
	ToAddrs        []string
	SentAt         time.Time
	IsRead         bool
	IsStarred      bool
	HasAttachments bool
	ImapLabels     []string
	SnoozedUntil   *time.Time
	Attachments    []EmailHubAttachmentView
	BodyText       string
	BodyHTML       string
	BodyCached     bool
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

type ConnectEmailHubInput struct {
	EmailAddress string
	AppPassword  string
}

func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error) {
	if !s.Enabled() {
		return EmailHubAccountView{}, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	email := strings.ToLower(strings.TrimSpace(in.EmailAddress))
	password := strings.TrimSpace(in.AppPassword)
	if email == "" || password == "" {
		return EmailHubAccountView{}, Invalid("email and app password required")
	}
	prov, ok := emailhub.ProviderForEmail(email)
	if !ok {
		return EmailHubAccountView{}, ErrEmailHubUnsupported
	}
	creds := imapclient.Credentials{
		Host: prov.IMAPHost, Port: prov.IMAPPort, Email: email, Password: password,
	}
	if err := imapclient.VerifyLogin(creds); err != nil {
		s.log.Warn("email hub connect failed", "provider", prov.Name, "user_id", actor.ID, "err", err)
		return EmailHubAccountView{}, fmt.Errorf("%w: %v", ErrEmailHubConnectFailed, err)
	}
	if err := smtpclient.VerifyLogin(smtpclient.Credentials{
		Host: prov.SMTPHost, Port: prov.SMTPPort, Email: email, Password: password,
	}); err != nil {
		s.log.Warn("email hub smtp verify failed", "provider", prov.Name, "user_id", actor.ID, "err", err)
		return EmailHubAccountView{}, fmt.Errorf("%w: %v", ErrEmailHubConnectFailed, err)
	}
	existing, err := s.q.ListEmailHubAccountsByUser(ctx, db.ListEmailHubAccountsByUserParams{
		UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubAccountView{}, err
	}
	for _, row := range existing {
		if row.EmailAddress == email {
			return EmailHubAccountView{}, Invalid("this email is already connected")
		}
	}
	sealed, err := s.box.Seal([]byte(password))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	id := util.NewID()
	row, err := s.q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: id, UserID: actor.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: email, Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort),
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort),
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		return EmailHubAccountView{}, err
	}
	if _, _, syncErr := s.syncAccount(ctx, row, false, true); syncErr != nil {
		s.log.Warn("email hub initial sync failed", "account_id", id, "err", syncErr)
	}
	updated, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: id, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return accountView(row), nil
	}
	return accountView(updated), nil
}

func (s *EmailHubService) Disconnect(ctx context.Context, actor Actor, workspaceID, accountID string) error {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if err := s.q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	}); err != nil {
		return err
	}
	s.hubWatch.forceStop(accountID)
	_ = s.q.DeleteEmailHubAttachmentsForAccount(ctx, accountID)
	_ = s.q.DeleteEmailHubThreadAiSummariesForAccount(ctx, accountID)
	return s.q.DeleteEmailHubThreadsForAccount(ctx, accountID)
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
	if view.BodyCached && shouldInvalidateCachedBody(view) {
		_ = s.q.InvalidateEmailHubThreadBody(ctx, threadID)
		view.BodyCached = false
		view.BodyText = ""
		view.BodyHTML = ""
	}
	if markRead {
		view = s.markThreadReadIfNeeded(ctx, acc, row, view, attachments)
	}
	if !fetchBody || view.BodyCached {
		return view, nil
	}
	if !s.Enabled() {
		return view, nil
	}
	s.gov.beginInteractive(accountID)
	defer s.gov.endInteractive(accountID)
	body, err := s.fetchThreadBodyInteractive(ctx, acc, row)
	if err != nil {
		s.log.Warn("email hub fetch body failed", "thread_id", threadID, "err", err)
		return view, nil
	}
	if imapclient.BodyIsSnippetPlaceholder(body.HTML, body.Text, view.Snippet) {
		s.log.Warn("email hub fetch body placeholder only", "thread_id", threadID)
		return view, nil
	}
	view.BodyText = body.Text
	view.BodyHTML = body.HTML
	view.BodyCached = true
	if markRead {
		view = s.markThreadReadIfNeeded(ctx, acc, row, view, attachments)
	}
	return view, nil
}

func (s *EmailHubService) markThreadReadIfNeeded(
	ctx context.Context,
	acc db.EmailHubAccount,
	row db.EmailHubThread,
	view EmailHubThreadView,
	attachments []EmailHubAttachmentView,
) EmailHubThreadView {
	if view.IsRead || !s.Enabled() {
		return view
	}
	updated, err := s.q.UpdateEmailHubThreadRead(ctx, db.UpdateEmailHubThreadReadParams{
		ID: row.ID, IsRead: true, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	})
	if err != nil {
		return view
	}
	view = threadView(updated)
	view.Attachments = attachments
	go s.syncMarkReadOnIMAP(acc, row, row.ID)
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
	var inReplyTo, references string
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
		if parent.MessageID.Valid && parent.MessageID.String != "" {
			inReplyTo = parent.MessageID.String
			references = parent.MessageID.String
		}
		if subject == "" {
			subject = replySubject(parent.Subject)
		}
	}
	if subject == "" {
		return EmailHubThreadView{}, Invalid("subject required")
	}
	password, err := s.openPassword(acc.PasswordEnc)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	msgID, err := smtpclient.Send(ctx, smtpclient.Credentials{
		Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress, Password: password,
	}, smtpclient.Message{
		To: to, Cc: cleanEmailList(in.Cc), Bcc: cleanEmailList(in.Bcc), Subject: subject,
		BodyText: body, BodyHTML: bodyHTML, Attachments: attachments, InReplyTo: inReplyTo, References: references,
	})
	if err != nil {
		s.log.Warn("email hub send failed", "account_id", acc.ID, "err", err)
		return EmailHubThreadView{}, fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)
	}
	now := time.Now().UTC()
	snippet := imapclient.CleanSnippet(imapclient.SnippetFromBody(body, bodyHTML))
	row, err := s.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: organizationID,
		Folder: emailhub.FolderSent, ImapUid: int32(now.Unix() & 0x7fffffff),
		MessageID: pgtype.Text{String: msgID, Valid: true},
		Subject:   subject, Snippet: snippet, FromAddr: acc.EmailAddress,
		ToAddrs: to, SentAt: pgtype.Timestamptz{Time: now, Valid: true},
		IsRead: true, IsStarred: false, HasAttachments: len(attachments) > 0, ImapLabels: []string{},
	})
	if err != nil {
		return EmailHubThreadView{}, err
	}
	updated, err := s.q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID: row.ID, BodyText: pgtype.Text{String: body, Valid: true},
		BodyHtml: pgtype.Text{String: bodyHTML, Valid: true},
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
	row, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: threadID, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EmailHubThreadView{}, ErrNotFound
		}
		return EmailHubThreadView{}, err
	}
	updated, err := s.q.UpdateEmailHubThreadRead(ctx, db.UpdateEmailHubThreadReadParams{
		ID: threadID, IsRead: read, AccountID: accountID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return EmailHubThreadView{}, err
	}
	if s.Enabled() {
		accCopy := acc
		rowCopy := row
		switch {
		case read && !row.IsRead:
			go s.syncMarkReadOnIMAP(accCopy, rowCopy, threadID)
		case !read && row.IsRead:
			go s.syncMarkUnreadOnIMAP(accCopy, rowCopy, threadID)
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
		sess, mailboxes, err := s.openIMAPWithMailboxes(acc)
		if err != nil {
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "err", err)
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkUnread(mailbox, uint32(row.ImapUid)); imapErr != nil {
			s.log.Warn("email hub mark unread imap failed", "thread_id", threadID, "err", imapErr)
			return imapErr
		}
		return nil
	})
}

func (s *EmailHubService) syncMarkReadOnIMAP(acc db.EmailHubAccount, row db.EmailHubThread, threadID string) {
	_ = s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPWithMailboxes(acc)
		if err != nil {
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "err", err)
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkRead(mailbox, uint32(row.ImapUid)); imapErr != nil {
			s.log.Warn("email hub mark read imap failed", "thread_id", threadID, "err", imapErr)
			return imapErr
		}
		return nil
	})
}

func (s *EmailHubService) syncMarkStarredOnIMAP(acc db.EmailHubAccount, row db.EmailHubThread, threadID string, starred bool) {
	_ = s.gov.withIMAP(acc.ID, func() error {
		sess, mailboxes, err := s.openIMAPWithMailboxes(acc)
		if err != nil {
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "err", err)
			return err
		}
		defer sess.Close()
		mailbox := mailboxes.Resolve(row.Folder)
		if imapErr := sess.MarkStarred(mailbox, uint32(row.ImapUid), starred); imapErr != nil {
			s.log.Warn("email hub mark starred imap failed", "thread_id", threadID, "err", imapErr)
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
	folder = normalizeEmailHubFolder(folder)
	beforeUnread := s.inboxUnreadForAccount(ctx, acc)
	var synced bool
	var newUnread int
	var syncErr error
	if folder == "" || folder == emailhub.FolderStarred {
		synced, newUnread, syncErr = s.syncAccount(ctx, acc, reconcile, force)
	} else {
		synced, newUnread, syncErr = s.syncSingleFolder(ctx, acc, folder, reconcile, force, live, false)
	}
	if syncErr != nil {
		return false, syncErr
	}
	if synced {
		s.emitInboxChanged(ctx, acc)
		afterUnread := s.inboxUnreadForAccount(ctx, acc)
		if newUnread > 0 || afterUnread > beforeUnread {
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
	repaired := imapclient.RepairThreadBodyContent(v.BodyText, v.BodyHTML)
	v.BodyText = repaired.Text
	v.BodyHTML = repaired.HTML
	return v
}
