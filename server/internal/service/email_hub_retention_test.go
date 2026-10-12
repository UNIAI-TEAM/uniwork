package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/retention"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestTrimEmailHubBodyCacheEvictsOldestAndPreservesNewestSummary(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	const (
		keepCount   = 3
		excessCount = 2
	)

	baseTime := time.Now().UTC().Add(-time.Duration(keepCount+excessCount) * time.Hour)
	threads := make([]db.EmailHubThread, 0, keepCount+excessCount)
	for i := 0; i < keepCount+excessCount; i++ {
		thread, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
			Folder: emailhub.FolderInbox, ImapUid: int32(i + 1), Subject: "Retention order",
			Snippet: "cached body", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
			SentAt:     pgtype.Timestamptz{Time: baseTime.Add(time.Duration(i) * time.Hour), Valid: true},
			ImapLabels: []string{},
		})
		if err != nil {
			t.Fatal(err)
		}
		thread, err = q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
			ID: thread.ID, BodyText: pgtype.Text{String: "cached body", Valid: true},
		})
		if err != nil {
			t.Fatal(err)
		}
		threads = append(threads, thread)
	}

	newest := threads[len(threads)-1]
	if _, err := q.UpsertEmailHubThreadAiSummary(ctx, db.UpsertEmailHubThreadAiSummaryParams{
		ID: util.NewID(), OrganizationID: acc.OrganizationID, ThreadID: newest.ID, AccountID: acc.ID,
		Locale: "vi", SourceFingerprint: "newest-fingerprint", Summary: "newest summary",
		KeyPoints: []byte("[]"), ActionItems: []byte("[]"), Model: "test",
		CreatedBy: user.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := q.DeleteEmailHubThreadAiSummariesForThread(context.Background(), newest.ID); err != nil {
			t.Errorf("cleanup newest thread AI summary: %v", err)
		}
	})

	svc.trimEmailHubBodyCache(ctx, acc, emailhub.FolderInbox, retention.Limits{
		MaxBodyCachedPerFolder: keepCount,
	})

	for i, thread := range threads {
		got, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
			ID: thread.ID, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
		})
		if err != nil {
			t.Fatal(err)
		}
		wantCached := i >= excessCount
		if got.BodyCached != wantCached {
			t.Errorf("thread %d body_cached = %v, want %v", i, got.BodyCached, wantCached)
		}
	}

	summary, err := q.GetEmailHubThreadAiSummary(ctx, db.GetEmailHubThreadAiSummaryParams{
		ThreadID: newest.ID, Locale: "vi", OrganizationID: acc.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			t.Fatal("newest thread AI summary was evicted with its body")
		}
		t.Fatal(err)
	}
	if summary.Summary != "newest summary" {
		t.Fatalf("newest summary = %q, want %q", summary.Summary, "newest summary")
	}
}
