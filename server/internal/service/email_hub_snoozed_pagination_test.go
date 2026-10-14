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

func TestEmailHubSnoozedPaginationUsesCursorOrder(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	actor := Human(user.ID)
	baseSentAt := time.Now().UTC().Add(-24 * time.Hour)
	baseSnoozedUntil := time.Now().UTC().Add(24 * time.Hour)
	wantIDs := make(map[string]struct{}, 51)

	for i := 0; i < 51; i++ {
		sentAt := baseSentAt.Add(-time.Duration(i+1) * time.Hour)
		if i == 49 {
			sentAt = baseSentAt
		} else if i == 50 {
			// The latest snooze sorts after page one's legacy cursor but has a
			// newer sent_at, so a mismatched cursor drops it from page two.
			sentAt = baseSentAt.Add(time.Hour)
		}
		thread, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			Folder: emailhub.FolderInbox, ImapUid: int32(i + 1), Subject: "Snoozed pagination",
			Snippet: "pagination", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
			SentAt: pgtype.Timestamptz{Time: sentAt, Valid: true}, ImapLabels: []string{},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := q.UpdateEmailHubThreadSnooze(ctx, db.UpdateEmailHubThreadSnoozeParams{
			ID: thread.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			SnoozedUntil: pgtype.Timestamptz{
				Time: baseSnoozedUntil.Add(time.Duration(i) * time.Minute), Valid: true,
			},
		}); err != nil {
			t.Fatal(err)
		}
		wantIDs[thread.ID] = struct{}{}
	}

	first, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailHubFolderSnoozed, Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Threads) != 50 || first.NextCursor == "" {
		t.Fatalf("page one: len=%d cursor=%q, want 50 rows and a cursor", len(first.Threads), first.NextCursor)
	}
	second, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailHubFolderSnoozed, Limit: 50, BeforeID: first.NextCursor,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Threads) != 1 || second.NextCursor != "" {
		t.Fatalf("page two: len=%d cursor=%q, want final 1 row", len(second.Threads), second.NextCursor)
	}

	seen := make(map[string]struct{}, 51)
	for _, thread := range append(first.Threads, second.Threads...) {
		if _, duplicate := seen[thread.ID]; duplicate {
			t.Fatalf("thread %s appeared on both snoozed pages", thread.ID)
		}
		seen[thread.ID] = struct{}{}
	}
	if len(seen) != len(wantIDs) {
		t.Fatalf("walked %d unique snoozed threads, want %d", len(seen), len(wantIDs))
	}
	for id := range wantIDs {
		if _, ok := seen[id]; !ok {
			t.Fatalf("snoozed thread %s was skipped by pagination", id)
		}
	}
}
