package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func testEmailHubBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

func emailHubFixture(t *testing.T) (*EmailHubService, *db.Queries, db.User, db.Workspace, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	wsSvc := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	user := registerVerified(t, q, as, "eh-user@example.com", "EH User")
	org, err := orgs.Create(ctx, user.ID, "EH Org", "eh-org")
	if err != nil {
		t.Fatal(err)
	}
	v, err := wsSvc.CreateInOrg(ctx, user.ID, org.ID, "EH WS", "eh-ws")
	if err != nil {
		t.Fatal(err)
	}
	svc := NewEmailHubService(q, wsSvc, testEmailHubBox(t))
	return svc, q, user, v.Workspace, pool
}

func seedEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID string) db.EmailHubAccount {
	t.Helper()
	sealed, err := box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: "seed@gmail.com", Provider: "gmail",
		ImapHost: "127.0.0.1", ImapPort: 1,
		SmtpHost: "127.0.0.1", SmtpPort: 1,
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func seedEmailHubThread(t *testing.T, q *db.Queries, accountID, orgID string) db.EmailHubThread {
	t.Helper()
	row, err := q.UpsertEmailHubThread(context.Background(), db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: accountID, OrganizationID: orgID,
		Folder: emailhub.FolderInbox, ImapUid: 42, Subject: "Hello",
		Snippet: "hello", FromAddr: "a@b.co", ToAddrs: []string{"seed@gmail.com"},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ImapLabels: []string{}, ConversationKey: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func TestEmailHubConnectValidation(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)

	_, err := svc.Connect(ctx, actor, ws.ID, ConnectEmailHubInput{})
	if err == nil {
		t.Fatal("expected empty connect to fail")
	}

	_, err = svc.Connect(ctx, actor, ws.ID, ConnectEmailHubInput{
		EmailAddress: "user@unknown.example", AppPassword: "secret",
	})
	if !errors.Is(err, ErrEmailHubUnsupported) {
		t.Fatalf("expected unsupported provider, got %v", err)
	}
}

func TestEmailHubListAndThreadLifecycle(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	accounts, err := svc.ListAccounts(ctx, actor, ws.ID)
	if err != nil || len(accounts) != 1 || accounts[0].EmailAddress != acc.EmailAddress {
		t.Fatalf("list accounts: %v len=%d", err, len(accounts))
	}

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 0 || page.Counts.Total != 0 {
		t.Fatalf("empty threads: err=%v page=%+v", err, page)
	}

	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	page, err = svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 || page.Counts.Total != 1 {
		t.Fatalf("listed thread: err=%v page=%+v", err, page)
	}

	read, err := svc.MarkThreadRead(ctx, actor, ws.ID, acc.ID, thread.ID, true)
	if err != nil || !read.IsRead {
		t.Fatalf("mark read: %+v err=%v", read, err)
	}

	starred, err := svc.MarkThreadStarred(ctx, actor, ws.ID, acc.ID, thread.ID, true)
	if err != nil || !starred.IsStarred {
		t.Fatalf("mark starred: %+v err=%v", starred, err)
	}

	got, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, thread.ID, false, false)
	if err != nil || got.ID != thread.ID {
		t.Fatalf("get thread: %+v err=%v", got, err)
	}

	if err := svc.Disconnect(ctx, actor, ws.ID, acc.ID); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	accounts, err = svc.ListAccounts(ctx, actor, ws.ID)
	if err != nil || len(accounts) != 0 {
		t.Fatalf("accounts after disconnect: %v len=%d", err, len(accounts))
	}
}

func TestEmailHubWatchSubscribe(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	if err := svc.SubscribeInboxWatch(ctx, actor, ws.ID, acc.ID); err != nil {
		t.Fatalf("subscribe watch: %v", err)
	}
	if err := svc.UnsubscribeInboxWatch(ctx, actor, ws.ID, acc.ID); err != nil {
		t.Fatalf("unsubscribe watch: %v", err)
	}
}

func TestEmailHubUpsertThreadItems(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	err := svc.upsertThreadItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{
		{
			UID: 11, Subject: "Invoice", Snippet: "please pay", FromAddr: "billing@example.com",
			ToAddrs: []string{acc.EmailAddress}, SentAt: time.Now().UTC(), HasAttachments: true,
			Attachments: []imapclient.AttachmentMeta{
				{Filename: "invoice.pdf", MimeType: "application/pdf", Size: 42, PartID: "1"},
			},
			BodyText: "Body text",
		},
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	page, err := svc.ListThreads(ctx, Human(user.ID), ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50, HasAttachmentsOnly: true,
	})
	if err != nil || len(page.Threads) != 1 || !page.Threads[0].HasAttachments {
		t.Fatalf("listed attachment thread: err=%v page=%+v", err, page)
	}
	// ListThreads does not hydrate attachment rows; detail does.
	got, err := svc.GetThread(ctx, Human(user.ID), ws.ID, acc.ID, page.Threads[0].ID, false, false)
	if err != nil || len(got.Attachments) != 1 || got.Attachments[0].Filename != "invoice.pdf" {
		t.Fatalf("thread attachments: err=%v got=%+v", err, got.Attachments)
	}
}

func TestEmailHubSyncErrorsWithoutIMAP(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	synced, err := svc.Sync(ctx, actor, ws.ID, acc.ID, emailhub.FolderInbox, true, false, false)
	if err == nil {
		t.Fatal("expected sync error without reachable IMAP")
	}
	if synced {
		t.Fatal("expected synced false when IMAP dial fails")
	}
}

func TestEmailHubSyncAllFoldersWithoutIMAP(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	synced, err := svc.Sync(ctx, actor, ws.ID, acc.ID, emailhub.FolderStarred, true, false, false)
	if err == nil {
		t.Fatal("expected full sync error without reachable IMAP")
	}
	if synced {
		t.Fatal("expected synced false when IMAP dial fails")
	}
}

func TestEmailHubDisconnectRemovesData(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if _, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Filename: "doc.pdf", MimeType: "application/pdf", SizeBytes: 12, PartID: "1",
	}); err != nil {
		t.Fatal(err)
	}

	if err := svc.Disconnect(ctx, actor, ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	accounts, err := svc.ListAccounts(ctx, actor, ws.ID)
	if err != nil || len(accounts) != 0 {
		t.Fatalf("expected no accounts after disconnect: err=%v len=%d", err, len(accounts))
	}
}

