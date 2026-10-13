package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/billing"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestVNPayWebhookRepliesVNPayJSON(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	const secret = "ipn-test-secret"
	const tmn = "TMNIPN"
	prov := billing.FromConfig(config.Config{
		BillingProvider: "vnpay", VNPayTMNCode: tmn, VNPayHashSecret: secret,
	})
	d.Billing = service.NewBillingService(pool, db.New(pool), d.Organizations, prov)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	bad := url.Values{}
	bad.Set("vnp_TmnCode", tmn)
	bad.Set("vnp_TxnRef", "01MISSING")
	bad.Set("vnp_SecureHash", "deadbeef")
	res, err := srv.Client().Get(srv.URL + "/api/v1/billing/webhooks/vnpay?" + bad.Encode())
	if err != nil {
		t.Fatal(err)
	}
	assertVNPayIPN(t, res, "97")

	reg, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "vnpay-ipn@example.com", "password": "password123", "display_name": "IPN",
	})
	if reg.StatusCode != 200 {
		t.Fatalf("register: %d %v", reg.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	reg, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "IPN Org", "slug": "ipn-org"})
	if reg.StatusCode != 201 {
		t.Fatalf("create org: %d %v", reg.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	const planID = "01TESTPLANvnpay_ipn"
	const intentID = "01TESTVNAPYHANDLER0001"
	for _, stmt := range []string{
		`DELETE FROM plan_features WHERE plan_id = $1`,
		`DELETE FROM plans WHERE id = $1`,
	} {
		if _, err := pool.Exec(t.Context(), stmt, planID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(t.Context(),
		`INSERT INTO plans (id, code, name, price_amount, sort_order, is_default) VALUES ($1, 'vnpay_ipn', 'vnpay_ipn', 500000, 10, false)`,
		planID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(),
		`INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit) SELECT $1, key, true, NULL FROM features`,
		planID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(t.Context(), `INSERT INTO billing_payment_intents (
		id, organization_id, subscription_id, plan_id, provider, provider_txn_ref,
		amount, currency, status, expires_at
	) SELECT $1, s.organization_id, s.id, $2, 'vnpay', $1, 500000, 'VND', 'pending', now() + interval '15 minutes'
	  FROM subscriptions s WHERE s.organization_id = $3`, intentID, planID, orgID); err != nil {
		t.Fatal(err)
	}

	params := map[string]string{
		"vnp_Amount":        "50000000",
		"vnp_BankCode":      "NCB",
		"vnp_CurrCode":      "VND",
		"vnp_ResponseCode":  "00",
		"vnp_TmnCode":       tmn,
		"vnp_TransactionNo": "9001",
		"vnp_TxnRef":        intentID,
	}
	billing.SignIPNForTest(params, secret)
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	res, err = srv.Client().Get(srv.URL + "/api/v1/billing/webhooks/vnpay?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	assertVNPayIPN(t, res, "00")
}

func assertVNPayIPN(t *testing.T, res *http.Response, want string) {
	t.Helper()
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["RspCode"] != want || body["Message"] == "" {
		t.Fatalf("body = %#v, want RspCode %s", body, want)
	}
}
