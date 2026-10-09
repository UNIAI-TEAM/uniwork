package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const billingIntentTTL = 15 * time.Minute

// ValidateCheckoutPath rejects absolute or ambiguous return paths (C-04 §6.3).
func ValidateCheckoutPath(path string) error {
	if path == "" || !strings.HasPrefix(path, "/") || strings.Contains(path, "//") {
		return CodedError{Code: "invalid_checkout_path", Status: http.StatusBadRequest,
			Msg: "success_path và cancel_path phải là đường dẫn tương đối hợp lệ"}
	}
	return nil
}

// Checkout asks the payment provider for a redirect URL. Paid plans persist a
// billing_payment_intent before the URL is built so IPN can match vnp_TxnRef.
// A still-valid pending intent for the same plan is reused so two devices do
// not open two payable orders for one checkout wave.
func (s *BillingService) Checkout(ctx context.Context, userID, orgID, planCode, successURL, cancelURL, clientIP string) (billing.CheckoutSession, error) {
	if _, err := s.requireOwner(ctx, userID, orgID); err != nil {
		return billing.CheckoutSession{}, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	plan, err := s.q.GetPlanByCode(ctx, planCode)
	if errors.Is(err, pgx.ErrNoRows) || !plan.IsActive {
		return billing.CheckoutSession{}, ErrNotFound
	}
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	if !plan.PriceAmount.Valid || plan.PriceAmount.Int64 <= 0 {
		return billing.CheckoutSession{}, CodedError{Code: "checkout_not_available", Status: http.StatusBadRequest,
			Msg: "gói này không thanh toán qua cổng; dùng đổi gói miễn phí hoặc liên hệ quản trị"}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	sub, err := q.LockLiveSubscription(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return billing.CheckoutSession{}, ErrNotFound
	}
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	if err := s.fitsUnder(ctx, q, sub, plan); err != nil {
		return billing.CheckoutSession{}, err
	}
	before, err := q.GetPlanByID(ctx, sub.PlanID)
	if err != nil {
		return billing.CheckoutSession{}, err
	}
	if planListPrice(before) > 0 && planListPrice(plan) < planListPrice(before) {
		return billing.CheckoutSession{}, CodedError{Code: "downgrade_not_allowed", Status: http.StatusForbidden,
			Msg:    "không thể hạ gói trả phí qua thanh toán; dùng hủy gói vào cuối kỳ hoặc liên hệ quản trị",
			Fields: map[string]any{"current_plan": before.Code, "target_plan": plan.Code}}
	}

	var intentID string
	var amount int64
	var currency string
	orderInfo := "UniWork " + plan.Code
	existing, err := q.GetPendingBillingPaymentIntentForPlan(ctx, db.GetPendingBillingPaymentIntentForPlanParams{
		OrganizationID: orgID, PlanID: plan.ID,
	})
	if err == nil {
		intentID = existing.ID
		amount = existing.Amount
		currency = existing.Currency
		if s := strings.TrimSpace(pgTextString(existing.ProviderOrderInfo)); s != "" {
			orderInfo = s
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		if err := q.ExpirePendingBillingPaymentIntents(ctx, orgID); err != nil {
			return billing.CheckoutSession{}, err
		}
		intentID = util.NewID()
		expires := time.Now().Add(billingIntentTTL)
		checkoutActor := Human(userID)
		amount = plan.PriceAmount.Int64
		currency = plan.PriceCurrency
		_, err = q.InsertBillingPaymentIntent(ctx, db.InsertBillingPaymentIntentParams{
			ID: intentID, OrganizationID: orgID, SubscriptionID: sub.ID, PlanID: plan.ID,
			Provider: s.provider.Name(), ProviderTxnRef: intentID,
			Amount: amount, Currency: currency,
			ExpiresAt:         pgtype.Timestamptz{Time: expires, Valid: true},
			CreatedBy:         pgtype.Text{String: checkoutActor.ID, Valid: true},
			CreatedByKind:     pgtype.Text{String: string(checkoutActor.Kind), Valid: true},
			ProviderOrderInfo: pgtype.Text{String: orderInfo, Valid: true},
		})
		if err != nil {
			return billing.CheckoutSession{}, err
		}
	} else {
		return billing.CheckoutSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return billing.CheckoutSession{}, err
	}

	sess, err := s.provider.CreateCheckout(ctx, billing.CheckoutInput{
		OrganizationID: orgID, PlanCode: planCode, CustomerEmail: u.Email,
		SuccessURL: successURL, CancelURL: cancelURL,
		IntentID: intentID, Amount: amount, Currency: currency,
		OrderInfo: orderInfo, ClientIP: clientIP,
	})
	if err != nil {
		_ = s.q.MarkBillingPaymentIntentFailed(ctx, db.MarkBillingPaymentIntentFailedParams{
			ID: intentID, OrganizationID: orgID,
		})
		if errors.Is(err, billing.ErrProviderUnavailable) {
			return billing.CheckoutSession{}, CodedError{Code: "billing_provider_unavailable", Status: http.StatusServiceUnavailable, Err: err,
				Msg: "chưa có cổng thanh toán; liên hệ quản trị viên để đổi gói", Fields: map[string]any{"provider": s.provider.Name()}}
		}
		return billing.CheckoutSession{}, err
	}
	return sess, nil
}
