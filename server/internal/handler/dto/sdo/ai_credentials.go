package sdo

// Personal AI provider credentials (UNI-1008, ADR 0029). A credential never
// carries its key: key_hint is the last four characters at most.

// AICredentialSDO is one stored credential of the caller.
type AICredentialSDO struct {
	Provider       string `json:"provider" description:"Mã nhà cung cấp" example:"openai"`
	Label          string `json:"label" description:"Nhãn người dùng đặt" example:"Khóa công việc"`
	BaseURL        string `json:"base_url" description:"Endpoint riêng; rỗng = endpoint mặc định của nhà cung cấp" example:"https://api.example.com/v1"`
	KeyHint        string `json:"key_hint" description:"Dấu … và tối đa 4 ký tự cuối của khóa" example:"…cdef"`
	Model          string `json:"model" description:"Model người dùng đã chọn cho nhà cung cấp này; rỗng = chưa chọn" example:"gpt-4.1-mini"`
	ModelUpdatedAt string `json:"model_updated_at" description:"Lần chọn model gần nhất (RFC 3339), rỗng khi chưa chọn; nhà cung cấp có model chọn gần nhất là mặc định" example:"2026-10-11T08:00:00Z"`
	CreatedAt      string `json:"created_at" description:"Thời điểm lưu lần đầu (RFC 3339)" example:"2026-10-09T08:00:00Z"`
	UpdatedAt      string `json:"updated_at" description:"Thời điểm cập nhật gần nhất (RFC 3339)" example:"2026-10-09T08:00:00Z"`
}

// AIProviderSDO is one provider a credential may be saved for.
type AIProviderSDO struct {
	ID              string `json:"id" description:"Mã nhà cung cấp" example:"anthropic"`
	Protocol        string `json:"protocol" description:"openai-compatible, anthropic hoặc gemini" example:"anthropic"`
	RequiresBaseURL bool   `json:"requires_base_url" description:"true khi phải nhập base_url (custom)" example:"false"`
	DefaultBaseURL  string `json:"default_base_url" description:"Endpoint mặc định; rỗng với custom" example:"https://api.anthropic.com"`
}

// AIBYOKStatusDTO reports whether the caller may use the BYOK proxy in this
// organization now (G6-05k, ADR 0034).
type AIBYOKStatusDTO struct {
	Enabled bool   `json:"enabled" description:"true khi người gọi dùng được proxy BYOK trong tổ chức này (thành viên, gói có office.ai_byok, kho khóa đã cấu hình)" example:"true"`
	Reason  string `json:"reason" description:"Rỗng khi enabled; ngược lại là mã lý do (entitlement_required, subscription_inactive, ai_credentials_unavailable)" example:""`
}

// AICredentialListSDO is GET /api/v1/orgs/{orgID}/ai/credentials: the
// caller's credentials in that organization, the providers they can add, and
// whether the BYOK proxy is enabled for them there.
type AICredentialListSDO struct {
	Items     []AICredentialSDO `json:"items"`
	Providers []AIProviderSDO   `json:"providers"`
	BYOK      AIBYOKStatusDTO   `json:"byok"`
}
