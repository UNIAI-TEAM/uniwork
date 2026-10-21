package sdi

// FolderUploadFileSDI is one file of a folder upload PLAN (UNI-2052).
type FolderUploadFileSDI struct {
	FileKey   string                 `json:"file_key" description:"Khóa do client đặt, 1-64 ký tự [A-Za-z0-9_-], duy nhất trong kế hoạch; mọi route sau gọi tệp bằng khóa này" example:"f-0001"`
	Path      string                 `json:"path" description:"Thư mục chứa tệp, tương đối dưới thư mục gốc, '/' phân tách; rỗng = thẳng dưới gốc; phải có trong folders; chế độ files: luôn rỗng" example:"Hợp đồng/2026"`
	Filename  string                 `json:"filename" description:"Tên tệp; đuôi phải nằm trong documents.limits.upload_extensions" example:"hop-dong.pdf"`
	SizeBytes int64                  `json:"size_bytes" description:"Kích thước tệp (byte), tối đa upload_max_bytes" example:"12345"`
	Probe     *UploadSessionProbeSDI `json:"probe,omitempty" description:"Probe đầu tệp; chỉ bắt buộc với tệp lớn hơn chunked_upload_threshold_bytes"`
}

// CreateFolderUploadSDI is the body of POST
// /api/v1/workspaces/{workspaceID}/documents/folder-uploads (UNI-2052 PLAN).
type CreateFolderUploadSDI struct {
	ParentID           *string               `json:"parent_id" description:"ULID thư mục cha cùng workspace mà người gọi sửa được; null = gốc workspace" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	RootName           string                `json:"root_name" description:"Tên thư mục gốc; trùng thư mục cùng cấp thì thành '<tên> (n)'. Bỏ trống cùng với folders = chế độ files (nhiều tệp, không tạo thư mục, tệp nằm thẳng trong parent_id)" example:"Hồ sơ 2026"`
	ShareWithWorkspace bool                  `json:"share_with_workspace" description:"true: mọi tệp của lần tải này mở cho workspace ở mức xem; thư mục luôn riêng tư" example:"false"`
	Folders            []string              `json:"folders,omitempty" description:"Vắng, null hoặc [] = không có thư mục con. Đường dẫn thư mục con, tương đối dưới gốc, '/' phân tách; cha của mỗi đường dẫn phải có trong danh sách" example:"[\"Hợp đồng\",\"Hợp đồng/2026\"]"`
	Files              []FolderUploadFileSDI `json:"files" description:"Các tệp sẽ tải lên"`
}
