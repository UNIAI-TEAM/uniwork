package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/bodystore"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/retention"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const emailHubObjectBodyText = "Full body with contract HD-7781 for the October quote, signed by both parties."

// seedObjectBodyThread caches a body on the object store (S3 mode must be on).
func seedObjectBodyThread(
	t *testing.T, svc *EmailHubService, q *db.Queries, acc db.EmailHubAccount, uid int32, sentAt time.Time,
) db.EmailHubThread {
	t.Helper()
	ctx := context.Background()
	row, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: uid, Subject: "Quote", Snippet: "Quote",
		FromAddr: "a@b.co", ToAddrs: []string{acc.EmailAddress},
		SentAt:     pgtype.Timestamptz{Time: sentAt, Valid: true},
		ImapLabels: []string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.persistThreadBody(ctx, acc.ID, acc.OrganizationID, row.ID, emailHubObjectBodyText, ""); err != nil {
		t.Fatal(err)
	}
	return row
}

func setEmailHubObjectBodyMode(t *testing.T) {
	t.Helper()
	t.Setenv("EMAIL_HUB_BODY_STORAGE", "s3")
	t.Setenv("STORAGE_BACKEND", "s3")
}

// UNI-1118: every strip path deletes the object the row pointed at.
func TestEmailHubRetentionDeletesBodyObjects(t *testing.T) {
	setEmailHubObjectBodyMode(t)
	svc, q, user, ws, _ := emailHubFixture(t)
	mem := newMemStorage()
	svc.SetObjectStorage(mem)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	ctx := context.Background()
	now := time.Now().UTC()
	old := seedObjectBodyThread(t, svc, q, acc, 1, now.AddDate(0, 0, -100))
	mid := seedObjectBodyThread(t, svc, q, acc, 2, now.AddDate(0, 0, -2))
	recent := seedObjectBodyThread(t, svc, q, acc, 3, now)
	stored := func(id string) bool {
		_, ok := mem.objects[bodystore.ObjectKey(acc.OrganizationID, acc.ID, id)]
		return ok
	}
	if !stored(old.ID) || !stored(mid.ID) || !stored(recent.ID) {
		t.Fatal("seed did not upload bodies")
	}

	svc.expireEmailHubBodies(ctx, acc, retention.Limits{BodyRetentionDays: 30})
	if stored(old.ID) || !stored(mid.ID) {
		t.Fatalf("expire: old stored=%v mid stored=%v", stored(old.ID), stored(mid.ID))
	}

	svc.trimEmailHubBodyCache(ctx, acc, emailhub.FolderInbox, retention.Limits{MaxBodyCachedPerFolder: 1})
	if stored(mid.ID) || !stored(recent.ID) {
		t.Fatalf("trim: mid stored=%v recent stored=%v", stored(mid.ID), stored(recent.ID))
	}

	key, err := q.InvalidateEmailHubThreadBody(ctx, recent.ID)
	if err != nil || key != bodystore.ObjectKey(acc.OrganizationID, acc.ID, recent.ID) {
		t.Fatalf("invalidate returned key=%q err=%v", key, err)
	}
}

// UNI-1624: disconnecting drops the mailbox's body objects with its rows (the
// rows are the only pointer to them), and leaves another mailbox's alone.
func TestEmailHubDisconnectDeletesBodyObjects(t *testing.T) {
	setEmailHubObjectBodyMode(t)
	svc, q, user, ws, _ := emailHubFixture(t)
	mem := newMemStorage()
	svc.SetObjectStorage(mem)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	other := seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, "other@gmail.com")
	now := time.Now().UTC()
	mine := seedObjectBodyThread(t, svc, q, acc, 1, now)
	theirs := seedObjectBodyThread(t, svc, q, other, 1, now)
	mineKey := bodystore.ObjectKey(acc.OrganizationID, acc.ID, mine.ID)
	theirsKey := bodystore.ObjectKey(other.OrganizationID, other.ID, theirs.ID)
	if _, ok := mem.objects[mineKey]; !ok {
		t.Fatalf("seed did not upload %s", mineKey)
	}

	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := mem.objects[mineKey]; ok {
		t.Fatalf("disconnect left the body object %s", mineKey)
	}
	if _, ok := mem.objects[theirsKey]; !ok {
		t.Fatalf("disconnect deleted another mailbox's body object %s", theirsKey)
	}
}

