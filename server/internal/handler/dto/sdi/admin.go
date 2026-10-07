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

// PlanCreateSDI is POST /api/v1/admin/plans.
type PlanCreateSDI struct {
	Code          string `json:"code" minLength:"2" description:"Mã gói (chữ thường, số, _); không đổi sau khi tạo" example:"enterprise"`
	Name          string `json:"name" minLength:"1" description:"Tên hiển thị gói" example:"Enterprise"`
	Description   string `json:"description" description:"Mô tả ngắn" example:"Gói doanh nghiệp lớn"`
	BillingPeriod string `json:"billing_period" description:"month, year hoặc none" example:"month"`
	PriceAmount   *int64 `json:"price_amount" description:"Giá niêm yết; null = liên hệ" example:"999000"`
	PriceCurrency string `json:"price_currency" example:"VND"`
	IsActive      bool   `json:"is_active" description:"false = ẩn khỏi GET /plans cho đến khi bật" example:"true"`
	SortOrder     int32  `json:"sort_order" example:"10"`
	Reason        string `json:"reason" minLength:"10" description:"Lý do thêm gói mới" example:"Ra mắt gói Enterprise theo bảng giá Q4"`
}

// PlanUpsertSDI is PUT /api/v1/admin/plans/{code}.
type PlanUpsertSDI struct {
	Name          string `json:"name" minLength:"1" description:"Tên hiển thị gói" example:"Starter"`
	Description   string `json:"description" description:"Mô tả ngắn" example:"Gói mặc định cho mọi tổ chức"`
	BillingPeriod string `json:"billing_period" description:"month, year hoặc none" example:"none"`
	PriceAmount   *int64 `json:"price_amount" description:"Giá niêm yết; null = liên hệ" example:"0"`
	PriceCurrency string `json:"price_currency" example:"VND"`
	IsActive      bool   `json:"is_active" description:"false = ẩn khỏi GET /plans; không xóa hàng" example:"true"`
	SortOrder     int32  `json:"sort_order" example:"0"`
	Reason        string `json:"reason" minLength:"10" description:"Lý do chỉnh catalog" example:"Điều chỉnh giá Team theo bảng giá Q4"`
}

// PlanFeatureSDI is PUT /api/v1/admin/plans/{code}/features/{key}.
type PlanFeatureSDI struct {
	Enabled    bool   `json:"enabled" example:"true"`
	QuotaLimit *int64 `json:"quota_limit" description:"null = không giới hạn; chỉ với kind quota" example:"50"`
	Reason     string `json:"reason" minLength:"10" description:"Lý do chỉnh hạn mức" example:"Giảm quota AI trên Starter theo B1"`
}

// FlagOverrideDeleteSDI is DELETE /api/v1/admin/flags/{key}/overrides.
type FlagOverrideDeleteSDI struct {
	ScopeType string `json:"scope_type" enum:"organization,user,global" description:"Phạm vi override" example:"organization"`
	ScopeID   string `json:"scope_id" description:"ULID tổ chức/người dùng; rỗng với global" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Reason    string `json:"reason" minLength:"10" description:"Lý do xóa override" example:"Hết pilot, trả về mặc định"`
}
