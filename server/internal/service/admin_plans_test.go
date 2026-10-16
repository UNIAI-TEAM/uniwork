package service

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestAdminPlanWritesRollBackWhenAdminActionFails(t *testing.T) {
	f := newBillingFixture(t)
	staff := registerVerified(t, f.q, f.auth, "plan-rollback-admin@example.com", "Staff")
	if _, err := f.pool.Exec(f.ctx, `UPDATE users SET platform_role = 'admin' WHERE id = $1`, staff.ID); err != nil {
		t.Fatal(err)
	}
	admin := NewAdminService(f.pool, f.q, f.billing, f.ent)
	const reason = "correct a catalog mistake"

	cur, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	code := cur.Plan.Code
	before, err := f.billing.GetPlanCatalogByCode(f.ctx, code)
	if err != nil {
		t.Fatal(err)
	}
	var quotaBefore pgtype.Int8
	for _, feat := range before.Features {
		if feat.FeatureKey == FeatureMembersMax {
			quotaBefore = feat.QuotaLimit
		}
	}
	planUpdates := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.updated' AND resource_id = $1`, code)
	featureUpdates := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.feature_updated' AND resource_id = $1`, code)
	planCreates := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.created' AND resource_id = 'rollback_plan'`)
	subChanges := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'subscription.changed' AND organization_id = $1`, f.orgID)

	drop := installAdminActionBlock(t, f)
	rolledName := before.Plan.Name + " rolled"
	rolledPrice := int64(1)
	if _, err := admin.SetPlanCatalog(f.ctx, staff.ID, code, catalogInput(before, rolledName, &rolledPrice), reason); err == nil {
		t.Fatal("SetPlanCatalog committed past a failing admin_actions insert")
	}
	if _, err := admin.SetPlanFeature(f.ctx, staff.ID, code, FeatureMembersMax, UpdatePlanFeatureInput{Enabled: true, QuotaLimit: &rolledPrice}, reason); err == nil {
		t.Fatal("SetPlanFeature committed past a failing admin_actions insert")
	}
	if _, err := admin.CreatePlanCatalog(f.ctx, staff.ID, CreatePlanCatalogInput{
		Code: "rollback_plan", UpdatePlanCatalogInput: UpdatePlanCatalogInput{Name: "Rollback plan", IsActive: true},
	}, reason); err == nil {
		t.Fatal("CreatePlanCatalog committed past a failing admin_actions insert")
	}
	f.seedPlan(t, "free_small", 0, nil)
	if _, err := admin.ChangePlan(f.ctx, staff.ID, f.orgID, "free_small", reason); err == nil || errors.Is(err, ErrForbidden) {
		t.Fatalf("ChangePlan: got %v", err)
	}

	got, err := f.billing.GetPlanCatalogByCode(f.ctx, code)
	if err != nil {
		t.Fatal(err)
	}
	if got.Plan.Name != before.Plan.Name || got.Plan.PriceAmount != before.Plan.PriceAmount {
		t.Fatalf("plan catalog changed: name %q price %+v", got.Plan.Name, got.Plan.PriceAmount)
	}
	for _, feat := range got.Features {
		if feat.FeatureKey == FeatureMembersMax && feat.QuotaLimit != quotaBefore {
			t.Fatalf("members.max = %+v, want %+v", feat.QuotaLimit, quotaBefore)
		}
	}
	if n := countQuery(t, f, `SELECT count(*) FROM plans WHERE code = 'rollback_plan'`); n != 0 {
		t.Fatalf("rolled-back plan still exists: %d", n)
	}
	stayed, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if stayed.Plan.ID != cur.Plan.ID || stayed.Subscription.RowVersion != cur.Subscription.RowVersion {
		t.Fatalf("subscription moved: plan %s version %d", stayed.Plan.Code, stayed.Subscription.RowVersion)
	}
	if countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.updated' AND resource_id = $1`, code) != planUpdates ||
		countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.feature_updated' AND resource_id = $1`, code) != featureUpdates ||
		countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.created' AND resource_id = 'rollback_plan'`) != planCreates ||
		countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'subscription.changed' AND organization_id = $1`, f.orgID) != subChanges {
		t.Fatal("a rolled-back admin write left an audit row")
	}

	drop()
	f.seedPlan(t, "retry_plan", 0, nil)
	retry, err := f.billing.GetPlanCatalogByCode(f.ctx, "retry_plan")
	if err != nil {
		t.Fatal(err)
	}
	actionsBefore := countQuery(t, f, `SELECT count(*) FROM admin_actions WHERE action = 'plan.updated' AND target_id = $1`, "retry_plan")
	auditsBefore := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.updated' AND resource_id = $1`, "retry_plan")
	newPrice := int64(12345)
	if _, err := admin.SetPlanCatalog(f.ctx, staff.ID, "retry_plan", catalogInput(retry, "Renamed catalog", &newPrice), reason); err != nil {
		t.Fatal(err)
	}
	var fromName, toName, fromPrice, toPrice, traceID, correlationID string
	actions := countQuery(t, f, `SELECT count(*) FROM admin_actions WHERE action = 'plan.updated' AND target_id = $1`, "retry_plan")
	audits := countQuery(t, f, `SELECT count(*) FROM audit_events WHERE action = 'plan.updated' AND resource_id = $1`, "retry_plan")
	if actions != actionsBefore+1 || audits != auditsBefore+1 {
		t.Fatalf("admin_actions %d audit_events %d, want %d and %d", actions, audits, actionsBefore+1, auditsBefore+1)
	}
	err = f.pool.QueryRow(f.ctx, `SELECT a.trace_id, e.correlation_id,
		e.changes::jsonb->'name'->>'from', e.changes::jsonb->'name'->>'to',
		e.changes::jsonb->'price_amount'->>'from', e.changes::jsonb->'price_amount'->>'to'
		FROM admin_actions a
		JOIN audit_events e ON e.correlation_id = a.trace_id AND e.action = a.action AND e.resource_id = a.target_id
		WHERE a.action = 'plan.updated' AND a.target_id = 'retry_plan'
		ORDER BY a.created_at DESC LIMIT 1`).Scan(&traceID, &correlationID, &fromName, &toName, &fromPrice, &toPrice)
	if err != nil {
		t.Fatal(err)
	}
	if traceID == "" || traceID != correlationID || fromName != "retry_plan" || toName != "Renamed catalog" || fromPrice != "0" || toPrice != "12345" {
		t.Fatalf("trace %q/%q name %q->%q price %q->%q", traceID, correlationID, fromName, toName, fromPrice, toPrice)
	}
}

