package service

import "github.com/unicomhub/uniwork/server/internal/files"

// FileReferenceProviders is every module's FS-C1 section 6 provider, in the
// set the composition root hands to NewFileService. It lives here because
// only the service tier imports internal/files (arch test); a module that adds
// a file_id writer adds its provider to this list in the same change.
func FileReferenceProviders(chat *ChatService, meetings *MeetingService) []files.ReferenceProvider {
	return []files.ReferenceProvider{
		NewTaskAttachmentProvider(),
		NewUserAvatarProvider(),
		chat.FileReferenceProvider(),
		chat.VoiceRecordingFileReferenceProvider(),
		meetings.FileReferenceProvider(),
		AuditExportReferenceProvider(),
		// Documents (UNI-675): the schema's file_id columns need providers
		// before G1-03 opens the document purposes, or the reference
		// registry cannot prove the columns are covered.
		DocumentVersionReferenceProvider{},
		DocumentAssetReferenceProvider{},
		// Office engine output while a job is live (G2-02).
		OfficeJobOutputProvider{},
	}
}
