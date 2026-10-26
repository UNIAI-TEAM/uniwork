package sdi

// StartDriveGoogleOAuthSDI is POST /api/v1/workspaces/{workspaceID}/drive-connections/google/start.
type StartDriveGoogleOAuthSDI struct {
	ReconnectConnectionID string `json:"reconnect_connection_id,omitempty" description:"ULID kết nối cần kết nối lại; bỏ trống khi kết nối tài khoản mới" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
}

// DriveGoogleCallbackSDI documents the query parameters of GET /api/v1/drive-connections/google/callback.
type DriveGoogleCallbackSDI struct {
	State        string `query:"state" description:"Trạng thái OAuth đã niêm phong do server phát hành" example:"eyJ..."`
	Code         string `query:"code" description:"Mã ủy quyền một lần từ Google" example:"4/0AVGzR1..."`
	Error        string `query:"error" description:"Mã lỗi OAuth từ Google khi người dùng từ chối hoặc admin chặn" example:"access_denied"`
	ErrorSubtype string `query:"error_subtype" description:"Phân loại lỗi phụ của Google (ví dụ admin_policy_enforced, org_internal)" example:"admin_policy_enforced"`
}

// CreateTaskDriveFileSDI is one Google Drive file reference attached inside CreateTaskSDI.drive_files (plan B4).
type CreateTaskDriveFileSDI struct {
	ConnectionID   string `json:"connection_id" minLength:"1" description:"ULID kết nối Google Drive của người tạo việc đã chọn tệp qua Picker" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	ExternalFileID string `json:"external_file_id" minLength:"1" maxLength:"256" description:"ID tệp trên Google Drive" example:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"`
}

// LinkDriveFilesSDI is POST /api/v1/workspaces/{workspaceID}/drive-files.
type LinkDriveFilesSDI struct {
	ConnectionID    string   `json:"connection_id" minLength:"1" description:"ULID kết nối Google Drive đang hoạt động của người gọi" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	ExternalFileIDs []string `json:"external_file_ids" minItems:"1" maxItems:"20" description:"Danh sách 1–20 ID tệp trên Google Drive đã chọn qua Picker" example:"[\"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms\"]"`
	TaskID          *string  `json:"task_id,omitempty" description:"ULID công việc cần gắn tệp ngay trong cùng giao dịch; bỏ trống khi thêm từ màn Tài liệu" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
}

// ListDriveFilesSDI documents the query parameters of GET /api/v1/workspaces/{workspaceID}/drive-files.
type ListDriveFilesSDI struct {
	ConnectionID string `query:"connection_id" description:"Lọc theo ULID kết nối Google Drive trong dòng truy cập của người gọi; bỏ trống = mọi kết nối của tôi" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
	Cursor       string `query:"cursor" description:"Con trỏ trang kế tiếp (next_cursor của trang trước); bỏ trống = trang đầu" example:"eyJpZCI6IjAxSjifQ"`
	Limit        int32  `query:"limit" description:"Kích thước trang (mặc định 50, tối đa 100)" example:"50"`
}

// GrantDriveFileAccessSDI is POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access
// ("Cho UniWork đọc tệp") and PUT /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/access
// ("Đổi tài khoản đọc").
type GrantDriveFileAccessSDI struct {
	ConnectionID string `json:"connection_id" minLength:"1" description:"ULID kết nối Google Drive của chính người gọi đã chọn tệp qua Picker setFileIds" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
}

// RebindDriveFileSDI is POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/rebind.
type RebindDriveFileSDI struct {
	ConnectionID string `json:"connection_id" minLength:"1" description:"ULID kết nối Google Drive mới của người gọi dùng làm tài khoản gắn cho tệp" example:"01J8X4DRVCONN0N1P2Q3R4S5T6"`
}

// CreateDriveTaskProposalSDI is POST /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID}/task-proposals.
type CreateDriveTaskProposalSDI struct {
	Prompt        string  `json:"prompt,omitempty" maxLength:"2000" description:"Yêu cầu bổ sung của người dùng cho UNI khi đọc tài liệu; có thể để trống" example:"Tách việc cho nhóm sản phẩm và marketing"`
	ProjectID     *string `json:"project_id,omitempty" description:"ULID dự án cùng workspace dùng để gợi ý và kiểm trùng tiêu đề" example:"01J8X4PROJ0N1P2Q3R4S5T6U7V"`
	ParentTaskID  *string `json:"parent_task_id,omitempty" description:"ULID công việc cha cùng workspace dùng để kiểm trùng tiêu đề" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	ContextTaskID *string `json:"context_task_id,omitempty" description:"ULID công việc đang mở lúc yêu cầu để gợi ý mặc định công việc cha và dự án" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
}

