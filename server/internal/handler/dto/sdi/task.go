package sdi

// CreateTaskSDI is POST /api/v1/workspaces/{workspaceID}/tasks.
type CreateTaskSDI struct {
	Title       string  `json:"title" minLength:"1" description:"Tiêu đề công việc" example:"Chuẩn bị standup"`
	Description string  `json:"description" description:"Chi tiết tùy chọn" example:"Agenda và ghi chú"`
	Priority    string  `json:"priority" description:"none, low, medium, high hoặc urgent" example:"medium"`
	AssigneeID  *string `json:"assignee_id" description:"Thành viên được giao; bỏ trống nếu chưa giao" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DueDate     *string `json:"due_date" description:"Hạn chót dạng YYYY-MM-DD" example:"2026-08-28"`
}

// PatchTaskSDI documents PATCH /api/v1/tasks/{taskID}. The handler still
// decodes map[string]json.RawMessage so a missing field stays unchanged and
// a JSON null clears assignee_id / due_date.
type PatchTaskSDI struct {
	Title       *string  `json:"title" description:"Tiêu đề mới" example:"Chuẩn bị standup"`
	Description *string  `json:"description" example:"Agenda và ghi chú"`
	Status      *string  `json:"status" description:"todo, in_progress, done hoặc cancelled" example:"in_progress"`
	Priority    *string  `json:"priority" example:"high"`
	Position    *float64 `json:"position" description:"Thứ tự trên bảng; số lớn hơn nằm sau" example:"1"`
	AssigneeID  *string  `json:"assignee_id" description:"Gán thành viên, hoặc gửi null để bỏ giao" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	DueDate     *string  `json:"due_date" description:"Đặt YYYY-MM-DD, hoặc gửi null để xóa hạn" example:"2026-08-28"`
}

// CreateCommentSDI is POST /api/v1/tasks/{taskID}/comments.
type CreateCommentSDI struct {
	Body string `json:"body" minLength:"1" description:"Nội dung bình luận" example:"Đã review, merge được."`
}
