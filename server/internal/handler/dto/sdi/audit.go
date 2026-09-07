package sdi

// SetAuditRetentionSDI sets how long an organization keeps its log.
type SetAuditRetentionSDI struct {
	RetainDays int32 `json:"retain_days" description:"Số ngày giữ nhật ký, từ 30 đến 730" example:"180" required:"true"`
}

// CreateAuditExportSDI asks for a file of the log over a time range.
type CreateAuditExportSDI struct {
	Format string `json:"format" description:"csv hoặc json" example:"csv" required:"true"`
	From   string `json:"from" description:"Mốc đầu, RFC3339" example:"2026-08-01T00:00:00Z" required:"true"`
	To     string `json:"to" description:"Mốc cuối, RFC3339" example:"2026-09-01T00:00:00Z" required:"true"`
}