// CheckDriveTaskProposalDuplicatesSDI is POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/duplicates.
type CheckDriveTaskProposalDuplicatesSDI struct {
	ProjectID    *string  `json:"project_id,omitempty" description:"ULID dự án đang chọn trên hộp duyệt; null hoặc bỏ trống = không thuộc dự án" example:"01J8X4PROJ0N1P2Q3R4S5T6U7V"`
	ParentTaskID *string  `json:"parent_task_id,omitempty" description:"ULID công việc cha đang chọn trên hộp duyệt; null hoặc bỏ trống = không có việc cha" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Titles       []string `json:"titles" minItems:"1" maxItems:"20" description:"Danh sách tiêu đề theo thứ tự mục để kiểm trùng với công việc đang mở" example:"[\"Chốt phạm vi tính năng beta\",\"Soạn FAQ cho CS\"]"`
}

// DriveProposalTaskItemSDI is one confirmed item inside CreateTasksFromDriveProposalSDI.
type DriveProposalTaskItemSDI struct {
	Index            int      `json:"index" minimum:"0" description:"Vị trí của mục trong danh sách đề xuất (0..19), không trùng trong một lần gửi" example:"0"`
	Title            string   `json:"title" minLength:"1" description:"Tiêu đề công việc đã được người dùng duyệt hoặc chỉnh sửa" example:"Chốt phạm vi tính năng beta"`
	Description      string   `json:"description" description:"Mô tả công việc do client dựng từ mục tiêu, checklist, trích đoạn và liên kết tài liệu" example:"Mục tiêu: Chốt danh sách tính năng beta."`
	AssigneeID       *string  `json:"assignee_id,omitempty" description:"ULID thành viên workspace được giao; null hoặc bỏ trống = chưa giao" example:"01J8X4USER0N1P2Q3R4S5T6U7V"`
	Priority         string   `json:"priority,omitempty" description:"none, low, medium, high hoặc urgent" example:"high"`
	StartDate        *string  `json:"start_date,omitempty" description:"Ngày bắt đầu dạng YYYY-MM-DD; null hoặc bỏ trống = không đặt" example:"2026-10-27"`
	DueDate          *string  `json:"due_date,omitempty" description:"Hạn chót dạng YYYY-MM-DD; null hoặc bỏ trống = không đặt" example:"2026-11-05"`
	LabelIDs         []string `json:"label_ids,omitempty" description:"Danh sách ULID nhãn đang hoạt động trong workspace" example:"[\"01J8X4LBL00N1P2Q3R4S5T6U7V\"]"`
	BlockedByIndexes []int    `json:"blocked_by_indexes,omitempty" description:"Danh sách index của các mục trong cùng lô chặn mục này (không tạo vòng)" example:"[0]"`
	AllowDuplicate   bool     `json:"allow_duplicate,omitempty" description:"true = người duyệt đã chọn Vẫn tạo dù tiêu đề trùng với việc đang mở" example:"false"`
}

// CreateTasksFromDriveProposalSDI is POST /api/v1/workspaces/{workspaceID}/drive-task-proposals/{proposalID}/tasks.
type CreateTasksFromDriveProposalSDI struct {
	ProjectID    *string                    `json:"project_id,omitempty" description:"ULID dự án áp dụng cho cả lô; null hoặc bỏ trống = không gắn dự án" example:"01J8X4PROJ0N1P2Q3R4S5T6U7V"`
	ParentTaskID *string                    `json:"parent_task_id,omitempty" description:"ULID công việc cha áp dụng cho cả lô; null hoặc bỏ trống = việc cấp cao nhất" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Status       string                     `json:"status,omitempty" description:"Khóa trạng thái áp dụng cho cả lô; bỏ trống = trạng thái Cần làm đầu tiên của workspace" example:"todo"`
	Items        []DriveProposalTaskItemSDI `json:"items" minItems:"1" maxItems:"20" description:"Danh sách 1–20 việc người dùng đã chọn tạo"`
}

// AskUniTranscriptTurnSDI is one in-memory turn sent by the client in transient Ask UNI mode (spec §9).
// Note: AskUniSDI in sdi/ai.go is NOT modified in B1; B8 wires Transient and Transcript into AskUniSDI.
type AskUniTranscriptTurnSDI struct {
	Role string `json:"role" enum:"user,assistant" description:"Vai của lượt thoại trong bản chép tạm thời: user hoặc assistant" example:"user"`
	Text string `json:"text" minLength:"1" maxLength:"32000" description:"Nội dung văn bản của lượt thoại (tổng bản chép tối đa 20 lượt, 32.000 ký tự)" example:"Tài liệu này nêu những mốc ra mắt nào?"`
}

// AskUniTransientFieldsSDI documents the transient-mode fields that B8 embeds/adds onto AskUniSDI
// when focus.kind == "drive_file" (spec §9). Kept separate in B1 so AskUniSDI stays untouched until B8.
type AskUniTransientFieldsSDI struct {
	Transient  bool                      `json:"transient,omitempty" description:"true = chế độ tạm thời không lưu hội thoại, bắt buộc khi focus.kind = drive_file và cấm đi kèm conversation_id" example:"true"`
	Transcript []AskUniTranscriptTurnSDI `json:"transcript,omitempty" maxItems:"20" description:"Cửa sổ trượt tối đa 20 lượt thoại trước đó (tổng ≤ 32.000 ký tự) làm ngữ cảnh không tin cậy cho chế độ tạm thời"`
}
