package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

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

func emailHubFixture(t *testing.T) (*EmailHubService, *db.Queries, db.User, db.Workspace) {
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
	return svc, q, user, v.Workspace
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
		SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func TestEmailHubConnectValidation(t *testing.T) {
	svc, _, user, ws := emailHubFixture(t)
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
	svc, q, user, ws := emailHubFixture(t)
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
	svc, q, user, ws := emailHubFixture(t)
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
	svc, q, user, ws := emailHubFixture(t)
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
	svc, q, user, ws := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	synced, err := svc.Sync(ctx, actor, ws.ID, acc.ID, emailhub.FolderInbox, true, false)
	if err == nil {
		t.Fatal("expected sync error without reachable IMAP")
	}
	if synced {
		t.Fatal("expected synced false when IMAP dial fails")
	}
}

func TestEmailHubListWithQuery(t *testing.T) {
	svc, q, user, ws := emailHubFixture(t)
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

func TestEmailHubStarredFolderListing(t *testing.T) {
	svc, q, user, ws := emailHubFixture(t)
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
