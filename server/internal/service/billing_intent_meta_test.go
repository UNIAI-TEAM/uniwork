package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/billing"
)

func seedCompletedVnpayIntentMissingMeta(t *testing.T, f *billingFixture, intentID string, updatedAgo time.Duration) {
	t.Helper()
	var subID, planID string
	if err := f.pool.QueryRow(f.ctx, `SELECT id, plan_id FROM subscriptions WHERE organization_id = $1`, f.orgID).Scan(&subID, &planID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at, completed_at, created_at, updated_at
	) VALUES ($1, $2, $3, $4, 'vnpay', $1, 499000, 'VND', 'completed',
		now() + interval '1 hour', now() - interval '2 days', now() - interval '2 days', now() - $5::interval)`,
		intentID, f.orgID, subID, planID, updatedAgo.String()); err != nil {
		t.Fatal(err)
	}
}

func newVNPayQueryDRMock(t *testing.T, secret string, onCall func(txnRef string) (map[string]string, bool)) (*billing.VNPay, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		txnRef := req["vnp_TxnRef"]
		resp, ok := onCall(txnRef)
		if !ok {
			resp = map[string]string{
				"vnp_ResponseId":   "VNPQERR1",
				"vnp_Command":      "querydr",
				"vnp_ResponseCode": "99",
				"vnp_Message":      "Fail",
				"vnp_TmnCode":      "TMNTEST1",
				"vnp_TxnRef":       txnRef,
			}
		}
		resp["vnp_SecureHash"] = billing.SignQueryDRResponseForTest(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	vnp, err := billing.NewVNPay(billing.VNPayConfig{
		TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	return vnp, srv
}

func TestIntentMetaBackfillSkipsRecentlyTriedAndReachesOlderRows(t *testing.T) {
	secret := "meta-backfill-secret"
	var mu sync.Mutex
	calls := map[string]int{}
	vnp, srv := newVNPayQueryDRMock(t, secret, func(txnRef string) (map[string]string, bool) {
		mu.Lock()
		calls[txnRef]++
		mu.Unlock()
		return nil, false
	})
	defer srv.Close()

	f := newBillingFixture(t)
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)

	const n = 11
	intentIDs := []string{
		"01TESTINTMETA0000001", "01TESTINTMETA0000002", "01TESTINTMETA0000003",
		"01TESTINTMETA0000004", "01TESTINTMETA0000005", "01TESTINTMETA0000006",
		"01TESTINTMETA0000007", "01TESTINTMETA0000008", "01TESTINTMETA0000009",
		"01TESTINTMETA0000010", "01TESTINTMETA0000011",
	}
	baseAgo := 2 * time.Hour
	for i, id := range intentIDs {
		// Oldest rows (low index) get the earliest updated_at so they are claimed first.
		seedCompletedVnpayIntentMissingMeta(t, f, id, baseAgo+time.Duration(n-1-i)*time.Minute)
	}

	if err := f.billing.ProcessIntentProviderMetaBackfill(f.ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	afterFirst := len(calls)
	mu.Unlock()
	if afterFirst != 10 {
		t.Fatalf("first run querydr calls = %d, want 10", afterFirst)
	}

	if err := f.billing.ProcessIntentProviderMetaBackfill(f.ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls[intentIDs[10]] != 1 {
		t.Fatalf("11th intent queries = %d, want 1", calls[intentIDs[10]])
	}
	for i := 0; i < 10; i++ {
		if calls[intentIDs[i]] != 1 {
			t.Fatalf("intent %s queried %d times after second run, want 1", intentIDs[i], calls[intentIDs[i]])
		}
	}
	if len(calls) != 11 {
		t.Fatalf("total distinct intents queried = %d, want 11", len(calls))
	}
}

func TestIntentMetaBackfillParallelClaimsDoNotDoubleQuery(t *testing.T) {
	secret := "meta-parallel-secret"
	var queries atomic.Int32
	vnp, srv := newVNPayQueryDRMock(t, secret, func(txnRef string) (map[string]string, bool) {
		queries.Add(1)
		time.Sleep(50 * time.Millisecond)
		return map[string]string{
			"vnp_ResponseId":        "VNPQPAR1",
			"vnp_Command":           "querydr",
			"vnp_ResponseCode":      "00",
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            txnRef,
			"vnp_Amount":            "49900000",
			"vnp_TransactionNo":     "99988877",
			"vnp_TransactionStatus": "00",
			"vnp_BankCode":          "NCB",
			"vnp_PayDate":           "20261009093922",
		}, true
	})
	defer srv.Close()

	f := newBillingFixture(t)
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)
	seedCompletedVnpayIntentMissingMeta(t, f, "01TESTINTMETAPARALLEL1", 2*time.Hour)

	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			defer wg.Done()
			errs <- f.billing.ProcessIntentProviderMetaBackfill(f.ctx)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n := queries.Load(); n != 1 {
		t.Fatalf("parallel querydr calls = %d, want 1", n)
	}
}

func TestIntentMetaBackfillSkipsRetryWhenBankCodeStillMissing(t *testing.T) {
	secret := "meta-nobank-secret"
	var queries atomic.Int32
	vnp, srv := newVNPayQueryDRMock(t, secret, func(txnRef string) (map[string]string, bool) {
		queries.Add(1)
		return map[string]string{
			"vnp_ResponseId":        "VNPQNBK1",
			"vnp_Command":           "querydr",
			"vnp_ResponseCode":      "00",
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            txnRef,
			"vnp_Amount":            "49900000",
			"vnp_TransactionNo":     "11122233",
			"vnp_TransactionStatus": "00",
			"vnp_PayDate":           "20261009093922",
		}, true
	})
	defer srv.Close()

	f := newBillingFixture(t)
	f.billing = NewBillingService(f.pool, f.q, f.orgs, vnp)
	const id = "01TESTINTMETANOBANK01"
	seedCompletedVnpayIntentMissingMeta(t, f, id, 2*time.Hour)

	if err := f.billing.ProcessIntentProviderMetaBackfill(f.ctx); err != nil {
		t.Fatal(err)
	}
	if err := f.billing.ProcessIntentProviderMetaBackfill(f.ctx); err != nil {
		t.Fatal(err)
	}
	if n := queries.Load(); n != 1 {
		t.Fatalf("querydr calls = %d, want 1 (cooldown after partial meta)", n)
	}
	var bank *string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT nullif(btrim(provider_bank_code), '') FROM billing_payment_intents WHERE id = $1`, id).Scan(&bank); err != nil {
		t.Fatal(err)
	}
	if bank != nil {
		t.Fatalf("bank code = %q, want empty", *bank)
	}
}
