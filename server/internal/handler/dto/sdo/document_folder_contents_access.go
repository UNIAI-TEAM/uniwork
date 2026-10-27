package sdo

// Folder bulk access wire error and enum constants (UNI-2244 §2, §3).
const (
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

	FolderContentsAccessErrNotAFolder            = "not_a_folder"
	FolderContentsAccessErrAccessRejected        = "document_access_rejected"
	FolderContentsAccessErrBatchRunning          = "folder_access_batch_running"
	FolderContentsAccessErrNotFound              = "not_found"
	FolderContentsAccessErrNotImplemented        = "not_implemented"
	FolderContentsAccessRejectedPrincipalOutside = "principal_not_in_organization"
	FolderContentsAccessRejectedLevelNotAllowed  = "level_not_allowed"
	FolderContentsAccessRejectedDuplicate        = "duplicate_principal"
	FolderContentsAccessRejectedBreakGlass       = "break_glass_required"
)

// FolderContentsAccessPreviewSDO is the dry-run summary block of
// FolderContentsAccessDryRunSDO (UNI-2244 §3.1): counts and warning codes
// only, never document titles or person names (NFR-04).
type FolderContentsAccessPreviewSDO struct {
	Changed              int      `json:"changed" description:"Số tài liệu quản lý được sẽ có thay đổi quyền" example:"37"`
	Unchanged            int      `json:"unchanged" description:"Số tài liệu quản lý được đã khớp quyền đích, không đổi" example:"12"`
	SkippedNotManageable int      `json:"skipped_not_manageable" description:"Số tài liệu trong cây con bị bỏ qua vì người gọi không có quyền quản trị chia sẻ" example:"5"`
	SkippedLocked        int      `json:"skipped_locked" description:"Số tài liệu thuộc Work Product đang khóa quyền bị bỏ qua" example:"1"`
	LosingUsers          int      `json:"losing_users" description:"Số người dùng mất quyền truy cập ở ít nhất một tài liệu (chế độ replace)" example:"12"`
	DowngradedUsers      int      `json:"downgraded_users" description:"Số người dùng bị hạ mức quyền hiệu lực ở ít nhất một tài liệu (chế độ replace)" example:"3"`
	Warnings             []string `json:"warnings" description:"Mã cảnh báo áp dụng cho lô: wide_scope, downgrade, to_private" example:"[\"wide_scope\",\"to_private\"]"`
}

// FolderContentsAccessDryRunSDO is the 200 response of
// PUT /api/v1/documents/{folderID}/contents-access when dry_run=true
// (UNI-2244 §3.1).
type FolderContentsAccessDryRunSDO struct {
	Total   int                            `json:"total" description:"Tổng số tài liệu sống (khác folder) trong cây con thuộc phạm vi xét" example:"55"`
	Preview FolderContentsAccessPreviewSDO `json:"preview" description:"Thống kê dự kiến và cảnh báo cho hộp thoại xác nhận" example:"{\"changed\":37,\"unchanged\":12,\"skipped_not_manageable\":5,\"skipped_locked\":1,\"losing_users\":12,\"downgraded_users\":3,\"warnings\":[\"wide_scope\",\"to_private\"]}"`
}

// FolderContentsAccessSyncSDO is the 200 response of
// PUT /api/v1/documents/{folderID}/contents-access when dry_run=false and
// total <= FolderContentsAccessSyncMax (UNI-2244 §3.1).
type FolderContentsAccessSyncSDO struct {
	BatchID              string `json:"batch_id" description:"ULID định danh lô thao tác (gắn vào metadata audit và thông báo gộp)" example:"01J8X4FAB0N1P2Q3R4S5T6U7V8"`
	Mode                 string `json:"mode" description:"Luôn là sync khi hoàn tất ngay trong một transaction" enums:"sync" example:"sync"`
	Total                int    `json:"total" description:"Tổng số tài liệu trong cây con đã xét" example:"55"`
	Changed              int    `json:"changed" description:"Số tài liệu đã ghi thay đổi quyền" example:"37"`
	Unchanged            int    `json:"unchanged" description:"Số tài liệu quản lý được nhưng quyền không đổi" example:"12"`
	SkippedNotManageable int    `json:"skipped_not_manageable" description:"Số tài liệu bỏ qua vì người gọi không quản trị chia sẻ" example:"5"`
	SkippedLocked        int    `json:"skipped_locked" description:"Số tài liệu thuộc Work Product đang khóa quyền bị bỏ qua" example:"1"`
}

// FolderContentsAccessBackgroundSDO is the 202 response of
// PUT /api/v1/documents/{folderID}/contents-access when dry_run=false and
// total > FolderContentsAccessSyncMax (UNI-2244 §3.1).
type FolderContentsAccessBackgroundSDO struct {
	BatchID string `json:"batch_id" description:"ULID lô chạy nền để tra tiến độ qua GET .../contents-access/{batchID}" example:"01J8X4FAB0N1P2Q3R4S5T6U7V8"`
	Mode    string `json:"mode" description:"Luôn là background khi xếp hàng chạy nền" enums:"background" example:"background"`
	Total   int    `json:"total" description:"Tổng số tài liệu trong phạm vi chụp lúc bấm" example:"1250"`
}

// FolderContentsAccessResultSDO is the OpenAPI union for
// PUT /api/v1/documents/{folderID}/contents-access: dry_run=true answers 200
// FolderContentsAccessDryRunSDO, sync execution answers 200
// FolderContentsAccessSyncSDO, and large subtrees answer 202
// FolderContentsAccessBackgroundSDO.
type FolderContentsAccessResultSDO struct{}

// JSONSchemaOneOf implements jsonschema.OneOfExposer so OpenAPI documents all
// three response envelopes on PUT /documents/{folderID}/contents-access.
func (FolderContentsAccessResultSDO) JSONSchemaOneOf() []interface{} {
	return []interface{}{
		FolderContentsAccessDryRunSDO{},
		FolderContentsAccessSyncSDO{},
		FolderContentsAccessBackgroundSDO{},
	}
}

// FolderContentsAccessBatchSDO is the 200 response of
// GET /api/v1/documents/{folderID}/contents-access/{batchID} (UNI-2244 §3.2):
// progress and outcome counts of a folder bulk access batch.
type FolderContentsAccessBatchSDO struct {
	BatchID              string  `json:"batch_id" description:"ULID lô thao tác" example:"01J8X4FAB0N1P2Q3R4S5T6U7V8"`
	Status               string  `json:"status" description:"queued, running, completed hoặc failed" enums:"queued,running,completed,failed" example:"running"`
	Total                int     `json:"total" description:"Tổng số tài liệu trong phạm vi chụp lúc tạo lô" example:"1250"`
	Processed            int     `json:"processed" description:"Số tài liệu đã xử lý xong tới hiện tại" example:"600"`
	Changed              int     `json:"changed" description:"Số tài liệu đã đổi quyền" example:"410"`
	Unchanged            int     `json:"unchanged" description:"Số tài liệu không đổi quyền" example:"150"`
	SkippedNotManageable int     `json:"skipped_not_manageable" description:"Số tài liệu bỏ qua vì người gọi không quản trị chia sẻ" example:"35"`
	SkippedLocked        int     `json:"skipped_locked" description:"Số tài liệu thuộc Work Product bị bỏ qua" example:"5"`
	FinishedAt           *string `json:"finished_at,omitempty" description:"Thời điểm lô kết thúc (RFC3339) khi status là completed hoặc failed; vắng mặt khi đang chờ hoặc đang chạy" example:"2026-10-27T10:15:30Z"`
}
