package sdo

// DocumentSourceParentDTO is where a source file lives. For task_comment the
// id is the task's (the comment is read on the task page).
type DocumentSourceParentDTO struct {
	Kind      string `json:"kind" description:"chat_channel, chat_dm, task, task_comment, meeting hoặc email_thread" example:"chat_channel"`
	ID        string `json:"id" description:"ULID của kênh/hội thoại, công việc, cuộc họp hoặc luồng email" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	Title     string `json:"title" description:"Tên hiển thị của nơi chứa tệp" example:"Kênh dự án"`
	MessageID string `json:"message_id" description:"ULID tin nhắn chứa tệp (chỉ với chat_channel/chat_dm); rỗng với nguồn khác" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
}

// DocumentSourceOwnerDTO is who put the file there.
type DocumentSourceOwnerDTO struct {
	ID   string `json:"id" description:"ULID người hoặc agent" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Kind string `json:"kind" description:"human, agent hoặc system" example:"human"`
	Name string `json:"name" description:"Tên hiển thị" example:"Nguyễn Văn An"`
}

// DocumentSourceDTO is one source file the viewer may read.
type DocumentSourceDTO struct {
	ID           string                  `json:"id" description:"Id tệp nguồn dạng <source>:<ULID dòng gốc>, ổn định" example:"chat:01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	Source       string                  `json:"source" description:"chat, task, meeting hoặc email" example:"chat"`
	Parent       DocumentSourceParentDTO `json:"parent" description:"Nơi chứa tệp"`
	Name         string                  `json:"name" description:"Tên tệp kèm phần mở rộng" example:"Báo cáo quý 3.docx"`
	MimeType     string                  `json:"mime_type" description:"MIME type đã xác minh (email: theo thư)" example:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"`
	Extension    string                  `json:"extension" description:"Phần mở rộng chữ thường, không dấu chấm; rỗng nếu không có" example:"docx"`
	SizeBytes    int64                   `json:"size_bytes" description:"Kích thước byte" example:"48213"`
	UpdatedAt    string                  `json:"updated_at" description:"Thời điểm tệp xuất hiện ở nguồn (RFC 3339 UTC)" example:"2026-10-12T08:00:00Z"`
	Owner        *DocumentSourceOwnerDTO `json:"owner" description:"Người đưa tệp lên; null với email"`
	CanOpenInApp bool                    `json:"can_open_in_app" description:"Định dạng app Office mở được (chỉ xem)" example:"true"`
	CanSave      bool                    `json:"can_save" description:"Lưu được thành tài liệu: định dạng thuộc danh sách của tài liệu tệp và dung lượng trong giới hạn; false thì Save trả 422 source_not_saveable" example:"true"`
}

// DocumentSourceListSDO is one page of GET .../documents/sources.
type DocumentSourceListSDO struct {
	Items      []DocumentSourceDTO `json:"items"`
	NextCursor *string             `json:"next_cursor" description:"Cursor trang kế; null khi hết trang" example:"MjAyNi0xMC0xMlQwODowMDowMFp8Y2hhdDowMUo4WDRNU0cwTjFQMlEzUjRTNVQ2VTdWOA"`
}
