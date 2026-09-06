package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// BillingService is the only writer of subscriptions (spec F-02 §2 #8).
// Plans are changed by hand here; checkout goes to the provider, which is a
// stub until C-04.
type BillingService struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	orgs     *OrganizationService
	ent      *EntitlementService
	provider billing.Provider
}

func NewBillingService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, provider billing.Provider) *BillingService {
	if provider == nil {
		provider = billing.Manual{}
	}
	return &BillingService{pool: pool, q: q, orgs: orgs, ent: NewEntitlementService(pool, q), provider: provider}
}

// PlanView is a plan with the rows of plan_features it declares.
type PlanView struct {
	Plan     db.Plan
	Features []db.PlanFeature
}

// createDefaultSubscription puts a new organization on the default plan in the
// caller's transaction (spec §2 #7). No default plan is a deployment error,
// not something to paper over: the gate is fail-closed and the organization
// would be unusable.
func createDefaultSubscription(ctx context.Context, q *db.Queries, orgID string, actor Actor) (db.Subscription, error) {
	plan, err := q.GetDefaultPlan(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Subscription{}, errors.New("billing: no default plan seeded")
	}
	if err != nil {
		return db.Subscription{}, err
	}
	return q.CreateSubscription(ctx, db.CreateSubscriptionParams{
		ID: util.NewID(), OrganizationID: orgID, PlanID: plan.ID, Status: "active", Provider: "manual",
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
}

// ListPlans: every active plan with its features. Any signed-in user.
func (s *BillingService) ListPlans(ctx context.Context) ([]PlanView, error) {
	plans, err := s.q.ListActivePlans(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListActivePlanFeatures(ctx)
	if err != nil {
		return nil, err
	}
	byPlan := map[string][]db.PlanFeature{}
	for _, r := range rows {
		byPlan[r.PlanID] = append(byPlan[r.PlanID], r)
	}
	out := make([]PlanView, 0, len(plans))
	for _, p := range plans {
		out = append(out, PlanView{Plan: p, Features: byPlan[p.ID]})
	}
	return out, nil
}

// Current: the organization's subscription, plan and effective entitlements.
func (s *BillingService) Current(ctx context.Context, userID, orgID string) (EntitlementSnapshot, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return EntitlementSnapshot{}, err
	}
	return s.ent.Snapshot(ctx, orgID)
}

// requireOwner: the organization owner, or platform staff (users.platform_role).
func (s *BillingService) requireOwner(ctx context.Context, userID, orgID string) (platformAdmin bool, err error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return false, err
	}
	platformAdmin = u.PlatformRole.Valid && u.PlatformRole.String == "admin"
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil && !(platformAdmin && errors.Is(err, ErrForbidden)) {
		return false, err
	}
	if !platformAdmin && m.Role != "owner" {
		return false, ErrForbidden
	}
	return platformAdmin, nil
}

func planIsPaid(p db.Plan) bool {
	return !p.PriceAmount.Valid || p.PriceAmount.Int64 > 0
}

// ChangePlan (spec §4.4). An owner may move between free manual plans; a
// paid plan needs the provider's checkout; platform staff may set any plan.
// expectedVersion guards against two people changing the plan at once.
func (s *BillingService) ChangePlan(ctx context.Context, userID, orgID, planCode string, expectedVersion int32) (EntitlementSnapshot, error) {
	platformAdmin, err := s.requireOwner(ctx, userID, orgID)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	plan, err := s.q.GetPlanByCode(ctx, planCode)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !plan.IsActive && !platformAdmin) {
		return EntitlementSnapshot{}, ErrNotFound
	}
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	if planIsPaid(plan) && !platformAdmin {
		return EntitlementSnapshot{}, CodedError{Code: "checkout_required", Status: http.StatusForbidden,
			Msg: "gói này cần thanh toán qua cổng; dùng checkout", Fields: map[string]any{"plan_code": planCode}}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	sub, err := q.LockLiveSubscription(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EntitlementSnapshot{}, ErrNotFound
	}
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	if sub.RowVersion != expectedVersion {
		return EntitlementSnapshot{}, versionConflict(expectedVersion, sub.RowVersion)
	}
	// OPEN_QUESTIONS B4: no downgrade below what the organization already
	// uses; the owner reduces usage first.
	if err := s.fitsUnder(ctx, q, sub, plan); err != nil {
		return EntitlementSnapshot{}, err
	}
	before, err := q.GetPlanByID(ctx, sub.PlanID)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	actor := Human(userID)
	after, err := q.ChangeSubscriptionPlan(ctx, db.ChangeSubscriptionPlanParams{
		ID: sub.ID, RowVersion: expectedVersion, PlanID: plan.ID, UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return EntitlementSnapshot{}, versionConflict(expectedVersion, sub.RowVersion)
	}
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	if err := s.recordChange(ctx, q, actor, after, "change_plan", map[string]any{"plan_code": before.Code}, map[string]any{"plan_code": plan.Code}); err != nil {
		return EntitlementSnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return EntitlementSnapshot{}, err
	}
	return s.ent.Snapshot(ctx, orgID)
}

func versionConflict(expected, actual int32) error {
	return CodedError{Code: "version_conflict", Status: http.StatusConflict, Err: ErrConflict,
		Msg: "thuê bao đã được người khác thay đổi; tải lại rồi thử lại", Fields: map[string]any{"expected": expected, "actual": actual}}
}

// fitsUnder refuses a target plan whose snapshot limits are already exceeded.
func (s *BillingService) fitsUnder(ctx context.Context, q *db.Queries, sub db.Subscription, plan db.Plan) error {
	rows, err := q.ListPlanFeatures(ctx, plan.ID)
	if err != nil {
		return err
	}
	sub.PlanID = plan.ID
	sub.Status = "active"
	for _, e := range effective(sub, rows, time.Now()) {
		if e.Kind != "quota" || e.MeterMode != "snapshot" || e.Limit == nil {
			continue
		}
		cur, err := snapshotCount(ctx, q, sub.OrganizationID, e.Key)
		if err != nil {
			return err
		}
		if cur > *e.Limit {
			return errQuotaExceeded(e.Key, *e.Limit, cur, 0)
		}
	}
	return nil
}

// recordChange writes the audit row and one subscription.changed per
// owner/admin, on the caller's transaction (spec §4.4).
func (s *BillingService) recordChange(ctx context.Context, q *db.Queries, actor Actor, sub db.Subscription, kind string, before, after map[string]any) error {
	admins, err := q.ListOrgAdminUserIDs(ctx, sub.OrganizationID)
	if err != nil {
		return err
	}
	evs := make([]audit.Event, 0, len(admins))
	for _, uid := range admins {
		evs = append(evs, audit.Event{Topic: "subscription.changed", Payload: map[string]string{
			"organization_id": sub.OrganizationID, "subscription_id": sub.ID, "user_id": uid,
		}})
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: sub.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionSubscriptionChanged,
		ResourceType:   "subscription", ResourceID: sub.ID,
		Changes:  audit.Diff(before, after),
		Metadata: map[string]any{"kind": kind},
	}, evs...)
}

// Cancel schedules the end of the subscription at the period end (now for a
// plan without a period). The row stays live until a provider event or a
// platform admin ends it (C-04); until then the organization keeps its plan.
func (s *BillingService) Cancel(ctx context.Context, userID, orgID string) (EntitlementSnapshot, error) {
	return s.setCancelAt(ctx, userID, orgID, true)
}

// Resume clears a scheduled cancellation.
func (s *BillingService) Resume(ctx context.Context, userID, orgID string) (EntitlementSnapshot, error) {
	return s.setCancelAt(ctx, userID, orgID, false)
}

func (s *BillingService) setCancelAt(ctx context.Context, userID, orgID string, cancel bool) (EntitlementSnapshot, error) {
	if _, err := s.requireOwner(ctx, userID, orgID); err != nil {
		return EntitlementSnapshot{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	sub, err := q.LockLiveSubscription(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return EntitlementSnapshot{}, ErrNotFound
	}
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	var at pgtype.Timestamptz
	kind := "resume"
	if cancel {
		kind = "cancel"
		at = sub.CurrentPeriodEnd
		if !at.Valid {
			at = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		}
	}
	actor := Human(userID)
	after, err := q.SetSubscriptionCancelAt(ctx, db.SetSubscriptionCancelAtParams{
		ID: sub.ID, CancelAt: at, UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	if err := s.recordChange(ctx, q, actor, after, kind,
		map[string]any{"cancel_at": audit.Text(sub.CancelAt.Valid, sub.CancelAt.Time.Format(time.RFC3339))},
		map[string]any{"cancel_at": audit.Text(after.CancelAt.Valid, after.CancelAt.Time.Format(time.RFC3339))}); err != nil {
		return EntitlementSnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return EntitlementSnapshot{}, err
	}
	return s.ent.Snapshot(ctx, orgID)
}

// Checkout asks the provider for a payment page. Manual (and the stubs)
// answer 503 billing_provider_unavailable.
func (s *BillingService) Checkout(ctx context.Context, userID, orgID, planCode, successURL, cancelURL string) (billing.CheckoutSession, error) {
	if _, err := s.requireOwner(ctx, userID, orgID); err != nil {
		return billing.CheckoutSession{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	if _, err := s.q.GetPlanByCode(ctx, planCode); errors.Is(err, pgx.ErrNoRows) {
		return billing.CheckoutSession{}, ErrNotFound
	} else if err != nil {
		return billing.CheckoutSession{}, err
	}
	sess, err := s.provider.CreateCheckout(ctx, billing.CheckoutInput{
		OrganizationID: orgID, PlanCode: planCode, CustomerEmail: u.Email, SuccessURL: successURL, CancelURL: cancelURL,
	})
	if errors.Is(err, billing.ErrProviderUnavailable) {
		return billing.CheckoutSession{}, CodedError{Code: "billing_provider_unavailable", Status: http.StatusServiceUnavailable, Err: err,
			Msg: "chưa có cổng thanh toán; liên hệ quản trị viên để đổi gói", Fields: map[string]any{"provider": s.provider.Name()}}
	}
	return sess, err
}
