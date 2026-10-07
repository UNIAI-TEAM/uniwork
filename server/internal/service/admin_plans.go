package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func planCatalogAuditMap(v AdminPlanCatalogView) map[string]any {
	price := any(nil)
	if v.Plan.PriceAmount.Valid {
		price = v.Plan.PriceAmount.Int64
	}
	return map[string]any{
		"code": v.Plan.Code, "name": v.Plan.Name, "description": v.Plan.Description,
		"billing_period": v.Plan.BillingPeriod, "price_amount": price, "price_currency": v.Plan.PriceCurrency,
		"is_active": v.Plan.IsActive, "sort_order": v.Plan.SortOrder,
	}
}

func planFeatureAuditMap(planCode, featureKey string, enabled bool, quota *int64) map[string]any {
	m := map[string]any{"plan_code": planCode, "feature_key": featureKey, "enabled": enabled}
	if quota != nil {
		m["quota_limit"] = *quota
	} else {
		m["quota_limit"] = nil
	}
	return m
}

// ListPlansCatalog is GET /admin/plans.
func (s *AdminService) ListPlansCatalog(ctx context.Context) ([]AdminPlanCatalogView, error) {
	return s.billing.ListAllPlansCatalog(ctx)
}

// CreatePlanCatalog is POST /admin/plans.
func (s *AdminService) CreatePlanCatalog(ctx context.Context, adminID string, in CreatePlanCatalogInput, reason string) (AdminPlanCatalogView, error) {
	if err := checkReason(reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	after, err := s.billing.AddPlanCatalog(ctx, in)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	afterMap := planCatalogAuditMap(after)
	ctx, traceID := ensureTrace(ctx)
	if err := s.recordAdmin(ctx, s.q, traceID, adminID, audit.ActionPlanCreated, "plan", after.Plan.Code,
		map[string]any{}, afterMap, reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	if err := auditRecorder.Record(ctx, s.q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(adminID),
		Action:         audit.ActionPlanCreated,
		ResourceType:   "plan", ResourceID: after.Plan.Code,
		Changes:  audit.Diff(map[string]any{}, afterMap),
		Metadata: map[string]any{"reason": reason, "platform_admin": true},
	}); err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}

// SetPlanCatalog is PUT /admin/plans/{code}.
func (s *AdminService) SetPlanCatalog(ctx context.Context, adminID, code string, in UpdatePlanCatalogInput, reason string) (AdminPlanCatalogView, error) {
	if err := checkReason(reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	before, err := s.billing.GetPlanCatalogByCode(ctx, code)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	after, err := s.billing.SetPlanCatalogMeta(ctx, code, in)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	ctx, traceID := ensureTrace(ctx)
	if err := s.recordAdmin(ctx, s.q, traceID, adminID, audit.ActionPlanUpdated, "plan", code,
		planCatalogAuditMap(before), planCatalogAuditMap(after), reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	if err := auditRecorder.Record(ctx, s.q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(adminID),
		Action:         audit.ActionPlanUpdated,
		ResourceType:   "plan", ResourceID: code,
		Changes:  audit.Diff(planCatalogAuditMap(before), planCatalogAuditMap(after)),
		Metadata: map[string]any{"reason": reason, "platform_admin": true},
	}); err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}

// SetPlanFeature is PUT /admin/plans/{code}/features/{key}.
func (s *AdminService) SetPlanFeature(ctx context.Context, adminID, planCode, featureKey string, in UpdatePlanFeatureInput, reason string) (AdminPlanCatalogView, error) {
	if err := checkReason(reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	before, err := s.billing.GetPlanCatalogByCode(ctx, planCode)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	var beforeEnabled bool
	var beforeQuota *int64
	found := false
	for _, f := range before.Features {
		if f.FeatureKey == featureKey {
			found = true
			beforeEnabled = f.Enabled
			if f.QuotaLimit.Valid {
				q := f.QuotaLimit.Int64
				beforeQuota = &q
			}
			break
		}
	}
	if !found {
		return AdminPlanCatalogView{}, ErrNotFound
	}
	after, err := s.billing.SetPlanFeatureEntitlement(ctx, planCode, featureKey, in)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	beforeMap := planFeatureAuditMap(planCode, featureKey, beforeEnabled, beforeQuota)
	afterMap := planFeatureAuditMap(planCode, featureKey, in.Enabled, in.QuotaLimit)
	ctx, traceID := ensureTrace(ctx)
	if err := s.recordAdmin(ctx, s.q, traceID, adminID, audit.ActionPlanFeatureUpdated, "plan", planCode,
		beforeMap, afterMap, reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	if err := auditRecorder.Record(ctx, s.q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(adminID),
		Action:         audit.ActionPlanFeatureUpdated,
		ResourceType:   "plan", ResourceID: planCode,
		Changes:  audit.Diff(beforeMap, afterMap),
		Metadata: map[string]any{"reason": reason, "platform_admin": true, "feature_key": featureKey},
	}); err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}
