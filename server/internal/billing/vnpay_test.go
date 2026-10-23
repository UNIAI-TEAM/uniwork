package billing

import (
	"context"
	"errors"
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

func TestVNPayCreateCheckoutUsesIntentDates(t *testing.T) {
	t.Parallel()
	v, err := NewVNPay(VNPayConfig{
		TMNCode: "VJT011BP", HashSecret: "secret", PaymentURL: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
	})
	if err != nil {
		t.Fatal(err)
	}
	v.now = func() time.Time { return time.Date(2099, 1, 1, 0, 0, 0, 0, v.loc) }
	created := time.Date(2026, 3, 1, 17, 0, 0, 0, v.loc)
	expires := time.Date(2026, 3, 1, 17, 15, 0, 0, v.loc)
	sess, err := v.CreateCheckout(context.Background(), CheckoutInput{
		IntentID: "01TESTINTENT00000001", Amount: 100000, SuccessURL: "https://app/ok",
		CreatedAt: created, ExpiresAt: expires,
	})
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(sess.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got := u.Query().Get("vnp_CreateDate"); got != "20260301170000" {
		t.Fatalf("vnp_CreateDate = %s", got)
	}
	if got := u.Query().Get("vnp_ExpireDate"); got != "20260301171500" {
		t.Fatalf("vnp_ExpireDate = %s", got)
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
	if !ev.Paid || ev.ProviderTxnRef != "01INTENT" || ev.Amount != 500000 || ev.ProviderEventID != "14234567" {
		t.Fatalf("event: %+v", ev)
	}
}

func TestVNPayParseWebhookZeroTransactionNo(t *testing.T) {
	t.Parallel()
	secret := "testsecret"
	v, err := NewVNPay(VNPayConfig{TMNCode: "TMN", HashSecret: secret})
	if err != nil {
		t.Fatal(err)
	}
	parse := func(txnRef string) Event {
		t.Helper()
		params := map[string]string{
			"vnp_Amount":        "49900000",
			"vnp_ResponseCode":  "24",
			"vnp_TmnCode":       "TMN",
			"vnp_TransactionNo": "0",
			"vnp_TxnRef":        txnRef,
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
		return ev
	}
	a := parse("01INTENTA")
	b := parse("01INTENTB")
	if a.ProviderEventID == "0" || b.ProviderEventID == "0" || a.ProviderEventID == b.ProviderEventID {
		t.Fatalf("cancel event ids = %q and %q", a.ProviderEventID, b.ProviderEventID)
	}
	if a.Paid || b.Paid {
		t.Fatalf("cancel IPN marked paid: %+v %+v", a, b)
	}
}

func TestVNPayParseWebhookRejectsTampered(t *testing.T) {
	t.Parallel()
	const secret = "testsecret"
	v, err := NewVNPay(VNPayConfig{TMNCode: "TMN", HashSecret: secret})
	if err != nil {
		t.Fatal(err)
	}
	base := func() map[string]string {
		return map[string]string{
			"vnp_Amount":        "50000000",
			"vnp_BankCode":      "NCB",
			"vnp_ResponseCode":  "24",
			"vnp_TmnCode":       "TMN",
			"vnp_TransactionNo": "14234567",
			"vnp_TxnRef":        "01INTENT",
			"vnp_CurrCode":      "VND",
		}
	}
	parse := func(params map[string]string) error {
		t.Helper()
		q := url.Values{}
		for k, val := range params {
			q.Set(k, val)
		}
		_, err := v.ParseWebhook(httptest.NewRequest(http.MethodGet, "/?"+q.Encode(), nil))
		return err
	}
	cases := []struct {
		name string
		edit func(map[string]string)
	}{
		{name: "response code flipped after signing", edit: func(p map[string]string) {
			p["vnp_SecureHash"] = vnpSign(p, secret)
			p["vnp_ResponseCode"] = "00"
		}},
		{name: "amount changed after signing", edit: func(p map[string]string) {
			p["vnp_SecureHash"] = vnpSign(p, secret)
			p["vnp_Amount"] = "1"
		}},
		{name: "other tmn code signed with the same secret", edit: func(p map[string]string) {
			p["vnp_TmnCode"] = "OTHER"
			p["vnp_SecureHash"] = vnpSign(p, secret)
		}},
		{name: "missing secure hash", edit: func(p map[string]string) {
			p["vnp_SecureHash"] = vnpSign(p, secret)
			delete(p, "vnp_SecureHash")
		}},
		{name: "signed with another secret", edit: func(p map[string]string) {
			p["vnp_SecureHash"] = vnpSign(p, "other-secret")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			params := base()
			tc.edit(params)
			if err := parse(params); !errors.Is(err, ErrInvalidWebhookSignature) {
				t.Fatalf("ParseWebhook err = %v", err)
			}
		})
	}
}

// The digest is HMAC-SHA512 over the PHP-urlencode checksum (VNPay 2.1.0):
// keys sorted, space as '+', '/' as %2F. It was computed outside this package,
// not copied from vnpSign.
func TestVNPaySignKnownAnswer(t *testing.T) {
	t.Parallel()
	params := map[string]string{
		"vnp_Amount":       "18000000",
		"vnp_Command":      "pay",
		"vnp_OrderInfo":    "Thanh toan goi Pro/thang",
		"vnp_ResponseCode": "00",
		"vnp_TmnCode":      "TMN",
		"vnp_TxnRef":       "01INTENT",
	}
	const want = "7e0dc992991486b6970b179eec9bfc00bc9108ab96f6f53fa23030f9b9e5967462d897147b9e126d9d3434a30a60967621c5a5c2b8d33481eeb1a78080745557"
	if got := vnpSign(params, "testsecret"); got != want {
		t.Fatalf("vnpSign = %s", got)
	}
}
