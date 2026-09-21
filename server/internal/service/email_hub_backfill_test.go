package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

func TestListAllowsBackfill(t *testing.T) {
	t.Parallel()
	if !listAllowsBackfill(ListEmailHubThreadsInput{}) {
		t.Fatal("expected plain list to allow backfill")
	}
	if listAllowsBackfill(ListEmailHubThreadsInput{Query: "invoice"}) {
		t.Fatal("expected search to skip backfill")
	}
	if listAllowsBackfill(ListEmailHubThreadsInput{UnreadOnly: true}) {
		t.Fatal("expected unread filter to skip backfill")
	}
}

func TestBackfillSupportedFolder(t *testing.T) {
	t.Parallel()
	if !backfillSupportedFolder(emailhub.FolderInbox) {
		t.Fatal("expected inbox backfill")
	}
	if backfillSupportedFolder(emailhub.FolderStarred) {
		t.Fatal("expected starred to skip backfill in v1")
	}
	if got := backfillMailboxFolder(emailhub.FolderStarred); got != emailhub.FolderInbox {
		t.Fatalf("starred backfill uses inbox mailbox: %q", got)
	}
}
