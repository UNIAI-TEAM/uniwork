package service

import (
	"strings"
	"testing"
)

func TestPlanCatalogRejectsNegativePriceAndQuota(t *testing.T) {
	f := newBillingFixture(t)
	neg := int64(-1)
	if _, err := f.billing.AddPlanCatalog(f.ctx, f.q, CreatePlanCatalogInput{
		Code: "neg_price",
		UpdatePlanCatalogInput: UpdatePlanCatalogInput{
			Name: "Negative", BillingPeriod: "month", PriceAmount: &neg, IsActive: true,
		},
	}); err == nil || !strings.Contains(err.Error(), "price_amount") {
		t.Fatalf("AddPlanCatalog(negative) = %v", err)
	}
	if n := countQuery(t, f, `SELECT count(*) FROM plans WHERE code = 'neg_price'`); n != 0 {
		t.Fatalf("rejected plan was inserted: %d", n)
	}

	f.seedPlan(t, "priced_plan", 1000, nil)
	before, err := f.q.GetPlanByCode(f.ctx, "priced_plan")
	if err != nil {
		t.Fatal(err)
	}
	price := before.PriceAmount.Int64
	if _, err := f.billing.SetPlanCatalogMeta(f.ctx, f.q, "priced_plan", UpdatePlanCatalogInput{
		Name: before.Name, Description: before.Description, BillingPeriod: before.BillingPeriod,
		PriceAmount: &neg, PriceCurrency: before.PriceCurrency, IsActive: before.IsActive, SortOrder: before.SortOrder,
	}); err == nil || !strings.Contains(err.Error(), "price_amount") {
		t.Fatalf("SetPlanCatalogMeta(negative) = %v", err)
	}
	after, err := f.q.GetPlanByCode(f.ctx, "priced_plan")
	if err != nil {
		t.Fatal(err)
	}
	if !after.PriceAmount.Valid || after.PriceAmount.Int64 != price {
		t.Fatalf("price changed to %+v", after.PriceAmount)
	}

	quota := int64(-5)
	if _, err := f.billing.SetPlanFeatureEntitlement(f.ctx, f.q, "priced_plan", FeatureMembersMax, UpdatePlanFeatureInput{
		Enabled: true, QuotaLimit: &quota,
	}); err == nil || !strings.Contains(err.Error(), "quota_limit") {
		t.Fatalf("SetPlanFeatureEntitlement(negative) = %v", err)
	}
}
