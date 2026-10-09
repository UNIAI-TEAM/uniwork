package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	errVNPayConfig             = errors.New("vnpay: incomplete configuration")
	errVNPayBadRequest         = errors.New("vnpay: missing or invalid parameters")
	ErrInvalidWebhookSignature = errors.New("billing: invalid webhook signature")
)

// VNPayConfig holds sandbox or production credentials.
type VNPayConfig struct {
	TMNCode    string
	HashSecret string
	PaymentURL string
	IPNURL     string
	// QueryURL is the merchant querydr/refund endpoint. Empty uses the sandbox default.
	QueryURL string
}

// VNPay implements Provider for VNPay Payment Gateway v2.
type VNPay struct {
	cfg VNPayConfig
	loc *time.Location
	now func() time.Time
}

func NewVNPay(cfg VNPayConfig) (*VNPay, error) {
	if strings.TrimSpace(cfg.TMNCode) == "" || strings.TrimSpace(cfg.HashSecret) == "" {
		return nil, errVNPayConfig
	}
	if strings.TrimSpace(cfg.PaymentURL) == "" {
		cfg.PaymentURL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
	}
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		loc = time.FixedZone("ICT", 7*3600)
	}
	return &VNPay{cfg: cfg, loc: loc, now: time.Now}, nil
}

func (v *VNPay) Name() string { return "vnpay" }

func (v *VNPay) CreateCheckout(_ context.Context, in CheckoutInput) (CheckoutSession, error) {
	if in.IntentID == "" || in.Amount <= 0 {
		return CheckoutSession{}, ErrProviderUnavailable
	}
	orderInfo := in.OrderInfo
	if orderInfo == "" {
		orderInfo = "UniWork billing"
	}
	currency := in.Currency
	if currency == "" {
		currency = "VND"
	}
	ipAddr := strings.TrimSpace(in.ClientIP)
	if ipAddr == "" {
		ipAddr = "127.0.0.1"
	}
	params := map[string]string{
		"vnp_Version":    "2.1.0",
		"vnp_Command":    "pay",
		"vnp_TmnCode":    v.cfg.TMNCode,
		"vnp_Amount":     strconv.FormatInt(in.Amount*100, 10),
		"vnp_CurrCode":   currency,
		"vnp_TxnRef":     in.IntentID,
		"vnp_OrderInfo":  orderInfo,
		"vnp_OrderType":  "other",
		"vnp_Locale":     "vn",
		"vnp_ReturnUrl":  in.SuccessURL,
		"vnp_IpAddr":     ipAddr,
		"vnp_CreateDate": v.now().In(v.loc).Format("20060102150405"),
	}
	payURL, err := vnpBuildPaymentURL(v.cfg.PaymentURL, params, v.cfg.HashSecret)
	if err != nil {
		return CheckoutSession{}, err
	}
	return CheckoutSession{URL: payURL}, nil
}

func (v *VNPay) ParseWebhook(r *http.Request) (Event, error) {
	params, err := vnpParamsFromRequest(r)
	if err != nil {
		return Event{}, err
	}
	if err := vnpVerify(params, v.cfg.HashSecret, v.cfg.TMNCode); err != nil {
		return Event{}, err
	}
	txnRef := params["vnp_TxnRef"]
	if txnRef == "" {
		return Event{}, errVNPayBadRequest
	}
	eventID := params["vnp_TransactionNo"]
	if eventID == "" {
		eventID = txnRef + ":" + params["vnp_ResponseCode"]
	}
	amountMinor, _ := strconv.ParseInt(params["vnp_Amount"], 10, 64)
	evType := "invoice.failed"
	paid := params["vnp_ResponseCode"] == "00"
	if paid {
		evType = "invoice.paid"
	}
	return Event{
		ProviderEventID: eventID,
		ProviderTxnRef:  txnRef,
		Type:            evType,
		Paid:            paid,
		Amount:          amountMinor / 100,
		Currency:        params["vnp_CurrCode"],
		RawParams:       params,
	}, nil
}

func vnpParamsFromRequest(r *http.Request) (map[string]string, error) {
	if r == nil {
		return nil, errVNPayBadRequest
	}
	q := r.URL.Query()
	if len(q) == 0 && r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			return nil, err
		}
		q = r.PostForm
	}
	if len(q) == 0 {
		return nil, errVNPayBadRequest
	}
	out := make(map[string]string, len(q))
	for k, vals := range q {
		if len(vals) > 0 {
			out[k] = vals[0]
		}
	}
	return out, nil
}

func vnpVerify(params map[string]string, secret, tmnCode string) error {
	got := params["vnp_SecureHash"]
	if got == "" {
		return ErrInvalidWebhookSignature
	}
	if tmnCode != "" && params["vnp_TmnCode"] != tmnCode {
		return ErrInvalidWebhookSignature
	}
	want := vnpSign(params, secret)
	if !hmac.Equal([]byte(strings.ToUpper(got)), []byte(strings.ToUpper(want))) {
		return ErrInvalidWebhookSignature
	}
	return nil
}

// vnpEncode matches PHP urlencode (spaces as '+') used in VNPay hash samples.
func vnpEncode(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "%20", "+")
}

func vnpSign(params map[string]string, secret string) string {
	return vnpSignString(vnpHashData(params), secret)
}

// vnpSignString is HMAC-SHA512 over a prebuilt checksum (querydr and refund use a pipe-joined string).
func vnpSignString(data, secret string) string {
	mac := hmac.New(sha512.New, []byte(secret))
	_, _ = mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

func vnpHashData(params map[string]string) string {
	var keys []string
	for k, val := range params {
		if k == "vnp_SecureHash" || k == "vnp_SecureHashType" {
			continue
		}
		if strings.TrimSpace(val) == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, vnpEncode(k)+"="+vnpEncode(params[k]))
	}
	return strings.Join(pairs, "&")
}

func vnpBuildPaymentURL(base string, params map[string]string, secret string) (string, error) {
	hash := vnpSign(params, secret)
	var keys []string
	for k, val := range params {
		if strings.TrimSpace(val) == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(strings.TrimRight(base, "?"))
	b.WriteByte('?')
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(vnpEncode(k))
		b.WriteByte('=')
		b.WriteString(vnpEncode(params[k]))
	}
	if len(keys) > 0 {
		b.WriteByte('&')
	}
	b.WriteString("vnp_SecureHash=")
	b.WriteString(hash)
	return b.String(), nil
}
