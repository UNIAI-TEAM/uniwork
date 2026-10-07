package service

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var planCodeRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,48}$`)

func normalizePlanCode(code string) (string, error) {
	code = strings.TrimSpace(strings.ToLower(code))
	if !planCodeRE.MatchString(code) {
		return "", Invalid("code gói phải là chữ thường, số hoặc _, bắt đầu bằng chữ cái, 2–49 ký tự")
	}
	return code, nil
}

// CreatePlanCatalogInput is POST /admin/plans.
type CreatePlanCatalogInput struct {
	Code string
	UpdatePlanCatalogInput
}

// AdminPlanCatalogView is one plan row plus its feature matrix (platform catalog).
type AdminPlanCatalogView struct {
	Plan     db.Plan
	Features []db.ListAllPlanFeaturesRow
}

// UpdatePlanCatalogInput is PUT /admin/plans/{code} — code lives in the path.
type UpdatePlanCatalogInput struct {
	Name          string
	Description   string
	BillingPeriod string
	PriceAmount   *int64
	PriceCurrency string
	IsActive      bool
	SortOrder     int32
}

// UpdatePlanFeatureInput is PUT /admin/plans/{code}/features/{key}.
type UpdatePlanFeatureInput struct {
	Enabled    bool
	QuotaLimit *int64
}

// GetPlanCatalogByCode loads one plan row and its features.
func (s *BillingService) GetPlanCatalogByCode(ctx context.Context, code string) (AdminPlanCatalogView, error) {
	plan, err := s.q.GetPlanByCode(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminPlanCatalogView{}, ErrNotFound
	}
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return s.planCatalogView(ctx, plan)
}

// ListAllPlansCatalog returns every plan, including inactive, with features.
func (s *BillingService) ListAllPlansCatalog(ctx context.Context) ([]AdminPlanCatalogView, error) {
	plans, err := s.q.ListAllPlans(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListAllPlanFeatures(ctx)
	if err != nil {
		return nil, err
	}
	byPlan := map[string][]db.ListAllPlanFeaturesRow{}
	for _, r := range rows {
		byPlan[r.PlanID] = append(byPlan[r.PlanID], r)
	}
	out := make([]AdminPlanCatalogView, 0, len(plans))
	for _, p := range plans {
		out = append(out, AdminPlanCatalogView{Plan: p, Features: byPlan[p.ID]})
	}
	return out, nil
}

// AddPlanCatalog inserts a plan and seeds plan_features from the features catalogue (disabled until configured).
func (s *BillingService) AddPlanCatalog(ctx context.Context, in CreatePlanCatalogInput) (AdminPlanCatalogView, error) {
	code, err := normalizePlanCode(in.Code)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return AdminPlanCatalogView{}, Invalid("name bắt buộc")
	}
	period := strings.TrimSpace(in.BillingPeriod)
	if period == "" {
		period = "month"
	}
	currency := strings.TrimSpace(in.PriceCurrency)
	if currency == "" {
		currency = "VND"
	}
	var price pgtype.Int8
	if in.PriceAmount != nil {
		price = pgtype.Int8{Int64: *in.PriceAmount, Valid: true}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	plan, err := q.InsertPlanCatalog(ctx, db.InsertPlanCatalogParams{
		ID: util.NewID(), Code: code, Name: in.Name, Description: strings.TrimSpace(in.Description),
		BillingPeriod: period, PriceAmount: price, PriceCurrency: currency,
		IsActive: in.IsActive, SortOrder: in.SortOrder,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return AdminPlanCatalogView{}, Invalid("code gói đã tồn tại")
		}
		return AdminPlanCatalogView{}, err
	}
	features, err := q.ListFeatures(ctx)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	for _, f := range features {
		if _, err := q.UpsertPlanFeatureRow(ctx, db.UpsertPlanFeatureRowParams{
			PlanID: plan.ID, FeatureKey: f.Key, Enabled: false, QuotaLimit: pgtype.Int8{},
		}); err != nil {
			return AdminPlanCatalogView{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminPlanCatalogView{}, err
	}
	return s.planCatalogView(ctx, plan)
}

// SetPlanCatalogMeta writes catalog metadata. Default plan cannot be deactivated.
func (s *BillingService) SetPlanCatalogMeta(ctx context.Context, code string, in UpdatePlanCatalogInput) (AdminPlanCatalogView, error) {
	before, err := s.q.GetPlanByCode(ctx, code)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminPlanCatalogView{}, ErrNotFound
	}
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	if before.IsDefault && !in.IsActive {
		return AdminPlanCatalogView{}, Invalid("không thể tắt gói mặc định")
	}
	var price pgtype.Int8
	if in.PriceAmount != nil {
		price = pgtype.Int8{Int64: *in.PriceAmount, Valid: true}
	}
	after, err := s.q.UpdatePlanCatalog(ctx, db.UpdatePlanCatalogParams{
		Code: code, Name: in.Name, Description: in.Description, BillingPeriod: in.BillingPeriod,
		PriceAmount: price, PriceCurrency: in.PriceCurrency, IsActive: in.IsActive, SortOrder: in.SortOrder,
	})
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return s.planCatalogView(ctx, after)
}

func (s *BillingService) planCatalogView(ctx context.Context, plan db.Plan) (AdminPlanCatalogView, error) {
	features, err := s.q.ListPlanFeatures(ctx, plan.ID)
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	return AdminPlanCatalogView{Plan: plan, Features: planFeaturesToAll(features)}, nil
}

func planFeaturesToAll(rows []db.ListPlanFeaturesRow) []db.ListAllPlanFeaturesRow {
	out := make([]db.ListAllPlanFeaturesRow, 0, len(rows))
	for _, f := range rows {
		out = append(out, db.ListAllPlanFeaturesRow{
			PlanID: f.PlanID, FeatureKey: f.FeatureKey, Enabled: f.Enabled, QuotaLimit: f.QuotaLimit,
			Name: f.Name, Kind: f.Kind, Unit: f.Unit, Category: f.Category, MeterMode: f.MeterMode, SortOrder: f.SortOrder,
		})
	}
	return out
}

// SetPlanFeatureEntitlement sets enabled/quota for one feature on a plan.
func (s *BillingService) SetPlanFeatureEntitlement(ctx context.Context, planCode, featureKey string, in UpdatePlanFeatureInput) (AdminPlanCatalogView, error) {
	plan, err := s.q.GetPlanByCode(ctx, planCode)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminPlanCatalogView{}, ErrNotFound
	}
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	feat, err := s.q.GetFeatureByKey(ctx, featureKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminPlanCatalogView{}, ErrNotFound
	}
	if err != nil {
		return AdminPlanCatalogView{}, err
	}
	var quota pgtype.Int8
	if in.QuotaLimit != nil {
		if feat.Kind == "flag" && *in.QuotaLimit != 0 {
			return AdminPlanCatalogView{}, Invalid("feature dạng flag không có quota_limit")
		}
		quota = pgtype.Int8{Int64: *in.QuotaLimit, Valid: true}
	}
	if _, err := s.q.UpsertPlanFeatureRow(ctx, db.UpsertPlanFeatureRowParams{
		PlanID: plan.ID, FeatureKey: featureKey, Enabled: in.Enabled, QuotaLimit: quota,
	}); err != nil {
		return AdminPlanCatalogView{}, err
	}
	return s.planCatalogView(ctx, plan)
}
