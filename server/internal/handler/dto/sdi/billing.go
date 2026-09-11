package sdi

// ChangePlanSDI is PATCH /api/v1/orgs/{orgID}/billing/plan.
type ChangePlanSDI struct {
	PlanCode   string `json:"plan_code" minLength:"1" description:"Mã gói đích (plans.code)" example:"starter"`
	RowVersion int32  `json:"row_version" description:"row_version đang thấy; lệch thì 409 version_conflict" example:"1"`
}

// CheckoutSDI is POST /api/v1/orgs/{orgID}/billing/checkout.
type CheckoutSDI struct {
	PlanCode    string `json:"plan_code" minLength:"1" description:"Mã gói muốn thanh toán" example:"team"`
	SuccessPath string `json:"success_path" description:"Đường dẫn quay về khi thanh toán xong" example:"/acme/team/settings?tab=billing"`
	CancelPath  string `json:"cancel_path" description:"Đường dẫn quay về khi hủy" example:"/acme/team/settings?tab=billing"`
}
