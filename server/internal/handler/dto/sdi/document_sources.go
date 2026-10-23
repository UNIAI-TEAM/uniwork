package sdi

// ListDocumentSourcesSDI documents the query of GET
// /api/v1/workspaces/{workspaceID}/documents/sources (UNI-1305): files that
// live in Chat, Tasks, Meetings and Email Hub, filtered by each domain's own
// read permission inside the query.
type ListDocumentSourcesSDI struct {
	Source *string `query:"source" description:"Lọc một nguồn: chat, task, meeting hoặc email; bỏ trống = tất cả" example:"chat"`
	Type   *string `query:"type" description:"Nhóm loại tệp: docx, xlsx, pptx, pdf, md, html, image hoặc other" example:"docx"`
	Query  *string `query:"q" description:"Tên tệp chứa chuỗi này (không phân biệt hoa thường), tối đa 200 ký tự" example:"hợp đồng"`
	Cursor *string `query:"cursor" description:"next_cursor của trang trước; bỏ trống = trang đầu" example:"MjAyNi0xMC0xMlQwODowMDowMFp8Y2hhdDowMUo4WDRNU0cwTjFQMlEzUjRTNVQ2VTdWOA"`
	Limit  *int32  `query:"limit" description:"Kích thước trang, mặc định 50, tối đa 100" example:"50"`
	Sort   *string `query:"sort" enum:"updated,name,size,editor" description:"Sắp xếp theo cột: updated (ngày của tệp), name (tên tệp, bảng mã tiếng Việt), size (dung lượng) hoặc editor (tên hiển thị người gửi/tải lên; agent, email hoặc tài khoản đã xóa luôn xếp cuối). Bỏ trống = mới nhất trước và con trỏ cũ. Giá trị khác -> 400 invalid_request; next_cursor của một sort không dùng được cho sort/order khác (400)" example:"name"`
	Order  *string `query:"order" enum:"asc,desc" description:"Chiều sắp xếp; chỉ dùng cùng sort (order không có sort -> 400). Bỏ trống: updated và size giảm dần, name và editor tăng dần" example:"asc"`
}

// SaveSourceFileSDI is POST
// /api/v1/workspaces/{workspaceID}/documents/sources/{sourceFileID}/save: a
// copy of the source bytes becomes a new file document. Idempotency-Key in
// the header makes a retry return the same document.
type SaveSourceFileSDI struct {
	ParentID *string `json:"parent_id,omitempty" description:"ULID thư mục hoặc trang cha; null/bỏ trống = gốc workspace" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Title    *string `json:"title,omitempty" description:"Tên tài liệu mới; bỏ trống = tên tệp nguồn" example:"Hợp đồng thuê văn phòng.docx"`
}
