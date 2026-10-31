package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

func TestStarredSearchFolders(t *testing.T) {
	t.Parallel()
	gmail := starredSearchFolders("gmail")
	if len(gmail) != 1 || gmail[0] != emailhub.FolderArchive {
		t.Fatalf("gmail folders: %v, want All Mail only (UNI-2269)", gmail)
	}
	outlook := starredSearchFolders("outlook")
	if len(outlook) != 1 || outlook[0] != emailhub.FolderInbox {
		t.Fatalf("outlook folders: %v", outlook)
	}
}
