package sdo

// FileSDO is the technical view of one file: never the storage key, bucket,
// credential or upload scope.
type FileSDO struct {
	ID          string         `json:"id" description:"ULID tệp" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	Filename    string         `json:"filename" description:"Tên tệp chung, dùng cho hiển thị và Content-Disposition" example:"bao-cao.pdf"`
	ContentType string         `json:"content_type" description:"MIME đã xác minh từ nội dung" example:"application/pdf"`
	SizeBytes   int64          `json:"size_bytes" description:"Kích thước bytes" example:"245760"`
	Status      string         `json:"status" description:"Trạng thái vòng đời tệp" example:"ready"`
	Metadata    map[string]any `json:"metadata,omitempty" description:"Thuộc tính kỹ thuật có phiên bản (width, height, duration_ms...)"`
	ReadyAt     *string        `json:"ready_at" description:"RFC3339, lúc tệp sẵn sàng" example:"2026-09-26T10:00:00Z"`
}

// FileAccessItemSDO is one entry of a resolve batch, in request order. Either
// error is set and file/url are empty, or file and url are set.
type FileAccessItemSDO struct {
	FileID       string       `json:"file_id" description:"ULID tệp đã yêu cầu" example:"01J8X4FILEN1P2Q3R4S5T6U7V8"`
	File         *FileSDO     `json:"file" description:"Metadata tệp; null khi có lỗi"`
	Access       string       `json:"access,omitempty" enum:"presign,proxy" description:"presign: URL ký lộ host/đường dẫn storage; proxy: URL API che vị trí lưu" example:"proxy"`
	URL          string       `json:"url,omitempty" description:"URL đọc; không lưu vào nội dung, không tự làm mới khi hết hạn" example:"/api/v1/files/01J8X4FILEN1P2Q3R4S5T6U7V8/content?ticket=..."`
	URLExpiresAt *string      `json:"url_expires_at" description:"RFC3339; tối đa 12 giờ, sớm hơn nếu phiên tải lên/phiên đăng nhập hết trước" example:"2026-09-26T22:00:00Z"`
	Error        *ErrorDetail `json:"error" description:"Lỗi riêng của tệp này (file_not_found, file_deleting, file_claim_expired...); null khi thành công"`
}

// ResolveFilesSDO is POST /api/v1/workspaces/{workspaceID}/files/resolve.
type ResolveFilesSDO struct {
	Items []FileAccessItemSDO `json:"items"`
}
