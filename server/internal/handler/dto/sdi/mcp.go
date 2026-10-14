package sdi

// McpConsentSDI is POST /api/v1/auth/connect/attempts/{attemptID}: the
// person's decision on an AI app's request to connect (MCP connector,
// ADR 0031).
type McpConsentSDI struct {
	Decision       string `json:"decision" description:"approve hoặc cancel" example:"approve"`
	CSRFToken      string `json:"csrf_token" description:"Token CSRF lấy từ lần đọc attempt gần nhất" example:"m3Vq0tFz9kE"`
	OrganizationID string `json:"organization_id,omitempty" description:"ULID tổ chức được chia sẻ; bắt buộc khi approve, bỏ qua khi cancel" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
}

// McpPolicySDI is PUT /api/v1/orgs/{org}/mcp-policy.
type McpPolicySDI struct {
	Enabled bool `json:"enabled" description:"Cho phép trợ lý AI bên ngoài truy cập tổ chức" example:"true"`
}
