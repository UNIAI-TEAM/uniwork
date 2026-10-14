package sdo

// McpConsentClientSDO is the AI app asking to connect, as the consent screen
// shows it.
type McpConsentClientSDO struct {
	ClientID string `json:"client_id" description:"client_id OAuth" example:"mcpc_01J8X4CLI0N1P2Q3R4S5T6U7V8"`
	Name     string `json:"name" description:"Tên client tự khai" example:"Claude"`
	LogoURI  string `json:"logo_uri" description:"Logo https hoặc rỗng" example:"https://claude.ai/logo.png"`
	Verified bool   `json:"verified" description:"Mọi redirect thuộc host đã xác minh" example:"true"`
}

// McpConsentOrgSDO is one organization the person may share.
type McpConsentOrgSDO struct {
	ID      string `json:"id" description:"ULID tổ chức" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Slug    string `json:"slug" description:"Slug tổ chức" example:"acme"`
	Name    string `json:"name" description:"Tên tổ chức" example:"Acme"`
	Enabled bool   `json:"enabled" description:"Tổ chức đã bật connector" example:"true"`
	Reason  string `json:"reason" description:"Lý do không chọn được: connector_disabled hoặc rỗng" example:"connector_disabled"`
}

// McpConsentSDO is GET /api/v1/auth/connect/attempts/{attemptID}. Once the
// attempt has ended, client is null, organizations is empty and csrf_token is
// empty: only status says how it ended.
type McpConsentSDO struct {
	AttemptID     string               `json:"attempt_id" description:"ULID yêu cầu kết nối" example:"01J8X4ATT0N1P2Q3R4S5T6U7V8"`
	Status        string               `json:"status" description:"pending | approved | cancelled | expired" example:"pending"`
	Client        *McpConsentClientSDO `json:"client" description:"Client OAuth; null khi attempt đã kết thúc"`
	RedirectHost  string               `json:"redirect_host" description:"Host nhận code" example:"claude.ai"`
	Scope         string               `json:"scope" description:"Scope xin cấp" example:"read"`
	Organizations []McpConsentOrgSDO   `json:"organizations" description:"Tổ chức người dùng có thể chọn"`
	CSRFToken     string               `json:"csrf_token" description:"Token CSRF cho lệnh POST; rỗng khi attempt đã kết thúc" example:"m3Vq0tFz9kE"`
}

// McpConsentResultSDO is the answer to the person's decision.
type McpConsentResultSDO struct {
	Status     string `json:"status" description:"approved | cancelled" example:"approved"`
	RedirectTo string `json:"redirect_to" description:"URL trả về client AI kèm code hoặc error" example:"https://claude.ai/api/mcp/auth_callback?code=x&state=y"`
}

// McpGrantSDO is one live connection between a person, an AI app and an
// organization. No email is ever part of it.
type McpGrantSDO struct {
	ID               string  `json:"id" description:"ULID grant" example:"01J8X4GRT0N1P2Q3R4S5T6U7V8"`
	OrganizationID   string  `json:"organization_id" description:"ULID tổ chức" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	OrganizationName string  `json:"organization_name" description:"Tên tổ chức (danh sách của chính người dùng)" example:"Acme"`
	UserID           string  `json:"user_id" description:"ULID người đồng ý" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	UserName         string  `json:"user_name" description:"Tên người đồng ý (danh sách của tổ chức)" example:"Minh Nguyễn"`
	ClientID         string  `json:"client_id" description:"client_id OAuth" example:"mcpc_01J8X4CLI0N1P2Q3R4S5T6U7V8"`
	ClientName       string  `json:"client_name" description:"Tên client" example:"Claude"`
	Verified         bool    `json:"verified" description:"Client đã xác minh" example:"true"`
	Scope            string  `json:"scope" description:"Scope" example:"read"`
	CreatedAt        string  `json:"created_at" description:"RFC 3339" example:"2026-10-12T08:00:00Z"`
	LastUsedAt       *string `json:"last_used_at" description:"RFC 3339 hoặc null" example:"2026-10-12T09:00:00Z"`
}

// McpGrantListSDO is GET /api/v1/me/connected-apps and
// GET /api/v1/orgs/{org}/connected-apps.
type McpGrantListSDO struct {
	Grants []McpGrantSDO `json:"grants" description:"Grant đang hiệu lực"`
	McpURL string        `json:"mcp_url" description:"URL dán vào client AI" example:"https://api.uniwork.vn/mcp"`
}

// McpPolicySDO is the organization's MCP switch.
type McpPolicySDO struct {
	Enabled   bool    `json:"enabled" description:"Connector đang bật" example:"true"`
	Available bool    `json:"available" description:"Nền tảng đã mở connector cho tổ chức" example:"true"`
	EnabledAt *string `json:"enabled_at" description:"RFC 3339 hoặc null" example:"2026-10-12T08:00:00Z"`
	EnabledBy string  `json:"enabled_by" description:"ULID người bật" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	McpURL    string  `json:"mcp_url" description:"URL dán vào client AI" example:"https://api.uniwork.vn/mcp"`

	WriteEnabled   bool    `json:"write_enabled" description:"Ứng dụng AI được tạo và sửa" example:"false"`
	WriteAvailable bool    `json:"write_available" description:"Nền tảng đã mở quyền ghi cho tổ chức" example:"true"`
	WriteEnabledAt *string `json:"write_enabled_at" description:"RFC 3339 hoặc null" example:"2026-10-14T08:00:00Z"`
	WriteEnabledBy string  `json:"write_enabled_by" description:"ULID người bật" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
}