// UNI-1121: opening an S3-cached thread reads the object instead of wiping it.
func TestGetThreadHydratesObjectBodyWithoutInvalidating(t *testing.T) {
	setEmailHubObjectBodyMode(t)
	svc, q, user, ws, _ := emailHubFixture(t)
	svc.SetObjectStorage(&memStorageGet{memStorage: *newMemStorage()})
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	ctx := context.Background()
	th := seedObjectBodyThread(t, svc, q, acc, 7, time.Now().UTC())

	view, err := svc.GetThread(ctx, Human(user.ID), ws.ID, acc.ID, th.ID, true, false)
	if err != nil || view.BodyText != emailHubObjectBodyText {
		t.Fatalf("get thread: err=%v body=%q", err, view.BodyText)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: th.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil || !row.BodyCached || row.BodyObjectKey != bodystore.ObjectKey(acc.OrganizationID, acc.ID, th.ID) {
		t.Fatalf("row after open: err=%v cached=%v key=%q", err, row.BodyCached, row.BodyObjectKey)
	}
}

// UNI-1122: a colleague in the same workspace cannot read or snooze another
// member's mailbox by naming its ids.
func TestEmailHubConversationAndSnoozeRejectOtherUser(t *testing.T) {
	svc, q, owner, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	other := registerVerified(t, q, as, "eh-other@example.com", "EH Other")
	addOrgMember(t, q, ws.OrganizationID, other.ID)
	addWorkspaceMember(t, q, ws.ID, other.ID)
	acc := seedEmailHubAccount(t, q, svc.box, owner.ID, ws.OrganizationID)
	th := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	until := time.Now().UTC().Add(time.Hour)

	if _, err := svc.ListConversationMessages(ctx, Human(other.ID), ws.ID, acc.ID, th.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("colleague conversation: want ErrNotFound, got %v", err)
	}
	if _, err := svc.SetThreadSnooze(ctx, Human(other.ID), ws.ID, acc.ID, th.ID, &until); !errors.Is(err, ErrNotFound) {
		t.Fatalf("colleague snooze: want ErrNotFound, got %v", err)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: th.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil || row.SnoozedUntil.Valid {
		t.Fatalf("snooze changed by colleague: err=%v snoozed=%v", err, row.SnoozedUntil)
	}

	if msgs, err := svc.ListConversationMessages(ctx, Human(owner.ID), ws.ID, acc.ID, th.ID); err != nil || len(msgs) != 1 {
		t.Fatalf("owner conversation: err=%v len=%d", err, len(msgs))
	}
	if v, err := svc.SetThreadSnooze(ctx, Human(owner.ID), ws.ID, acc.ID, th.ID, &until); err != nil || v.SnoozedUntil == nil {
		t.Fatalf("owner snooze: err=%v view=%+v", err, v)
	}
}

// seedSearchHitThread is a metadata-only row as IMAP search caches it: the
// snippet is the subject and no body is stored.
func seedSearchHitThread(t *testing.T, q *db.Queries, acc db.EmailHubAccount, uid int32, sentAt time.Time) db.EmailHubThread {
	t.Helper()
	row, err := q.UpsertEmailHubThread(context.Background(), db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: uid, Subject: "Quote", Snippet: "Quote",
		FromAddr: "a@b.co", ToAddrs: []string{acc.EmailAddress}, IsStarred: true,
		SentAt:     pgtype.Timestamptz{Time: sentAt, Valid: true},
		ImapLabels: []string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// UNI-1129: a message IMAP matched by body text stays in the result on every
// page, though the cache holds no body to match it again.
func TestEmailHubSearchKeepsIMAPHits(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	now := time.Now().UTC()
	newer := seedSearchHitThread(t, q, acc, 1, now)
	older := seedSearchHitThread(t, q, acc, 2, now.Add(-time.Hour))
	seedSearchHitThread(t, q, acc, 3, now.Add(-2*time.Hour)) // starred, not a hit
	const term = "HD-7781"
	// What a finished IMAP run leaves behind; the fixture has no IMAP server.
	svc.gov.shouldIndexSearch(acc.ID, emailhub.FolderInbox, term)
	svc.gov.rememberSearchHits(acc.ID, emailhub.FolderInbox, term, []string{newer.ID, older.ID})

	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50, Query: term,
	})
	if err != nil || len(page.Threads) != 2 || page.Counts.Total != 2 {
		t.Fatalf("inbox search: err=%v len=%d total=%d", err, len(page.Threads), page.Counts.Total)
	}

	// The INBOX run is still cached: STARRED searches INBOX, and so does page 2.
	first, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderStarred, Limit: 1, Query: term,
	})
	if err != nil || len(first.Threads) != 1 || first.Threads[0].ID != newer.ID {
		t.Fatalf("starred page 1: err=%v page=%+v", err, first)
	}
	second, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderStarred, Limit: 1, Query: term, BeforeID: first.NextCursor,
	})
	if err != nil || len(second.Threads) != 1 || second.Threads[0].ID != older.ID {
		t.Fatalf("starred page 2: err=%v page=%+v", err, second)
	}
}

