package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/retention"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
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

const (
	retentionExpireQuery = "ExpireEmailHubThreadBodiesBefore"
	retentionTrimQuery   = "ListEmailHubThreadIDsExcessBodyCache"
	retentionPruneQuery  = "ListEmailHubThreadIDsOverFolderCap"
)

type emailHubRetentionQueryCall struct {
	name string
	args []any
}

type emailHubRetentionQueryRecorder struct {
	calls []emailHubRetentionQueryCall
}

func (r *emailHubRetentionQueryRecorder) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag(""), fmt.Errorf("unexpected retention Exec")
}

func (r *emailHubRetentionQueryRecorder) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	for _, name := range []string{retentionExpireQuery, retentionTrimQuery, retentionPruneQuery} {
		if strings.Contains(query, "-- name: "+name) {
			r.calls = append(r.calls, emailHubRetentionQueryCall{name: name, args: args})
			return emailHubEmptyRows{}, nil
		}
	}
	return nil, fmt.Errorf("unexpected retention query")
}

func (r *emailHubRetentionQueryRecorder) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected retention QueryRow")
}

type emailHubEmptyRows struct{}

func (emailHubEmptyRows) Close()                                       {}
func (emailHubEmptyRows) Err() error                                   { return nil }
func (emailHubEmptyRows) CommandTag() pgconn.CommandTag                { return pgconn.NewCommandTag("") }
func (emailHubEmptyRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (emailHubEmptyRows) Next() bool                                   { return false }
func (emailHubEmptyRows) Scan(...any) error                            { return fmt.Errorf("no retention rows") }
func (emailHubEmptyRows) Values() ([]any, error)                       { return nil, nil }
func (emailHubEmptyRows) RawValues() [][]byte                          { return nil }
func (emailHubEmptyRows) Conn() *pgx.Conn                              { return nil }

func newEmailHubRetentionRecorder(t *testing.T) (*EmailHubService, *emailHubRetentionQueryRecorder) {
	t.Helper()
	t.Setenv("EMAIL_HUB_BODY_RETENTION_DAYS", "1")
	t.Setenv("EMAIL_HUB_MAX_BODY_CACHED_PER_FOLDER", "1")
	t.Setenv("EMAIL_HUB_MAX_THREADS_PER_FOLDER", "1")
	box, err := secretbox.New(make([]byte, secretbox.KeySize))
	if err != nil {
		t.Fatal(err)
	}
	recorder := &emailHubRetentionQueryRecorder{}
	return &EmailHubService{q: db.New(recorder), box: box}, recorder
}

func retentionCallsByName(t *testing.T, calls []emailHubRetentionQueryCall) (int, []string, []string) {
	t.Helper()
	var expire int
	var trimFolders, pruneFolders []string
	for _, call := range calls {
		switch call.name {
		case retentionExpireQuery:
			expire++
		case retentionTrimQuery:
			trimFolders = append(trimFolders, call.args[2].(string))
		case retentionPruneQuery:
			pruneFolders = append(pruneFolders, call.args[2].(string))
		default:
			t.Fatalf("unexpected retention query %q", call.name)
		}
	}
	return expire, trimFolders, pruneFolders
}

func TestEmailHubAccountRetentionExpiresOnceAndPrunesEverySyncableFolder(t *testing.T) {
	svc, recorder := newEmailHubRetentionRecorder(t)
	acc := db.EmailHubAccount{ID: "account-1", OrganizationID: "organization-1"}

	svc.enforceEmailHubAccountRetention(context.Background(), acc)

	expire, trimFolders, pruneFolders := retentionCallsByName(t, recorder.calls)
	if expire != 1 {
		t.Fatalf("expire calls = %d, want 1", expire)
	}
	wantFolders := emailhub.SyncableFolders()
	if !slices.Equal(trimFolders, wantFolders) {
		t.Fatalf("trim folders = %v, want %v", trimFolders, wantFolders)
	}
	if !slices.Equal(pruneFolders, wantFolders) {
		t.Fatalf("prune folders = %v, want %v", pruneFolders, wantFolders)
	}
}

func TestEmailHubFolderRetentionStillExpiresBodiesForBackfill(t *testing.T) {
	svc, recorder := newEmailHubRetentionRecorder(t)
	acc := db.EmailHubAccount{ID: "account-1", OrganizationID: "organization-1"}

	svc.enforceEmailHubFolderRetention(context.Background(), acc, emailhub.FolderInbox)

	expire, trimFolders, pruneFolders := retentionCallsByName(t, recorder.calls)
	if expire != 1 {
		t.Fatalf("expire calls = %d, want 1", expire)
	}
	if !slices.Equal(trimFolders, []string{emailhub.FolderInbox}) {
		t.Fatalf("trim folders = %v, want INBOX", trimFolders)
	}
	if !slices.Equal(pruneFolders, []string{emailhub.FolderInbox}) {
		t.Fatalf("prune folders = %v, want INBOX", pruneFolders)
	}
}
