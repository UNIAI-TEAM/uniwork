package sdo

// AdminMeSDO is GET /api/v1/admin/me.
type AdminMeSDO struct {
	PlatformRole string `json:"platform_role" description:"admin | support" example:"admin"`
}

// AdminOrganizationDTO is one row of the console's organizations table.
// Metadata only: no member list, no content (OPEN_QUESTIONS O2).
type AdminOrganizationDTO struct {
	ID             string  `json:"id" description:"ULID tổ chức" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Slug           string  `json:"slug" example:"acme"`
	Name           string  `json:"name" example:"Acme"`
	Status         string  `json:"status" description:"active | suspended | archived" example:"active"`
	PlanCode       string  `json:"plan_code" example:"free"`
	MemberCount    int64   `json:"member_count" example:"12"`
	WorkspaceCount int64   `json:"workspace_count" example:"3"`
	CreatedAt      string  `json:"created_at" example:"2026-09-01T08:00:00Z"`
	LastActivityAt *string `json:"last_activity_at" description:"Audit row gần nhất; null khi chưa có" example:"2026-09-06T09:30:00Z"`
}

// AdminOrganizationListSDO is GET /api/v1/admin/organizations. Total counts
// the whole filtered set, not the page, so the console can page through it.
type AdminOrganizationListSDO struct {
	Organizations []AdminOrganizationDTO `json:"organizations"`
	Total         int64                  `json:"total" description:"Tổng số tổ chức khớp bộ lọc" example:"128"`
	Limit         int32                  `json:"limit" description:"Kích thước trang đã áp dụng" example:"50"`
	Offset        int32                  `json:"offset" description:"Vị trí bắt đầu của trang" example:"0"`
}

// AdminEntitlementDTO mirrors the org's entitlement snapshot for the Quota tab.
type AdminEntitlementDTO struct {
	Key     string `json:"key" example:"members"`
	Kind    string `json:"kind" description:"flag | quota" example:"quota"`
	Enabled bool   `json:"enabled" example:"true"`
	Limit   *int64 `json:"limit" description:"null = không giới hạn" example:"50"`
	Current int64  `json:"current" example:"12"`
}

// AdminActionDTO is one admin_actions row.
type AdminActionDTO struct {
	ID         string         `json:"id" example:"01J8X4ACT0N1P2Q3R4S5T6U7V8"`
	ActorID    string         `json:"actor_id" description:"User id hoặc cli" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	Action     string         `json:"action" example:"organization.suspended"`
	TargetType string         `json:"target_type" example:"organization"`
	TargetID   string         `json:"target_id" example:"01J8X4ORG0N1P2Q3R4S5T6U7V8"`
	Before     map[string]any `json:"before"`
	After      map[string]any `json:"after"`
	Reason     string         `json:"reason" example:"Khách hàng chưa thanh toán"`
	TraceID    string         `json:"trace_id" example:"0af7651916cd43dd8448eb211c80319c"`
	CreatedAt  string         `json:"created_at" example:"2026-09-06T09:30:00Z"`
}

// AdminOrganizationDetailSDO is GET /api/v1/admin/organizations/{orgID}.
type AdminOrganizationDetailSDO struct {
	Organization    AdminOrganizationDTO  `json:"organization"`
	SuspendedAt     *string               `json:"suspended_at" example:"2026-09-06T09:30:00Z"`
	SuspendedReason *string               `json:"suspended_reason" example:"Khách hàng chưa thanh toán"`
	Entitlements    []AdminEntitlementDTO `json:"entitlements"`
	Actions         []AdminActionDTO      `json:"actions" description:"20 thao tác admin gần nhất"`
}

// AdminOrganizationSDO wraps one organization after a write.
type AdminOrganizationSDO struct {
	Organization AdminOrganizationDTO `json:"organization"`
}

// AdminTraceAuditDTO is an audit_events row on the trace timeline.
type AdminTraceAuditDTO struct {
	ID             string `json:"id"`
	OrganizationID string `json:"organization_id"`
	WorkspaceID    string `json:"workspace_id"`
	ActorKind      string `json:"actor_kind" example:"human"`
	ActorID        string `json:"actor_id"`
	Action         string `json:"action" example:"task.updated"`
	ResourceType   string `json:"resource_type" example:"task"`
	ResourceID     string `json:"resource_id"`
	OccurredAt     string `json:"occurred_at" example:"2026-09-06T09:30:00Z"`
}

