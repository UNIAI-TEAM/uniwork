package sdi

// CreateTaskSDI is POST /api/v1/workspaces/{workspaceID}/tasks.
type CreateTaskSDI struct {
	Title        string  `json:"title" minLength:"1" description:"Tiêu đề công việc" example:"Chuẩn bị standup"`
	Description  string  `json:"description" description:"Chi tiết tùy chọn" example:"Agenda và ghi chú"`
	Priority     string  `json:"priority" description:"none, low, medium, high hoặc urgent" example:"medium"`
	AssigneeID   *string `json:"assignee_id" description:"Thành viên hoặc agent được giao; bỏ trống nếu chưa giao" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	AssigneeKind string  `json:"assignee_kind" description:"human (mặc định) hoặc agent" example:"human"`
	DueDate      *string `json:"due_date" description:"Hạn chót dạng YYYY-MM-DD" example:"2026-08-28"`
}

// PatchTaskSDI documents PATCH /api/v1/tasks/{taskID}. The handler still
// decodes map[string]json.RawMessage so a missing field stays unchanged and
// a JSON null clears assignee_id / due_date.
type PatchTaskSDI struct {
	Title        *string  `json:"title" description:"Tiêu đề mới" example:"Chuẩn bị standup"`
	Description  *string  `json:"description" example:"Agenda và ghi chú"`
	Status       *string  `json:"status" description:"todo, in_progress, done hoặc cancelled" example:"in_progress"`
	Priority     *string  `json:"priority" example:"high"`
	Position     *float64 `json:"position" description:"Thứ tự trên bảng; số lớn hơn nằm sau" example:"1"`
	AssigneeID   *string  `json:"assignee_id" description:"Gán thành viên hoặc agent, hoặc gửi null để bỏ giao" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	AssigneeKind *string  `json:"assignee_kind" description:"human (mặc định) hoặc agent; đọc cùng assignee_id" example:"agent"`
	DueDate      *string  `json:"due_date" description:"Đặt YYYY-MM-DD, hoặc gửi null để xóa hạn" example:"2026-08-28"`
}

// CreateCommentSDI is POST /api/v1/tasks/{taskID}/comments.
type CreateCommentSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung bình luận" example:"Đã review, merge được."`
}

// QueryTasksSDI is POST /api/v1/workspaces/{workspaceID}/tasks/query (flagged suite).
type QueryTasksSDI struct {
	Status string `json:"status" description:"Lọc theo status; bỏ trống = mọi status" example:"todo"`
	Limit  int32  `json:"limit" description:"Kích thước trang (mặc định 50, tối đa 200)" example:"50"`
	Offset int32  `json:"offset" description:"Offset phân trang" example:"0"`
}

// PutTaskSDI is PUT /api/v1/tasks/{taskID} (flagged suite). Revision may also
// arrive via If-Match; body revision wins when both are present and equal.
type PutTaskSDI struct {
	Revision *int64   `json:"revision" description:"Revision hiện tại phía client; lệch → revision_conflict" example:"1"`
	Title    *string  `json:"title" example:"Chuẩn bị standup"`
	Status   *string  `json:"status" example:"in_progress"`
	Priority *string  `json:"priority" example:"high"`
	Position *float64 `json:"position" example:"1"`
}

// BatchUpdateTasksSDI is POST .../tasks/batch-update.
type BatchUpdateTasksSDI struct {
	TaskIDs []string     `json:"task_ids" description:"Danh sách ULID công việc (tối đa 100)" example:"[\"01J8X4TASKN1P2Q3R4S5T6U7\"]"`
	Updates PatchTaskSDI `json:"updates" description:"Patch áp dụng cho mỗi task"`
}

// BatchDeleteTasksSDI is POST .../tasks/batch-delete.
type BatchDeleteTasksSDI struct {
	TaskIDs []string `json:"task_ids" description:"Danh sách ULID công việc (tối đa 100)" example:"[\"01J8X4TASKN1P2Q3R4S5T6U7\"]"`
}
