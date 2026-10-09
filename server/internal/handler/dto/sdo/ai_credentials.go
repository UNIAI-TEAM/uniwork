package sdo

// Personal AI provider credentials (UNI-1008, ADR 0029). A credential never
// carries its key: key_hint is the last four characters at most.

// AICredentialSDO is one stored credential of the caller.
type AICredentialSDO struct {
	Provider  string `json:"provider" description:"Mã nhà cung cấp" example:"openai"`
	Label     string `json:"label" description:"Nhãn người dùng đặt" example:"Khóa công việc"`
	BaseURL   string `json:"base_url" description:"Endpoint riêng; rỗng = endpoint mặc định của nhà cung cấp" example:"https://api.example.com/v1"`
	KeyHint   string `json:"key_hint" description:"Dấu … và tối đa 4 ký tự cuối của khóa" example:"…cdef"`
	CreatedAt string `json:"created_at" description:"Thời điểm lưu lần đầu (RFC 3339)" example:"2026-10-09T08:00:00Z"`
	UpdatedAt string `json:"updated_at" description:"Thời điểm cập nhật gần nhất (RFC 3339)" example:"2026-10-09T08:00:00Z"`
}

// AIProviderSDO is one provider a credential may be saved for.
type AIProviderSDO struct {
	ID              string `json:"id" description:"Mã nhà cung cấp" example:"anthropic"`
	Protocol        string `json:"protocol" description:"openai-compatible, anthropic hoặc gemini" example:"anthropic"`
	RequiresBaseURL bool   `json:"requires_base_url" description:"true khi phải nhập base_url (custom)" example:"false"`
	DefaultBaseURL  string `json:"default_base_url" description:"Endpoint mặc định; rỗng với custom" example:"https://api.anthropic.com"`
}

// AICredentialListSDO is GET /api/v1/orgs/{orgID}/ai/credentials: the
// caller's credentials in that organization and the providers they can add.
type AICredentialListSDO struct {
	Items     []AICredentialSDO `json:"items"`
	Providers []AIProviderSDO   `json:"providers"`
}