// AdminTraceOutboxDTO is an outbox_events row on the trace timeline.
type AdminTraceOutboxDTO struct {
	ID        string `json:"id"`
	Topic     string `json:"topic" example:"task.updated"`
	Status    string `json:"status" example:"DONE"`
	Attempts  int32  `json:"attempts" example:"1"`
	LastError string `json:"last_error"`
	CreatedAt string `json:"created_at" example:"2026-09-06T09:30:00Z"`
	DoneAt    string `json:"done_at"`
	DeadAt    string `json:"dead_at"`
}

// AdminTraceSDO is GET /api/v1/admin/trace/{traceID}: everything the server
// stored under one trace id, at most 500 rows per table.
type AdminTraceSDO struct {
	TraceID string                `json:"trace_id" example:"0af7651916cd43dd8448eb211c80319c"`
	Audit   []AdminTraceAuditDTO  `json:"audit"`
	Outbox  []AdminTraceOutboxDTO `json:"outbox"`
	Actions []AdminActionDTO      `json:"actions"`
}

// AdminSystemSDO is GET /api/v1/admin/system.
type AdminSystemSDO struct {
	Version           string       `json:"version" example:"1.4.0"`
	Commit            string       `json:"commit" example:"2b47dca"`
	MigrationEmbedded string       `json:"migration_embedded" example:"106_organizations_status_idx"`
	Readiness         ReadinessSDO `json:"readiness"`
	OutboxPending     int64        `json:"outbox_pending" example:"3"`
	OutboxDead        int64        `json:"outbox_dead" example:"0"`
	OutboxOldestAge   float64      `json:"outbox_oldest_pending_age_seconds" example:"1.5"`
	RealtimeConns     int64        `json:"realtime_connections" example:"42"`
	FlagProviders     []string     `json:"flag_providers" description:"Chuỗi provider theo thứ tự ưu tiên" example:"[\"db\",\"static\",\"env\"]"`
}

// AdminFlagDTO is one catalogue entry with its override count.
type AdminFlagDTO struct {
	Key           string `json:"key" example:"agents_assignee"`
	Description   string `json:"description" example:"Hiện agent trong picker assignee"`
	Default       bool   `json:"default" example:"false"`
	Public        bool   `json:"public" description:"Gửi xuống web qua /config" example:"true"`
	Owner         string `json:"owner" example:"platform"`
	ReviewAt      string `json:"review_at" example:"2026-12-01"`
	OverrideCount int64  `json:"override_count" example:"2"`
}

// AdminFlagListSDO is GET /api/v1/admin/flags.
type AdminFlagListSDO struct {
	Flags []AdminFlagDTO `json:"flags"`
}

// AdminFlagOverrideDTO is one feature_flag_overrides row.
type AdminFlagOverrideDTO struct {
	ID        string `json:"id"`
	FlagKey   string `json:"flag_key" example:"agents_assignee"`
	ScopeType string `json:"scope_type" example:"organization"`
	ScopeID   string `json:"scope_id"`
	Enabled   bool   `json:"enabled" example:"true"`
	Note      string `json:"note"`
	CreatedBy string `json:"created_by"`
	CreatedAt string `json:"created_at" example:"2026-09-06T09:30:00Z"`
	ExpiresAt string `json:"expires_at" example:"2026-10-01T00:00:00Z"`
}

// AdminFlagOverrideListSDO is GET/PUT /api/v1/admin/flags/{key}/overrides.
type AdminFlagOverrideListSDO struct {
	Overrides []AdminFlagOverrideDTO `json:"overrides"`
}

// AdminPlanFeatureDTO is one entitlement row on a catalog plan.
type AdminPlanFeatureDTO struct {
	FeatureKey string `json:"feature_key" example:"members.max"`
	Name       string `json:"name" example:"Thành viên tổ chức"`
	Kind       string `json:"kind" description:"flag | quota" example:"quota"`
	Unit       string `json:"unit,omitempty" example:"members"`
	Enabled    bool   `json:"enabled" example:"true"`
	QuotaLimit *int64 `json:"quota_limit" description:"null = không giới hạn" example:"50"`
}

