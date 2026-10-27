package service

import "net/http"

// Folder bulk access constants and error codes (UNI-2244 §1–§6).
const (
	// FolderContentsAccessSyncMax is the default maximum number of subtree
	// documents processed synchronously in one transaction before falling back
	// to a background batch (spec §3.1 step 5).
	FolderContentsAccessSyncMax = 500

	// FolderContentsAccessMaxItems caps the number of principal items on
	// PUT /api/v1/documents/{folderID}/contents-access (spec §3.1).
	FolderContentsAccessMaxItems = 100

	FolderContentsAccessModeMerge   = "merge"
	FolderContentsAccessModeReplace = "replace"

	FolderContentsAccessExecSync       = "sync"
	FolderContentsAccessExecBackground = "background"

	FolderContentsAccessBatchStatusQueued    = "queued"
	FolderContentsAccessBatchStatusRunning   = "running"
	FolderContentsAccessBatchStatusCompleted = "completed"
	FolderContentsAccessBatchStatusFailed    = "failed"

	FolderContentsAccessWarningWideScope = "wide_scope"
	FolderContentsAccessWarningDowngrade = "downgrade"
	FolderContentsAccessWarningToPrivate = "to_private"

	ErrCodeNotAFolder               = "not_a_folder"
	ErrCodeDocumentAccessRejected   = "document_access_rejected"
	ErrCodeFolderAccessBatchRunning = "folder_access_batch_running"
)

func errNotAFolder() error {
	return coded(http.StatusUnprocessableEntity, "not_a_folder", "tài liệu gốc không phải là thư mục")
}

func errFolderAccessBatchRunning(batchID string) error {
	return CodedError{
		Code:   "folder_access_batch_running",
		Status: http.StatusConflict,
		Msg:    "thư mục đang có một lô cập nhật quyền truy cập chạy nền",
		Fields: map[string]any{"batch_id": batchID},
	}
}
