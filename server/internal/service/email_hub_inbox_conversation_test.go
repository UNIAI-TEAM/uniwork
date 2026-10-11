package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedInboxConversation caches two unread INBOX messages and a newer SENT reply
// in one conversation (UNI-1124).
func seedInboxConversation(t *testing.T, q *db.Queries, acc db.EmailHubAccount) (a1, a2, sent db.EmailHubThread) {
	t.Helper()
	key := "mid:<root@x>"
	now := time.Now().UTC()
	seed := func(folder string, uid int32, at time.Time, read bool) db.EmailHubThread {
		row, err := q.UpsertEmailHubThread(context.Background(), db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			Folder: folder, ImapUid: uid, Subject: "Hi", Snippet: folder, FromAddr: "a@b.co",
			ToAddrs: []string{acc.EmailAddress}, SentAt: pgtype.Timestamptz{Time: at, Valid: true},
			IsRead: read, ImapLabels: []string{}, ConversationKey: key,
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	return seed(emailhub.FolderInbox, 70, now.Add(-2*time.Hour), false),
		seed(emailhub.FolderInbox, 71, now.Add(-time.Hour), false),
		seed(emailhub.FolderSent, 72, now, true)
}

func TestEmailHubInboxConversationTargetsInboxMessages(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	a1, a2, sent := seedInboxConversation(t, q, acc)

	page, err := svc.ListThreads(ctx, Human(user.ID), ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 || page.Threads[0].ID != a2.ID {
		t.Fatalf("inbox row must be the newest inbox message: err=%v page=%+v", err, page.Threads)
	}

	// Archive/trash from the inbox row moves every inbox message, never the reply.
	rows, err := svc.inboxConversationRows(ctx, a2)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, r := range rows {
		got[r.ID] = true
	}
	if len(rows) != 2 || !got[a1.ID] || !got[a2.ID] || got[sent.ID] {
		t.Fatalf("move targets: %+v", rows)
	}
	// Outside the inbox a row stands only for itself.
	if rows, err := svc.inboxConversationRows(ctx, sent); err != nil || len(rows) != 1 || rows[0].ID != sent.ID {
		t.Fatalf("sent targets: err=%v rows=%+v", err, rows)
	}
}

func TestEmailHubInboxConversationMarkReadCoversEveryMessage(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	a1, a2, _ := seedInboxConversation(t, q, acc)

	if _, err := svc.MarkThreadRead(ctx, Human(user.ID), ws.ID, acc.ID, a2.ID, true); err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListThreads(ctx, Human(user.ID), ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 || !page.Threads[0].IsRead || page.Counts.Unread != 0 {
		t.Fatalf("conversation still unread: err=%v page=%+v", err, page)
	}
	if row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: a1.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	}); err != nil || !row.IsRead {
		t.Fatalf("older inbox message unread: err=%v", err)
	}
}

func TestEmailHubInboxConversationOpenMarksEveryMessageRead(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	a1, a2, _ := seedInboxConversation(t, q, acc)

	if _, err := svc.GetThread(ctx, Human(user.ID), ws.ID, acc.ID, a2.ID, false, true); err != nil {
		t.Fatal(err)
	}
	if row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: a1.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	}); err != nil || !row.IsRead {
		t.Fatalf("opening the conversation left a message unread: err=%v", err)
	}
}

func TestEmailHubInboxConversationSnoozeHidesTheWholeConversation(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	_, a2, sent := seedInboxConversation(t, q, acc)

	until := time.Now().UTC().Add(time.Hour)
	if _, err := svc.SetThreadSnooze(ctx, Human(user.ID), ws.ID, acc.ID, a2.ID, &until); err != nil {
		t.Fatal(err)
	}
	page, err := svc.ListThreads(ctx, Human(user.ID), ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 0 {
		t.Fatalf("snoozed conversation still in inbox: err=%v page=%+v", err, page.Threads)
	}
	if row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: sent.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	}); err != nil || row.SnoozedUntil.Valid {
		t.Fatalf("the sent reply must not be snoozed: err=%v", err)
	}
}

// Marking read must not replace a body the caller already fetched from IMAP.
func TestEmailHubMarkReadKeepsTheFetchedBody(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	a1, _, _ := seedInboxConversation(t, q, acc)

	view := threadView(a1)
	view.BodyText = "fetched"
	got := svc.markThreadReadIfNeeded(ctx, acc, a1, view)
	if !got.IsRead || got.BodyText != "fetched" {
		t.Fatalf("view after mark read: read=%v body=%q", got.IsRead, got.BodyText)
	}
}
