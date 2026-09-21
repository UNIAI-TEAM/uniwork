package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
)

func TestSearchFolderPlan(t *testing.T) {
	t.Parallel()
	searchFolder, cacheFolder, opts := searchFolderPlan(emailhub.FolderInbox)
	if searchFolder != emailhub.FolderInbox || cacheFolder != emailhub.FolderInbox || opts.StarredOnly {
		t.Fatalf("unexpected inbox plan: %s %s %+v", searchFolder, cacheFolder, opts)
	}

	searchFolder, cacheFolder, opts = searchFolderPlan(emailhub.FolderStarred)
	if searchFolder != emailhub.FolderInbox || cacheFolder != emailhub.FolderInbox || !opts.StarredOnly {
		t.Fatalf("unexpected starred plan: %s %s %+v", searchFolder, cacheFolder, opts)
	}

	searchFolder, cacheFolder, opts = searchFolderPlan(emailhub.FolderSent)
	if searchFolder != emailhub.FolderSent || cacheFolder != emailhub.FolderSent || opts.StarredOnly {
		t.Fatalf("unexpected sent plan: %s %s %+v", searchFolder, cacheFolder, opts)
	}
}