func TestEmailHubGetThreadFetchBodyWithoutIMAP(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	view, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, thread.ID, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if view.BodyCached {
		t.Fatalf("expected body fetch to fail gracefully without IMAP: %+v", view)
	}
}

func TestEmailHubGetSentThreadShortBodyCached(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	row, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderSent, ImapUid: 99, Subject: "hehe",
		Snippet: "hehe", FromAddr: acc.EmailAddress, ToAddrs: []string{"dest@example.com"},
		SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}, IsRead: true,
		ImapLabels: []string{}, ConversationKey: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID: row.ID, BodyText: pgtype.Text{String: "hehe", Valid: true},
		BodyHtml: pgtype.Text{String: sentMessageHTML("hehe"), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	view, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, row.ID, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if !view.BodyCached || view.BodyText != "hehe" || view.BodyHTML == "" {
		t.Fatalf("expected cached sent body to load without IMAP: %+v", view)
	}
}

func TestEmailHubListWithQuery(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50, Query: "Hello",
	})
	if err != nil || len(page.Threads) != 1 {
		t.Fatalf("query list: err=%v len=%d", err, len(page.Threads))
	}
}

func TestEmailHubSendValidation(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	_, err := svc.Send(ctx, actor, ws.ID, SendEmailHubInput{AccountID: acc.ID})
	if err == nil {
		t.Fatal("expected validation error for empty send")
	}

	_, err = svc.Send(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, BodyText: "hello",
	})
	if err == nil {
		t.Fatal("expected subject required")
	}
}

func TestEmailHubSendFailsWithoutSMTP(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	_, err := svc.Send(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Hello",
	})
	if !errors.Is(err, ErrEmailHubSendFailed) {
		t.Fatalf("expected send failed, got %v", err)
	}
}

func TestEmailHubGetThreadMarksRead(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	view, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, thread.ID, false, true)
	if err != nil || !view.IsRead {
		t.Fatalf("mark read on get: err=%v is_read=%v", err, view.IsRead)
	}
}

