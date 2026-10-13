package sdo

// PrivacyExportDTO is one organization data export.
type PrivacyExportDTO struct {
	ID          string  `json:"id" example:"01J8X4EXPORT0N1P2Q3R4S5T"`
	Kind        string  `json:"kind" description:"export hoặc delete" example:"export"`
	Status      string  `json:"status" description:"pending, running, done hoặc failed" example:"done"`
	RowCount    int32   `json:"row_count" example:"1204"`
	DownloadURL *string `json:"download_url,omitempty" description:"Có khi status = done còn hạn; đường dẫn API tải cần Bearer" example:"/api/v1/orgs/…/privacy/exports/…/download"`
	Error       *string `json:"error,omitempty"`
	CreatedAt   string  `json:"created_at" example:"2026-10-12T02:00:00Z"`
	ExpiresAt   *string `json:"expires_at,omitempty" description:"Link tải hết hạn sau 24 giờ" example:"2026-10-13T02:00:00Z"`
	ErasesAt    *string `json:"erases_at,omitempty" description:"Có khi kind = delete và chưa chạy: thời điểm job xóa cứng" example:"2026-10-17T02:00:00Z"`
}

// PrivacyExportSDO wraps one export.
type PrivacyExportSDO struct {
	Export PrivacyExportDTO `json:"export"`
}

// PrivacyExportListSDO lists recent exports.
type PrivacyExportListSDO struct {
	Exports []PrivacyExportDTO `json:"exports"`
}
