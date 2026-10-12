package service

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

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
