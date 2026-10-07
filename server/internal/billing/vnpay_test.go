package billing

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestVNPaySignAndVerifyRoundTrip(t *testing.T) {
	t.Parallel()
	secret := "TTRWQASZTUCDIXNUTSZYBQYKAZJFTPO"
	params := map[string]string{
		"vnp_Amount":     "10000000",
		"vnp_Command":    "pay",
		"vnp_CreateDate": "20260101120000",
		"vnp_CurrCode":   "VND",
		"vnp_IpnUrl":     "https://api.example.com/api/v1/billing/webhooks/vnpay",
		"vnp_Locale":     "vn",
		"vnp_OrderInfo":  "UniWork billing",
		"vnp_OrderType":  "other",
		"vnp_ReturnUrl":  "https://app.example.com/org/settings",
		"vnp_TmnCode":    "VJT011BP",
		"vnp_TxnRef":     "01TESTINTENT00000001",
		"vnp_Version":    "2.1.0",
	}
	hash := vnpSign(params, secret)
	params["vnp_SecureHash"] = hash
	if err := vnpVerify(params, secret, "VJT011BP"); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestVNPayCreateCheckoutBuildsURL(t *testing.T) {
	t.Parallel()
	v, err := NewVNPay(VNPayConfig{
		TMNCode: "VJT011BP", HashSecret: "secret", PaymentURL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
	})
	if err != nil {
		t.Fatal(err)
	}
	v.now = func() time.Time { return time.Date(2026, 1, 1, 12, 0, 0, 0, v.loc) }
	sess, err := v.CreateCheckout(context.Background(), CheckoutInput{
		IntentID: "01TESTINTENT00000001", Amount: 100000, SuccessURL: "https://app/ok", OrderInfo: "plan pro",
	})
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(sess.URL)
	if err != nil {
		t.Fatal(err)
	}
	if u.Query().Get("vnp_TxnRef") != "01TESTINTENT00000001" || u.Query().Get("vnp_Amount") != "10000000" {
		t.Fatalf("query: %s", u.RawQuery)
	}
	if u.Query().Get("vnp_IpAddr") != "127.0.0.1" {
		t.Fatalf("IpAddr: %q", u.Query().Get("vnp_IpAddr"))
	}
	if u.Query().Get("vnp_SecureHash") == "" {
		t.Fatal("missing hash")
	}
}

func TestVNPayParseWebhookGET(t *testing.T) {
	t.Parallel()
	secret := "testsecret"
	v, err := NewVNPay(VNPayConfig{TMNCode: "TMN", HashSecret: secret})
	if err != nil {
		t.Fatal(err)
	}
	params := map[string]string{
		"vnp_Amount":        "50000000",
		"vnp_BankCode":      "NCB",
		"vnp_ResponseCode":  "00",
		"vnp_TmnCode":       "TMN",
		"vnp_TransactionNo": "14234567",
		"vnp_TxnRef":        "01INTENT",
		"vnp_CurrCode":      "VND",
	}
	params["vnp_SecureHash"] = vnpSign(params, secret)
	q := url.Values{}
	for k, val := range params {
		q.Set(k, val)
	}
	req := httptest.NewRequest(http.MethodGet, "/?"+q.Encode(), nil)
	ev, err := v.ParseWebhook(req)
	if err != nil {
		t.Fatal(err)
	}
	if !ev.Paid || ev.ProviderTxnRef != "01INTENT" || ev.Amount != 500000 {
		t.Fatalf("event: %+v", ev)
	}
}
