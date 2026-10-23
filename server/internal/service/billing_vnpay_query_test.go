package service

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/billing"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestVnpayQueryDRInputUsesStoredPayDateAndOrderInfo(t *testing.T) {
	f := newBillingFixture(t)
	plan, err := f.q.GetDefaultPlan(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	payAt := time.Date(2026, 10, 9, 9, 39, 22, 0, vnpayICT)
	intent := db.BillingPaymentIntent{
		ProviderTxnRef:    "01INTENT0000000001",
		PlanID:            plan.ID,
		ProviderOrderInfo: pgtype.Text{String: "UniWork hihi", Valid: true},
		ProviderPayDate:   pgtype.Text{String: "20261009093922", Valid: true},
		CreatedAt:         pgtype.Timestamptz{Time: payAt.Add(-time.Minute), Valid: true},
		CompletedAt:       pgtype.Timestamptz{Time: payAt.Add(6 * time.Second), Valid: true},
	}
	in := f.billing.vnpayQueryDRInput(f.ctx, f.q, intent, "203.0.113.1")
	if in.OrderInfo != "UniWork hihi" {
		t.Fatalf("OrderInfo = %q", in.OrderInfo)
	}
	if in.TransactionDate.In(vnpayICT).Format("20060102150405") != "20261009093922" {
		t.Fatalf("TransactionDate = %v", in.TransactionDate)
	}
	if in.ClientIP != "203.0.113.1" {
		t.Fatalf("ClientIP = %q", in.ClientIP)
	}
}

func TestMarkIntentCompletedParamsStoresVNPayMeta(t *testing.T) {
	ev := billing.Event{RawParams: map[string]string{
		"vnp_BankCode": "NCB", "vnp_TransactionNo": "15699725",
		"vnp_OrderInfo": "UniWork hihi", "vnp_PayDate": "20261009093922",
	}}
	p := markIntentCompletedParams("id", "org", "NCB", "15699725", ev)
	if !p.ProviderPayDate.Valid || p.ProviderPayDate.String != "20261009093922" {
		t.Fatalf("pay date %+v", p.ProviderPayDate)
	}
	if !p.ProviderOrderInfo.Valid || p.ProviderOrderInfo.String != "UniWork hihi" {
		t.Fatalf("order info %+v", p.ProviderOrderInfo)
	}
}
