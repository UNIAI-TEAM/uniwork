package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/billing"
)

func TestInvoiceNumberStaysUniqueInsideOneMillisecond(t *testing.T) {
	at := time.Now()
	seen := map[string]struct{}{}
	for i := 0; i < 32; i++ {
		n := invoiceNumber(at)
		if _, ok := seen[n]; ok {
			t.Fatalf("duplicate invoice number %s", n)
		}
		seen[n] = struct{}{}
	}
}

func TestProcessStalePaymentIntentReconcile(t *testing.T) {
	secret := "testsecret"
	var mu sync.Mutex
	calls := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode: %v", err)
			return
		}
		ref := req["vnp_TxnRef"]
		mu.Lock()
		calls[ref]++
		mu.Unlock()
		status, amount, txnNo, code := "00", "50000000", "9001", "00"
		switch ref {
		case "01TESTSTALERECON00002":
			status, txnNo = "02", "9002"
		case "01TESTSTALERECON00005":
			txnNo = "9005"
		case "01TESTSTALERECON00006":
			code = "99"
		}
		resp := map[string]string{
			"vnp_ResponseId":        "VNPQREF1",
			"vnp_Command":           "querydr",
			"vnp_ResponseCode":      code,
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            ref,
			"vnp_Amount":            amount,
			"vnp_BankCode":          "NCB",
			"vnp_PayDate":           "",
			"vnp_TransactionNo":     txnNo,
			"vnp_TransactionType":   "01",
			"vnp_TransactionStatus": status,
			"vnp_OrderInfo":         req["vnp_OrderInfo"],
			"vnp_PromotionCode":     "",
			"vnp_PromotionAmount":   "",
			"vnp_CurrCode":          "VND",
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	f := newBillingFixture(t)
	f.seedPlan(t, "paid_team", 500000, nil)
	vnp, err := billing.NewVNPay(billing.VNPayConfig{
		TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)

	var subID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID); err != nil {
		t.Fatal(err)
	}
	planID := "01TESTPLANpaid_team"
	for _, row := range []struct {
		id, status, age string
	}{
		{"01TESTSTALERECON00001", "pending", "20 minutes"},
		{"01TESTSTALERECON00002", "pending", "20 minutes"},
		{"01TESTSTALERECON00003", "pending", "5 minutes"},
		{"01TESTSTALERECON00004", "pending", "8 days"},
		{"01TESTSTALERECON00005", "expired", "20 minutes"},
		{"01TESTSTALERECON00006", "pending", "20 minutes"},
	} {
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
			id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
			amount, currency, status, expires_at, created_at
		) VALUES ($1, $2, $3, $4, 'vnpay', $1, 500000, 'VND', $5, now() + interval '15 minutes', now() - $6::interval)`,
			row.id, f.orgID, subID, planID, row.status, row.age); err != nil {
			t.Fatal(err)
		}
	}

	if err := f.billing.ProcessStalePaymentIntentReconcile(f.ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.billing.ProcessStalePaymentIntentReconcile(f.ctx); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	got := map[string]int{}
	for k, v := range calls {
		got[k] = v
	}
	mu.Unlock()
	for _, id := range []string{"01TESTSTALERECON00001", "01TESTSTALERECON00002", "01TESTSTALERECON00005", "01TESTSTALERECON00006"} {
		if got[id] != 1 {
			t.Fatalf("querydr calls for %s = %d, want 1", id, got[id])
		}
	}
	for _, id := range []string{"01TESTSTALERECON00003", "01TESTSTALERECON00004"} {
		if got[id] != 0 {
			t.Fatalf("querydr calls for %s = %d, want 0", id, got[id])
		}
	}

	assertIntent := func(id, status, txnNo string) {
		t.Helper()
		var gotStatus, gotTxn string
		if err := f.pool.QueryRow(f.ctx,
			`SELECT status, COALESCE(provider_transaction_no, '') FROM billing_payment_intents WHERE id = $1`,
			id).Scan(&gotStatus, &gotTxn); err != nil {
			t.Fatal(err)
		}
		if gotStatus != status || gotTxn != txnNo {
			t.Fatalf("intent %s status=%q txn=%q, want %s / %s", id, gotStatus, gotTxn, status, txnNo)
		}
	}
	assertIntent("01TESTSTALERECON00001", "completed", "9001")
	assertIntent("01TESTSTALERECON00002", "failed", "")
	assertIntent("01TESTSTALERECON00003", "pending", "")
	assertIntent("01TESTSTALERECON00004", "pending", "")
	assertIntent("01TESTSTALERECON00005", "completed", "9005")
	assertIntent("01TESTSTALERECON00006", "pending", "")

	for _, id := range []string{"01TESTSTALERECON00001", "01TESTSTALERECON00005"} {
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE payment_intent_id = $1`, id).Scan(&n); err != nil || n != 1 {
			t.Fatalf("invoices for %s = %d (%v), want 1", id, n, err)
		}
	}
	snap, err := f.billing.Current(f.ctx, f.owner.ID, f.orgID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Plan.Code != "paid_team" {
		t.Fatalf("plan = %s, want paid_team", snap.Plan.Code)
	}

	again := billing.Event{
		ProviderEventID: "9001",
		ProviderTxnRef:  "01TESTSTALERECON00001",
		Type:            "invoice.paid",
		Paid:            true,
		Amount:          500000,
		Currency:        "VND",
	}
	if err := f.billing.ApplyProviderEvent(f.ctx, again); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM invoices WHERE payment_intent_id = $1`, again.ProviderTxnRef).Scan(&n); err != nil || n != 1 {
		t.Fatalf("replay invoices = %d (%v), want 1", n, err)
	}
}
