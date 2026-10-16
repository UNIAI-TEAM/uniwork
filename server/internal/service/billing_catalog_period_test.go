package service

import (
	"strings"
	"testing"
)

func TestNormalizeBillingPeriod(t *testing.T) {
	cases := []struct {
		in   string
		want string
		bad  bool
	}{
		{in: "", want: "month"},
		{in: " year ", want: "year"},
		{in: "month", want: "month"},
		{in: "none", want: "none"},
		{in: "yearly", bad: true},
		{in: "Year", bad: true},
	}
	for _, c := range cases {
		got, err := normalizeBillingPeriod(c.in)
		if c.bad {
			if err == nil || !strings.Contains(err.Error(), "billing_period") {
				t.Fatalf("normalizeBillingPeriod(%q) = %q, %v", c.in, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Fatalf("normalizeBillingPeriod(%q) = %q, %v; want %q", c.in, got, err, c.want)
		}
	}
}

func TestCatalogRejectsUnknownBillingPeriod(t *testing.T) {
	f := newBillingFixture(t)
	f.seedPlan(t, "period_plan", 1000, nil)
	before, err := f.q.GetPlanByCode(f.ctx, "period_plan")
	if err != nil {
		t.Fatal(err)
	}
	price := before.PriceAmount.Int64
	in := UpdatePlanCatalogInput{
		Name: before.Name, Description: before.Description, BillingPeriod: "yearly",
		PriceAmount: &price, PriceCurrency: before.PriceCurrency, IsActive: before.IsActive, SortOrder: before.SortOrder,
	}
	if _, err := f.billing.SetPlanCatalogMeta(f.ctx, f.q, "period_plan", in); err == nil || !strings.Contains(err.Error(), "billing_period") {
		t.Fatalf("SetPlanCatalogMeta(yearly) = %v", err)
	}
	after, err := f.q.GetPlanByCode(f.ctx, "period_plan")
	if err != nil {
		t.Fatal(err)
	}
	if after.BillingPeriod != before.BillingPeriod {
		t.Fatalf("period changed to %q", after.BillingPeriod)
	}

	if _, err := f.billing.AddPlanCatalog(f.ctx, f.q, CreatePlanCatalogInput{
		Code: "year_typo",
		UpdatePlanCatalogInput: UpdatePlanCatalogInput{
			Name: "Year typo", BillingPeriod: "Year", IsActive: true,
		},
	}); err == nil || !strings.Contains(err.Error(), "billing_period") {
		t.Fatalf("AddPlanCatalog(Year) = %v", err)
	}
	if n := countQuery(t, f, `SELECT count(*) FROM plans WHERE code = 'year_typo'`); n != 0 {
		t.Fatalf("rejected plan was inserted: %d", n)
	}
}