func TestEmailHubOpenAttachmentNotFound(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	_, _, err := svc.OpenAttachment(ctx, actor, ws.ID, acc.ID, thread.ID, "missing-att")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
}

func TestEmailHubListUnreadOnly(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50, UnreadOnly: true,
	})
	if err != nil || len(page.Threads) != 1 {
		t.Fatalf("unread list: err=%v len=%d", err, len(page.Threads))
	}
}

func TestEmailHubStarredFolderListing(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if _, err := svc.MarkThreadStarred(ctx, actor, ws.ID, acc.ID, thread.ID, true); err != nil {
		t.Fatal(err)
	}

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderStarred, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 || page.Counts.Total != 1 {
		t.Fatalf("starred folder: err=%v page=%+v", err, page)
	}
}

func TestEmailHubConversationMessages(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	convKey := "subj:" + acc.ID + ":chức năng"

	inbox, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: 50, Subject: "chức năng",
		Snippet: "hay làm", FromAddr: "longthldz@gmail.com", ToAddrs: []string{acc.EmailAddress},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Hour), Valid: true},
		ImapLabels: []string{}, ConversationKey: convKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	sent, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderSent, ImapUid: 51, Subject: "Re: chức năng",
		Snippet: "oke", FromAddr: acc.EmailAddress, ToAddrs: []string{"longthldz@gmail.com"},
		SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}, IsRead: true,
		ImapLabels: []string{}, ConversationKey: convKey,
	})
	if err != nil {
		t.Fatal(err)
	}

	msgs, err := svc.ListConversationMessages(ctx, actor, ws.ID, acc.ID, inbox.ID)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("conversation: err=%v len=%d", err, len(msgs))
	}
	if msgs[0].ID != inbox.ID || msgs[1].ID != sent.ID {
		t.Fatalf("order: %+v", msgs)
	}
}

func TestEmailHubInboxConversationList(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	convKey := "subj:" + acc.ID + ":demo"

	_, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: 60, Subject: "demo",
		Snippet: "first", FromAddr: "a@b.co", ToAddrs: []string{acc.EmailAddress},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Hour), Valid: true},
		ImapLabels: []string{}, ConversationKey: convKey,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderSent, ImapUid: 61, Subject: "Re: demo",
		Snippet: "reply", FromAddr: acc.EmailAddress, ToAddrs: []string{"a@b.co"},
		SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}, IsRead: true,
		ImapLabels: []string{}, ConversationKey: convKey,
	})
	if err != nil {
		t.Fatal(err)
	}

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 {
		t.Fatalf("inbox list: err=%v len=%d", err, len(page.Threads))
	}
	if page.Threads[0].Folder != emailhub.FolderSent || page.Threads[0].Snippet != "reply" {
		t.Fatalf("expected latest sent in inbox row: %+v", page.Threads[0])
	}
	if page.Threads[0].ConversationMessageCount != 2 {
		t.Fatalf("count: %+v", page.Threads[0])
	}
}

func TestEmailHubScheduledSendLifecycle(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	_, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{AccountID: acc.ID}, time.Now().UTC().Add(time.Minute))
	if err == nil {
		t.Fatal("expected validation error for empty schedule")
	}
	_, err = svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hi",
	}, time.Now().UTC().Add(10*time.Second))
	if err == nil {
		t.Fatal("expected schedule too soon error")
	}

	sendAt := time.Now().UTC().Add(2 * time.Minute)
	created, err := svc.ScheduleSend(ctx, actor, ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hi",
	}, sendAt)
	if err != nil {
		t.Fatal(err)
	}

	list, err := svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID)
	if err != nil || len(list) != 1 || list[0].ID != created.ID || list[0].Subject != "Later" {
		t.Fatalf("list scheduled: err=%v list=%+v created=%+v", err, list, created)
	}
	if err := svc.CancelScheduledSend(ctx, actor, ws.ID, acc.ID, created.ID); err != nil {
		t.Fatal(err)
	}
	list, err = svc.ListScheduledSends(ctx, actor, ws.ID, acc.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("expected empty after cancel: err=%v list=%+v", err, list)
	}
}
