package sdo

// FolderUploadTargetSDO is where one pending file's bytes go (UNI-2052). kind
// put: one request with method, url, headers and expires_at; auth "session"
// means url is relative to the API origin and is sent with the session, no
// auth means a signed URL sent without any credential. kind multipart: one PUT
// per part of parts, part_size bytes each.
type FolderUploadTargetSDO struct {
	Kind      string                    `json:"kind" description:"put | multipart" example:"put"`
	Method    string                    `json:"method,omitempty" description:"HTTP method của đích put; luôn là PUT" example:"PUT"`
	URL       string                    `json:"url,omitempty" description:"URL đã ký, hoặc đường dẫn tương đối của route content khi auth=session; không log, không chia sẻ" example:"https://storage.example.test/documents/files/01J8X4FILEN1P2Q3R4S5T6U7V8?X-Amz-Signature=..."`
	Headers   map[string]string         `json:"headers" description:"Header phải gửi kèm (luôn có, có thể rỗng)" example:"{}"`
	Auth      string                    `json:"auth,omitempty" description:"session khi đích là route content của server (gửi qua phiên đăng nhập); vắng mặt với URL đã ký" example:"session"`
	SessionID string                    `json:"session_id,omitempty" description:"Phiên tải nhiều phần của tệp lớn (kind multipart)" example:"01J8X4UPS0N1P2Q3R4S5T6U7"`
	PartSize  int64                     `json:"part_size,omitempty" description:"Kích thước mỗi phần (byte), kind multipart" example:"8388608"`
	Parts     []UploadSessionPartURLSDO `json:"parts,omitempty" description:"URL đã ký cho từng phần còn thiếu, kind multipart"`
	ExpiresAt string                    `json:"expires_at" description:"Hạn của đích" example:"2026-10-22T02:00:00Z"`
}

// FolderUploadErrorSDO is why one file of a batch failed.
type FolderUploadErrorSDO struct {
	Code    string `json:"code" description:"upload_missing | size_mismatch | unsupported_media | storage_quota_exceeded | not_found | parts_invalid (tập mở)" example:"upload_missing"`
	Message string `json:"message" example:"chưa thấy tệp trên kho lưu trữ"`
	Reason  string `json:"reason,omitempty" description:"Lý do kiểm định dạng khi code là unsupported_media" example:"pdf_trailer"`
}

// FolderUploadFileSDO is one file of a batch.
type FolderUploadFileSDO struct {
	FileKey    string                 `json:"file_key" example:"f-0001"`
	Path       string                 `json:"path" example:"Hợp đồng/2026"`
	Filename   string                 `json:"filename" example:"hop-dong.pdf"`
	SizeBytes  int64                  `json:"size_bytes" example:"12345"`
	Status     string                 `json:"status" description:"pending | done | failed" example:"pending"`
	DocumentID *string                `json:"document_id" description:"Tài liệu tạo ra khi done" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Error      *FolderUploadErrorSDO  `json:"error" description:"Lỗi khi failed"`
	Target     *FolderUploadTargetSDO `json:"target" description:"Đích tải lên; chỉ có khi pending"`
}

// FolderUploadFolderSDO is one folder the batch created; path "" is the root.
type FolderUploadFolderSDO struct {
	Path string `json:"path" example:"Hợp đồng"`
	ID   string `json:"id" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
}

// FolderUploadCountsSDO sums a batch's files by status.
type FolderUploadCountsSDO struct {
	Total   int `json:"total" example:"40"`
	Done    int `json:"done" example:"0"`
	Failed  int `json:"failed" example:"0"`
	Pending int `json:"pending" example:"40"`
}

// FolderUploadBatchSDO is one folder upload batch (UNI-2052), answered by the
// PLAN and by the batch routes. status is open, completed, canceled or expired
// (the set is open: read it with a default).
type FolderUploadBatchSDO struct {
	ID                 string                  `json:"id" example:"01J8X4FUB0N1P2Q3R4S5T6U7"`
	Status             string                  `json:"status" description:"open | completed | canceled | expired" example:"open"`
	ParentID           *string                 `json:"parent_id" description:"Thư mục cha của thư mục gốc; null = gốc workspace" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	RootFolderID       string                  `json:"root_folder_id" example:"01J8X4DOC0N1P2Q3R4S5T6U8"`
	RootTitle          string                  `json:"root_title" description:"Tên cuối cùng của thư mục gốc, sau khi thêm ' (n)' nếu trùng" example:"Hồ sơ 2026 (1)"`
	ShareWithWorkspace bool                    `json:"share_with_workspace" example:"false"`
	Folders            []FolderUploadFolderSDO `json:"folders" description:"Mọi thư mục đã tạo, gốc có path rỗng"`
	Files              []FolderUploadFileSDO   `json:"files"`
	Counts             FolderUploadCountsSDO   `json:"counts"`
	TotalBytes         int64                   `json:"total_bytes" example:"123456"`
	ExpiresAt          string                  `json:"expires_at" description:"Lô hết hạn tải lên sau 24 giờ" example:"2026-10-22T02:00:00Z"`
	CreatedAt          string                  `json:"created_at" example:"2026-10-21T02:00:00Z"`
}

// FolderUploadContentSDO answers the server content route: the ETag of the
// stored bytes, also sent as the ETag header; COMPLETE takes it back as is.
type FolderUploadContentSDO struct {
	ETag string `json:"etag" description:"ETag của nội dung đã lưu (có dấu ngoặc kép), trùng header ETag" example:"\"9b2cf535f27731c974343645a3985328\""`
}

// FolderUploadFileResultSDO is one file's result in a COMPLETE.
type FolderUploadFileResultSDO struct {
	FileKey    string                `json:"file_key" example:"f-0001"`
	Status     string                `json:"status" description:"done | failed" example:"done"`
	DocumentID *string               `json:"document_id" description:"Tài liệu đã tạo khi done" example:"01J8X4DOC0N1P2Q3R4S5T6U7"`
	Error      *FolderUploadErrorSDO `json:"error" description:"Lỗi khi failed"`
}

// FolderUploadCompleteBatchSDO is the batch after a COMPLETE.
type FolderUploadCompleteBatchSDO struct {
	Status string                `json:"status" description:"open | completed | canceled | expired" example:"open"`
	Counts FolderUploadCountsSDO `json:"counts"`
}

// FolderUploadCompleteSDO answers a COMPLETE: one result per file sent, in
// the order sent, and the batch after the call.
type FolderUploadCompleteSDO struct {
	Results []FolderUploadFileResultSDO  `json:"results"`
	Batch   FolderUploadCompleteBatchSDO `json:"batch"`
}
