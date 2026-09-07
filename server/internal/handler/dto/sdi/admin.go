package sdi

// ReasonSDI is the body of every admin write that has no other input:
// suspend, unsuspend, delete override. Ten characters is the floor so the
// admin_actions row explains itself to the next reader.
type ReasonSDI struct {
	Reason string `json:"reason" minLength:"10" description:"Lý do thao tác (≥ 10 ký tự), ghi vào admin_actions" example:"Khách hàng chưa thanh toán hóa đơn 2026-08"`
}

// AdminChangePlanSDI is POST /api/v1/admin/organizations/{orgID}/plan.
type AdminChangePlanSDI struct {
	PlanCode string `json:"plan_code" minLength:"1" description:"Mã gói đích (plans.code)" example:"team"`
	Reason   string `json:"reason" minLength:"10" description:"Lý do đổi gói thủ công" example:"Pilot đối tác theo hợp đồng 2026-09"`
}

// FlagOverrideSDI is PUT /api/v1/admin/flags/{key}/overrides.
type FlagOverrideSDI struct {
	ScopeType string `json:"scope_type" enum:"organization,user,global" description:"Phạm vi override" example:"organization"`
	ScopeID   string `json:"scope_id" description:"ULID tổ chức/người dùng; rỗng với global" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Enabled   bool   `json:"enabled" description:"Giá trị override" example:"true"`
	ExpiresAt string `json:"expires_at,omitempty" description:"RFC 3339; bắt buộc và ≤ 30 ngày với scope user" example:"2026-10-01T00:00:00Z"`
	Reason    string `json:"reason" minLength:"10" description:"Lý do (ghi vào note và admin_actions)" example:"Bật thử cho org pilot theo yêu cầu CS"`
}

// FlagOverrideDeleteSDI is DELETE /api/v1/admin/flags/{key}/overrides.
type FlagOverrideDeleteSDI struct {
	ScopeType string `json:"scope_type" enum:"organization,user,global" description:"Phạm vi override" example:"organization"`
	ScopeID   string `json:"scope_id" description:"ULID tổ chức/người dùng; rỗng với global" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Reason    string `json:"reason" minLength:"10" description:"Lý do xóa override" example:"Hết pilot, trả về mặc định"`
}
