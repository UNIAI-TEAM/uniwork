package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: billing — plans, the organization's subscription and its effective
// entitlements (F-02). Requires Bearer. Quota errors (entitlement_required,
// quota_exceeded) can come back from any gated endpoint, not only these.
//
//	GET   /api/v1/plans
//	GET   /api/v1/orgs/{orgID}/billing
//	PATCH /api/v1/orgs/{orgID}/billing/plan
//	POST  /api/v1/orgs/{orgID}/billing/cancel
//	POST  /api/v1/orgs/{orgID}/billing/resume
//	POST  /api/v1/orgs/{orgID}/billing/checkout
func registerBilling(r api, h Routes) {
	r.Get("/plans", h.ListPlans, apiOp{
		summary:     "List plans",
		description: "Các gói đang mở, kèm entitlement từng gói.",
		tags:        []string{"billing"},
		sdo:         sdo.PlanListSDO{},
		auth:        true,
	})
	r.Get("/orgs/{orgID}/billing", h.GetSubscription, apiOp{
		summary:     "Get subscription",
		description: "Thuê bao hiện tại, gói và entitlement hiệu lực kèm usage. Mọi thành viên tổ chức.",
		tags:        []string{"billing"},
		sdo:         sdo.SubscriptionSDO{},
		auth:        true,
	})
	r.Patch("/orgs/{orgID}/billing/plan", h.ChangePlan, apiOp{
		summary:     "Change plan",
		description: "Owner tổ chức đổi giữa các gói miễn phí; gói trả phí trả 403 checkout_required; platform admin đổi bất kỳ. 409 version_conflict khi row_version lệch; 403 quota_exceeded khi usage hiện tại vượt gói đích.",
		tags:        []string{"billing"},
		sdi:         sdi.ChangePlanSDI{},
		sdo:         sdo.SubscriptionSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/billing/cancel", h.CancelSubscription, apiOp{
		summary:     "Cancel subscription at period end",
		description: "Owner đặt cancel_at = cuối kỳ. Thuê bao vẫn hiệu lực đến lúc đó.",
		tags:        []string{"billing"},
		sdo:         sdo.SubscriptionSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/billing/resume", h.ResumeSubscription, apiOp{
		summary:     "Resume subscription",
		description: "Owner bỏ lịch hủy.",
		tags:        []string{"billing"},
		sdo:         sdo.SubscriptionSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/billing/checkout", h.CreateCheckout, apiOp{
		summary:     "Create checkout session",
		description: "Owner xin URL thanh toán từ cổng. 503 billing_provider_unavailable khi cổng là manual.",
		tags:        []string{"billing"},
		sdi:         sdi.CheckoutSDI{},
		sdo:         sdo.CheckoutSDO{},
		status:      201,
		auth:        true,
	})
}
