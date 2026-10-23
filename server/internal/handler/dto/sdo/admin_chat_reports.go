package sdo

// AdminChatReportDTO is one row of the operator's queue of chat reports (store UGC policy): ids, the reason, the
// status and when. Never the reporter's own words or the reported message — the console reads no content.
type AdminChatReportDTO struct {
	ID                 string  `json:"id" description:"ULID của báo cáo" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	OrganizationID     string  `json:"organization_id" description:"ULID tổ chức của cuộc trò chuyện" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	OrganizationSlug   string  `json:"organization_slug" description:"Slug tổ chức" example:"acme"`
	OrganizationName   string  `json:"organization_name" description:"Tên tổ chức" example:"Acme"`
	OrganizationStatus string  `json:"organization_status" description:"active | suspended | closed | deleted" example:"active"`
	WorkspaceID        string  `json:"workspace_id" description:"ULID workspace nơi báo cáo được gửi" example:"01J8X4WSP0N1P2Q3R4S5T6U7V8"`
	RoomID             *string `json:"room_id,omitempty" description:"ULID cuộc trò chuyện khi báo cáo một tin nhắn" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V"`
	MessageID          *string `json:"message_id,omitempty" description:"ULID tin nhắn bị báo cáo; vắng khi báo cáo một người" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	TargetUserID       string  `json:"target_user_id" description:"ULID người bị báo cáo (người gửi tin)" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	ReporterID         string  `json:"reporter_id" description:"ULID người gửi báo cáo" example:"01J8X4REP0N1P2Q3R4S5T6U7V8"`
	Reason             string  `json:"reason" description:"spam | harassment | hate | sexual | violence | self_harm | other" example:"harassment"`
	Status             string  `json:"status" description:"open | resolved" example:"open"`
	CreatedAt          string  `json:"created_at" description:"Thời điểm gửi (RFC 3339)" example:"2026-10-22T08:00:00Z"`
}

// AdminChatReportListSDO is GET /api/v1/admin/chat-reports.
type AdminChatReportListSDO struct {
	Reports      []AdminChatReportDTO `json:"reports"`
	Total        int64                `json:"total" description:"Số báo cáo khớp bộ lọc" example:"3"`
	OpenCount    int64                `json:"open_count" description:"Số báo cáo đang chờ xử lý trên mọi tổ chức" example:"1"`
	OldestOpenAt *string              `json:"oldest_open_at,omitempty" description:"Thời điểm của báo cáo chờ lâu nhất (RFC 3339); vắng khi không còn báo cáo nào chờ" example:"2026-10-22T08:00:00Z"`
}

// AdminChatReportSDO is POST /api/v1/admin/chat-reports/{chatReportID}/resolve.
type AdminChatReportSDO struct {
	ID     string `json:"id" description:"ULID của báo cáo" example:"01J8X4K2M0N1P2Q3R4S5T6U7VA"`
	Status string `json:"status" description:"resolved sau khi xử lý" example:"resolved"`
}