// UNI-1129: a search that found the IMAP lock busy (a sync running) did not
// search, so the next page must try again rather than serve no hits.
func TestEmailHubSearchRetriesWhenIMAPBusy(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	gt := svc.gov.gate(acc.ID)
	gt.imapMu.Lock()
	hits, err := svc.indexSearchResults(context.Background(), acc, emailhub.FolderInbox, "HD-7781")
	gt.imapMu.Unlock()
	if err != nil || hits != nil {
		t.Fatalf("busy search: hits=%v err=%v", hits, err)
	}
	if _, run := svc.gov.shouldIndexSearch(acc.ID, emailhub.FolderInbox, "HD-7781"); !run {
		t.Fatal("a search skipped for a busy IMAP lock was cached as done")
	}
}

// UNI-1129: while the reader opens a thread (an interactive IMAP fetch), a list
// refetch still keeps the hits IMAP already found; it only skips a new search.
func TestEmailHubSearchKeepsCachedHitsWhileInteractive(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	const term = "HD-7781"
	svc.gov.shouldIndexSearch(acc.ID, emailhub.FolderInbox, term)
	svc.gov.rememberSearchHits(acc.ID, emailhub.FolderInbox, term, []string{"hit"})
	svc.gov.beginInteractive(acc.ID)
	defer svc.gov.endInteractive(acc.ID)

	hits, err := svc.indexSearchResults(context.Background(), acc, emailhub.FolderInbox, term)
	if err != nil || len(hits) != 1 || hits[0] != "hit" {
		t.Fatalf("cached hits while interactive: hits=%v err=%v", hits, err)
	}
	if hits, err := svc.indexSearchResults(context.Background(), acc, emailhub.FolderSent, term); err != nil || hits != nil {
		t.Fatalf("uncached search while interactive: hits=%v err=%v", hits, err)
	}
	if _, run := svc.gov.shouldIndexSearch(acc.ID, emailhub.FolderSent, term); !run {
		t.Fatal("a search skipped while interactive was cached as done")
	}
}

// UNI-1129: re-caching a row from IMAP metadata (snippet = subject) keeps the
// snippet its cached body produced.
func TestEmailHubUpsertKeepsBodySnippet(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	row := seedSearchHitThread(t, q, acc, 9, time.Now().UTC())
	if err := svc.persistThreadBody(ctx, acc.ID, acc.OrganizationID, row.ID, emailHubObjectBodyText, ""); err != nil {
		t.Fatal(err)
	}
	if err := q.PatchEmailHubThreadSnippet(ctx, db.PatchEmailHubThreadSnippetParams{ID: row.ID, Snippet: emailHubObjectBodyText}); err != nil {
		t.Fatal(err)
	}

	ids, err := svc.upsertThreadItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{{
		UID: 9, Subject: "Quote", Snippet: "Quote", FromAddr: "a@b.co", SentAt: row.SentAt.Time,
	}})
	if err != nil || len(ids) != 1 || ids[0] != row.ID {
		t.Fatalf("upsert: err=%v ids=%v", err, ids)
	}
	got, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: row.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	})
	if err != nil || got.Snippet != emailHubObjectBodyText {
		t.Fatalf("snippet after upsert: err=%v snippet=%q", err, got.Snippet)
	}
}
