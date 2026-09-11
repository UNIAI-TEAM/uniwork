package sdo

// AuditEventDTO is one row of the immutable log as a reader sees it.
//
// ip_address is present only for an organization owner; an admin receives
// null. The address is personal data under Nghị định 13 and is not needed to
// answer "who changed what" (OPEN_QUESTIONS A2).
type AuditEventDTO struct {
	ID             string         `json:"id" description:"ULID bản ghi" example:"01J8X4AUDIT0N1P2Q3R4S5T6"`
	OrganizationID string         `json:"organization_id" example:"01J8X4ORG0N1P2Q3R4S5T6U7"`
	WorkspaceID    *string        `json:"workspace_id,omitempty" description:"Rỗng với sự kiện cấp tổ chức" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	ActorKind      string         `json:"actor_kind" description:"human, agent hoặc system" example:"human"`
	ActorID        string         `json:"actor_id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Action         string         `json:"action" description:"Tên hành động dạng <thực thể>.<động từ>" example:"task.updated"`
	ResourceType   string         `json:"resource_type" example:"task"`
	ResourceID     string         `json:"resource_id" example:"01J8X4TASKN1P2Q3R4S5T6U7"`
	Changes        map[string]any `json:"changes" description:"Chỉ các trường đã đổi, dạng {trường: {from, to}}"`
	Metadata       map[string]any `json:"metadata" description:"Ngữ cảnh thêm, không chứa dữ liệu cá nhân"`
	CorrelationID  string         `json:"correlation_id" description:"Nối một thao tác qua HTTP, DB, sự kiện và log" example:"01J8X4CORR0N1P2Q3R4S5T6"`
	IPAddress      *string        `json:"ip_address,omitempty" description:"Chỉ chủ sở hữu tổ chức nhìn thấy" example:"203.0.113.7"`
	UserAgent      *string        `json:"user_agent,omitempty" example:"Mozilla/5.0"`
	OccurredAt     string         `json:"occurred_at" example:"2026-09-04T09:00:00Z"`
}

// AuditEventListSDO is a cursor page of the organization log.
type AuditEventListSDO struct {
	Events []AuditEventDTO `json:"events"`
	// NextBefore is the cursor for the next page, empty on the last one.
	NextBefore string `json:"next_before" description:"Con trỏ trang kế; rỗng khi đã hết" example:"01J8X4AUDIT0N1P2Q3R4S5T6"`
}

// AuditEventSDO wraps one row.
type AuditEventSDO struct {
	Event AuditEventDTO `json:"event"`
}

// AuditRetentionSDO is the organization's retention window.
type AuditRetentionSDO struct {
	RetainDays int32 `json:"retain_days" description:"Số ngày giữ nhật ký, 30–730" example:"90"`
}

// AuditExportDTO is one export job.
type AuditExportDTO struct {
	ID          string  `json:"id" example:"01J8X4EXPORT0N1P2Q3R4S5T"`
	Format      string  `json:"format" description:"csv hoặc json" example:"csv"`
	FromAt      string  `json:"from_at" example:"2026-08-01T00:00:00Z"`
	ToAt        string  `json:"to_at" example:"2026-09-01T00:00:00Z"`
	Status      string  `json:"status" description:"pending, running, done hoặc failed" example:"done"`
	RowCount    int32   `json:"row_count" example:"1204"`
	DownloadURL *string `json:"download_url,omitempty" description:"Có khi status = done" example:"https://cdn.example.com/audit-exports/…"`
	Error       *string `json:"error,omitempty" example:"khoảng thời gian quá lớn"`
	CreatedAt   string  `json:"created_at" example:"2026-09-04T09:00:00Z"`
	ExpiresAt   *string `json:"expires_at,omitempty" description:"Link tải hết hạn sau 24 giờ" example:"2026-09-05T09:00:00Z"`
}

// AuditExportSDO wraps one export job.
type AuditExportSDO struct {
	Export AuditExportDTO `json:"export"`
}

// AuditExportListSDO lists recent export jobs.
type AuditExportListSDO struct {
	Exports []AuditExportDTO `json:"exports"`
}
