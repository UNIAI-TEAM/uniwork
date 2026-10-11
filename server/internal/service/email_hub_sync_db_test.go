package service

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestEmailHubClaimAccountsRotatesPastFailingAccounts(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var last db.EmailHubAccount
	for i := 0; i < 21; i++ {
		last = seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, fmt.Sprintf("seed%d@gmail.com", i))
	}
	// The first 20 are the oldest: with a list query they would head the queue forever.
	if _, err := pool.Exec(ctx, `UPDATE email_hub_accounts SET updated_at = now() - interval '1 day' WHERE id <> $1`, last.ID); err != nil {
		t.Fatal(err)
	}
	first, err := q.ClaimEmailHubAccountsForSync(ctx, 20)
	if err != nil || len(first) != 20 {
		t.Fatalf("first claim: %d rows, err=%v", len(first), err)
	}
	second, err := q.ClaimEmailHubAccountsForSync(ctx, 20)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(second, func(a db.EmailHubAccount) bool { return a.ID == last.ID }) {
		t.Fatalf("second claim must reach the account the first one left, got %d rows", len(second))
	}
}

func TestEmailHubClaimAccountsIsDisjointAcrossTransactions(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	for i := 0; i < 6; i++ {
		seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, fmt.Sprintf("seed%d@gmail.com", i))
	}
	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx1.Rollback(ctx) }()
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx2.Rollback(ctx) }()
	a, err := q.WithTx(tx1).ClaimEmailHubAccountsForSync(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	b, err := q.WithTx(tx2).ClaimEmailHubAccountsForSync(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 3 || len(b) != 3 {
		t.Fatalf("each node claims its own batch, got %d and %d", len(a), len(b))
	}
	seen := map[string]bool{}
	for _, r := range append(a, b...) {
		if seen[r.ID] {
			t.Fatalf("account %s claimed by both nodes", r.ID)
		}
		seen[r.ID] = true
	}
}

func TestEmailHubReconcilePruneStaysInsideTheFetchedWindow(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	for uid := int32(1); uid <= 60; uid++ {
		if _, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
			Folder: emailhub.FolderInbox, ImapUid: uid, Subject: "s", FromAddr: "a@b.co",
			ToAddrs: []string{}, ImapLabels: []string{},
			SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_threads SET is_starred = true WHERE account_id = $1 AND imap_uid = 3`, acc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE email_hub_threads SET snoozed_until = now() + interval '3 days' WHERE account_id = $1 AND imap_uid = 5`, acc.ID); err != nil {
		t.Fatal(err)
	}
	// The server's 50 newest are UIDs 10..60 without 30, which another client deleted.
	var items []imapclient.ThreadMeta
	for uid := uint32(10); uid <= 60; uid++ {
		if uid != 30 {
			items = append(items, imapclient.ThreadMeta{UID: uid})
		}
	}
	if err := svc.pruneReconciledFolderCache(ctx, acc, emailhub.FolderInbox, items); err != nil {
		t.Fatal(err)
	}
	uids, err := q.ListEmailHubThreadUIDsByFolder(ctx, db.ListEmailHubThreadUIDsByFolderParams{
		AccountID: acc.ID, OrganizationID: ws.OrganizationID, Folder: emailhub.FolderInbox,
	})
	if err != nil {
		t.Fatal(err)
	}
	left := map[int32]bool{}
	for _, u := range uids {
		left[u] = true
	}
	for _, u := range []int32{1, 3, 5, 9} {
		if !left[u] {
			t.Fatalf("UID %d is below the fetched window and must stay (starred, snoozed or backfilled)", u)
		}
	}
	if left[30] {
		t.Fatal("UID 30 is inside the window and gone from the server: it must be pruned")
	}
	if len(uids) != 59 {
		t.Fatalf("expected 59 rows left, got %d", len(uids))
	}
}

// A sent message is cached locally under a placeholder UID; when sync meets the
// server's copy (Gmail/M365 file it in Sent themselves) the local row takes the
// real UID and keeps its id and cached body, so the message shows once.
func TestEmailHubSentSyncAdoptsTheLocalSentRow(t *testing.T) {
	for _, reconcile := range []bool{false, true} {
		t.Run(fmt.Sprintf("reconcile=%v", reconcile), func(t *testing.T) {
			svc, q, user, ws, _ := emailHubFixture(t)
			ctx := context.Background()
			acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
			now := time.Now().UTC()

			// The row sendOutboundMail writes after a successful SMTP send.
			local, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
				ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
				Folder: emailhub.FolderSent, ImapUid: int32(now.Unix() & 0x7fffffff),
				MessageID: pgtype.Text{String: "<abc123@gmail.com>", Valid: true},
				Subject:   "Quarterly report", Snippet: "see attached", FromAddr: acc.EmailAddress,
				ToAddrs: []string{"boss@example.com"}, SentAt: pgtype.Timestamptz{Time: now, Valid: true},
				IsRead: true, ImapLabels: []string{}, ConversationKey: "mid:<abc123@gmail.com>",
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
				ID: local.ID, BodyText: pgtype.Text{String: "see attached", Valid: true},
			}); err != nil {
				t.Fatal(err)
			}

			// The server's Sent folder: our message (header case differs) and an older one.
			items := []imapclient.ThreadMeta{
				{
					UID: 5, MessageID: "<older@gmail.com>", Subject: "Older", FromAddr: acc.EmailAddress,
					ToAddrs: []string{"x@example.com"}, SentAt: now.Add(-time.Hour), IsRead: true,
				},
				{
					UID: 7, MessageID: "<ABC123@gmail.com>", Subject: "Quarterly report", FromAddr: acc.EmailAddress,
					ToAddrs: []string{"boss@example.com"}, SentAt: now, IsRead: true,
				},
			}
			for range 2 { // a second sync must not change anything
				if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderSent, items, reconcile); err != nil {
					t.Fatal(err)
				}
			}

			uids, err := q.ListEmailHubThreadUIDsByFolder(ctx, db.ListEmailHubThreadUIDsByFolderParams{
				AccountID: acc.ID, OrganizationID: ws.OrganizationID, Folder: emailhub.FolderSent,
			})
			if err != nil {
				t.Fatal(err)
			}
			slices.Sort(uids)
			if !slices.Equal(uids, []int32{5, 7}) {
				t.Fatalf("Sent UIDs = %v, want [5 7] (the sent message exactly once)", uids)
			}
			got, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
				ID: local.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
			})
			if err != nil {
				t.Fatalf("local Sent row must survive with its id: %v", err)
			}
			if got.ImapUid != 7 || !got.BodyCached {
				t.Fatalf("adopted row: uid=%d body_cached=%v, want uid 7 with the body kept", got.ImapUid, got.BodyCached)
			}
		})
	}
}
