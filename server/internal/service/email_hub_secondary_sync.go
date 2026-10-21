package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// syncTrashAndSpamBestEffort pulls Trash and Spam after INBOX changes so mail
// moved on the provider (e.g. to junk) shows up without waiting for the user to
// open those folders (UNI-1638, UNI-1635).
func (s *EmailHubService) syncTrashAndSpamBestEffort(ctx context.Context, acc db.EmailHubAccount) {
	for _, folder := range []string{emailhub.FolderTrash, emailhub.FolderSpam} {
		_, _, err := s.syncSingleFolder(ctx, acc, folder, false, true, false, false)
		if err != nil {
			s.log.Debug("email hub secondary folder sync failed",
				"account_id", acc.ID, "folder", folder, "code", emailHubErrCode(err))
		}
	}
}
