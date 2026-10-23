package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

func TestSearchScopeFolders(t *testing.T) {
	t.Parallel()
	got := searchScopeFolders(emailhub.FolderInbox)
	if len(got) != 3 {
		t.Fatalf("inbox scope: %v", got)
	}
	if searchScopeFolders(emailhub.FolderStarred)[0] != emailhub.FolderInbox {
		t.Fatalf("starred scope should index inbox only")
	}
	if len(searchScopeFolders(emailhub.FolderSent)) != 3 {
		t.Fatalf("sent view search should span inbox/sent/archive")
	}
}
