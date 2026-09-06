package sdo

// PlanFeatureDTO is one row of plan_features.
type PlanFeatureDTO struct {
	FeatureKey string `json:"feature_key" example:"members.max"`
	Enabled    bool   `json:"enabled" example:"true"`
	QuotaLimit *int64 `json:"quota_limit" description:"null = không giới hạn; 0 = tắt" example:"50"`
}

type PlanDTO struct {
	ID            string           `json:"id" example:"01K4F02PLAN0STARTER000000A"`
	Code          string           `json:"code" example:"starter"`
	Name          string           `json:"name" example:"Starter"`
	Description   string           `json:"description" example:"Gói mặc định cho mọi tổ chức"`
	BillingPeriod string           `json:"billing_period" description:"month, year hoặc none" example:"none"`
	PriceAmount   *int64           `json:"price_amount" description:"Đơn vị nhỏ nhất (VND: đồng); null = liên hệ" example:"0"`
	PriceCurrency string           `json:"price_currency" example:"VND"`
	IsDefault     bool             `json:"is_default" example:"true"`
	Features      []PlanFeatureDTO `json:"features"`
}

// PlanListSDO is GET /api/v1/plans.
type PlanListSDO struct {
	Plans []PlanDTO `json:"plans"`
}

type SubscriptionDTO struct {
	ID                 string `json:"id" example:"01K4F02SUB0N1P2Q3R4S5T6U7V"`
	PlanCode           string `json:"plan_code" example:"starter"`
	PlanName           string `json:"plan_name" example:"Starter"`
	Status             string `json:"status" description:"trialing, active, past_due, suspended hoặc canceled" example:"active"`
	Provider           string `json:"provider" description:"manual, stripe hoặc payos" example:"manual"`
	CurrentPeriodStart string `json:"current_period_start" example:"2026-09-06T00:00:00Z"`
	CurrentPeriodEnd   string `json:"current_period_end,omitempty" example:"2026-10-06T00:00:00Z"`
	CancelAt           string `json:"cancel_at,omitempty" example:"2026-10-06T00:00:00Z"`
	TrialEndsAt        string `json:"trial_ends_at,omitempty" example:"2026-09-20T00:00:00Z"`
	RowVersion         int32  `json:"row_version" example:"1"`
}

// EntitlementDTO is one feature as it applies to the organization now.
type EntitlementDTO struct {
	FeatureKey   string `json:"feature_key" example:"members.max"`
	Name         string `json:"name" example:"Thành viên tổ chức"`
	Kind         string `json:"kind" description:"flag hoặc quota" example:"quota"`
	Unit         string `json:"unit,omitempty" example:"members"`
	Category     string `json:"category" example:"organization"`
	Enabled      bool   `json:"enabled" example:"true"`
	QuotaLimit   *int64 `json:"quota_limit" description:"null = không giới hạn" example:"50"`
	CurrentUsage int64  `json:"current_usage" example:"12"`
}

// SubscriptionSDO is GET /api/v1/orgs/{orgID}/billing and the plan mutations.
type SubscriptionSDO struct {
	Subscription SubscriptionDTO  `json:"subscription"`
	Entitlements []EntitlementDTO `json:"entitlements"`
}

// CheckoutSDO is POST /api/v1/orgs/{orgID}/billing/checkout.
type CheckoutSDO struct {
	URL string `json:"url" example:"https://pay.example.com/session/abc"`
}
