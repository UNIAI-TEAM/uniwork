package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// commitAdmin runs the business write, admin_actions and audit_events in one
// transaction. The admin row failing rolls the business write back.
func (s *AdminService) commitAdmin(ctx context.Context, fn func(ctx context.Context, q *db.Queries, traceID string) error) error {
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(ctx, s.q.WithTx(tx), traceID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

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
	var after AdminPlanCatalogView
	err := s.commitAdmin(ctx, func(ctx context.Context, q *db.Queries, traceID string) error {
		var err error
		after, err = s.billing.AddPlanCatalog(ctx, q, in)
		if err != nil {
			return err
		}
		afterMap := planCatalogAuditMap(after)
		if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionPlanCreated, "plan", after.Plan.Code,
			map[string]any{}, afterMap, reason); err != nil {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: audit.NoOrganization,
			Actor:          audit.User(adminID),
			Action:         audit.ActionPlanCreated,
			ResourceType:   "plan", ResourceID: after.Plan.Code,
			Changes:  audit.Diff(map[string]any{}, afterMap),
			Metadata: map[string]any{"reason": reason, "platform_admin": true},
		})
	})
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}

// SetPlanCatalog is PUT /admin/plans/{code}.
func (s *AdminService) SetPlanCatalog(ctx context.Context, adminID, code string, in UpdatePlanCatalogInput, reason string) (AdminPlanCatalogView, error) {
	if err := checkReason(reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	var after AdminPlanCatalogView
	err := s.commitAdmin(ctx, func(ctx context.Context, q *db.Queries, traceID string) error {
		before, err := s.billing.planCatalogByCode(ctx, q, code)
		if err != nil {
			return err
		}
		after, err = s.billing.SetPlanCatalogMeta(ctx, q, code, in)
		if err != nil {
			return err
		}
		if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionPlanUpdated, "plan", code,
			planCatalogAuditMap(before), planCatalogAuditMap(after), reason); err != nil {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: audit.NoOrganization,
			Actor:          audit.User(adminID),
			Action:         audit.ActionPlanUpdated,
			ResourceType:   "plan", ResourceID: code,
			Changes:  audit.Diff(planCatalogAuditMap(before), planCatalogAuditMap(after)),
			Metadata: map[string]any{"reason": reason, "platform_admin": true},
		})
	})
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}

// SetPlanFeature is PUT /admin/plans/{code}/features/{key}.
func (s *AdminService) SetPlanFeature(ctx context.Context, adminID, planCode, featureKey string, in UpdatePlanFeatureInput, reason string) (AdminPlanCatalogView, error) {
	if err := checkReason(reason); err != nil {
		return AdminPlanCatalogView{}, err
	}
	var after AdminPlanCatalogView
	err := s.commitAdmin(ctx, func(ctx context.Context, q *db.Queries, traceID string) error {
		before, err := s.billing.planCatalogByCode(ctx, q, planCode)
		if err != nil {
			return err
		}
		var beforeEnabled bool
		var beforeQuota *int64
		found := false
		for _, f := range before.Features {
			if f.FeatureKey == featureKey {
				found = true
				beforeEnabled = f.Enabled
				if f.QuotaLimit.Valid {
					n := f.QuotaLimit.Int64
					beforeQuota = &n
				}
				break
			}
		}
		if !found {
			return ErrNotFound
		}
		after, err = s.billing.SetPlanFeatureEntitlement(ctx, q, planCode, featureKey, in)
		if err != nil {
			return err
		}
		beforeMap := planFeatureAuditMap(planCode, featureKey, beforeEnabled, beforeQuota)
		afterMap := planFeatureAuditMap(planCode, featureKey, in.Enabled, in.QuotaLimit)
		if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionPlanFeatureUpdated, "plan", planCode,
			beforeMap, afterMap, reason); err != nil {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: audit.NoOrganization,
			Actor:          audit.User(adminID),
			Action:         audit.ActionPlanFeatureUpdated,
			ResourceType:   "plan", ResourceID: planCode,
			Changes:  audit.Diff(beforeMap, afterMap),
			Metadata: map[string]any{"reason": reason, "platform_admin": true, "feature_key": featureKey},
		})
	})
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return after, nil
}
