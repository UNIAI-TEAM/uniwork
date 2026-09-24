package service

import "github.com/unicomhub/uniwork/server/internal/emailhub"

// searchScopeFolders lists logical folders included in a text search (cache + SQL).
func searchScopeFolders(folder string) []string {
	if folder == emailhub.FolderStarred {
		return []string{emailhub.FolderInbox}
	}
	return []string{emailhub.FolderInbox, emailhub.FolderSent, emailhub.FolderArchive}
}