// AdminPlanDTO is one row of the billing catalog (includes inactive plans).
type AdminPlanDTO struct {
	ID            string                `json:"id" example:"01K4F02PLAN0STARTER000000A"`
	Code          string                `json:"code" example:"starter"`
	Name          string                `json:"name" example:"Starter"`
	Description   string                `json:"description" example:"Gói mặc định cho mọi tổ chức"`
	BillingPeriod string                `json:"billing_period" description:"month, year hoặc none" example:"none"`
	PriceAmount   *int64                `json:"price_amount" description:"Đơn vị nhỏ nhất (VND: đồng); null = liên hệ" example:"0"`
	PriceCurrency string                `json:"price_currency" example:"VND"`
	IsDefault     bool                  `json:"is_default" example:"true"`
	IsActive      bool                  `json:"is_active" example:"true"`
	SortOrder     int32                 `json:"sort_order" example:"0"`
	Features      []AdminPlanFeatureDTO `json:"features"`
}

// AdminPlanListSDO is GET /api/v1/admin/plans.
type AdminPlanListSDO struct {
	Plans []AdminPlanDTO `json:"plans"`
}

// AdminPlanSDO is PUT /api/v1/admin/plans/{code} and feature updates.
type AdminPlanSDO struct {
	Plan AdminPlanDTO `json:"plan"`
}

// AdminInvoiceDTO is one invoice row with organization metadata.
type AdminInvoiceDTO struct {
	ID              string `json:"id"`
	OrganizationID  string `json:"organization_id"`
	OrgSlug         string `json:"org_slug" example:"acme"`
	OrgName         string `json:"org_name" example:"Acme"`
	Number          string `json:"number" example:"UW-2026-01ABC12345"`
	Status          string `json:"status" example:"paid"`
	Provider        string `json:"provider" example:"vnpay"`
	AmountPaid      int64  `json:"amount_paid" example:"499000"`
	Currency        string `json:"currency" example:"VND"`
	PeriodStart     string `json:"period_start" example:"2026-09-06T00:00:00Z"`
	PeriodEnd       string `json:"period_end" example:"2026-10-06T00:00:00Z"`
	PaidAt          string `json:"paid_at,omitempty" example:"2026-09-06T12:00:00Z"`
	CreatedAt       string `json:"created_at" example:"2026-09-06T12:00:00Z"`
	UserID          string `json:"user_id,omitempty" description:"Người bắt đầu checkout; fallback chủ tổ chức"`
	UserDisplayName string `json:"user_display_name,omitempty" example:"Nguyễn Văn A"`
	UserEmail       string `json:"user_email,omitempty" example:"owner@example.com"`
}

// AdminInvoiceListSDO is GET /api/v1/admin/invoices.
type AdminInvoiceListSDO struct {
	Invoices []AdminInvoiceDTO `json:"invoices"`
	Total    int64             `json:"total" example:"128"`
	Limit    int32             `json:"limit" example:"50"`
	Offset   int32             `json:"offset" example:"0"`
}

// AdminPaymentIntentDTO is one checkout intent for support.
type AdminPaymentIntentDTO struct {
	ID              string `json:"id"`
	OrganizationID  string `json:"organization_id"`
	OrgSlug         string `json:"org_slug" example:"acme"`
	OrgName         string `json:"org_name" example:"Acme"`
	PlanCode        string `json:"plan_code" example:"team"`
	Provider        string `json:"provider" example:"vnpay"`
	ProviderTxnRef  string `json:"provider_txn_ref" example:"UW1700000000"`
	Amount          int64  `json:"amount" example:"499000"`
	Currency        string `json:"currency" example:"VND"`
	Status          string `json:"status" description:"pending | completed | failed | expired" example:"completed"`
	ExpiresAt       string `json:"expires_at" example:"2026-09-06T13:00:00Z"`
	CompletedAt     string `json:"completed_at,omitempty"`
	CreatedAt       string `json:"created_at" example:"2026-09-06T12:00:00Z"`
	UserID          string `json:"user_id,omitempty"`
	UserDisplayName string `json:"user_display_name,omitempty"`
	UserEmail       string `json:"user_email,omitempty"`
}

// AdminPaymentIntentListSDO is GET /api/v1/admin/billing/payment-intents.
type AdminPaymentIntentListSDO struct {
	Intents []AdminPaymentIntentDTO `json:"intents"`
	Total   int64                   `json:"total" example:"64"`
	Limit   int32                   `json:"limit" example:"50"`
	Offset  int32                   `json:"offset" example:"0"`
}