func catalogInput(view AdminPlanCatalogView, name string, price *int64) UpdatePlanCatalogInput {
	return UpdatePlanCatalogInput{
		Name: name, Description: view.Plan.Description, BillingPeriod: view.Plan.BillingPeriod,
		PriceAmount: price, PriceCurrency: view.Plan.PriceCurrency, IsActive: view.Plan.IsActive, SortOrder: view.Plan.SortOrder,
	}
}

func countQuery(t *testing.T, f *billingFixture, query string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func installAdminActionBlock(t *testing.T, f *billingFixture) func() {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, `
		CREATE OR REPLACE FUNCTION uni_test_admin_actions_fail() RETURNS trigger
		LANGUAGE plpgsql AS $fn$
		BEGIN
		  RAISE EXCEPTION 'admin_actions blocked';
		END;
		$fn$`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `DROP TRIGGER IF EXISTS uni_test_admin_actions_fail ON admin_actions`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `
		CREATE TRIGGER uni_test_admin_actions_fail
		BEFORE INSERT ON admin_actions
		FOR EACH ROW EXECUTE FUNCTION uni_test_admin_actions_fail()`); err != nil {
		t.Fatal(err)
	}
	drop := func() {
		_, _ = f.pool.Exec(f.ctx, `DROP TRIGGER IF EXISTS uni_test_admin_actions_fail ON admin_actions`)
		_, _ = f.pool.Exec(f.ctx, `DROP FUNCTION IF EXISTS uni_test_admin_actions_fail()`)
	}
	t.Cleanup(drop)
	return drop
}
