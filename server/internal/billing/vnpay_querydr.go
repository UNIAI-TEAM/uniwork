package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

const defaultVNPayQueryURL = "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"

// QueryTransactionInput identifies a Pay checkout to reconcile (C-04 §6.7).
type QueryTransactionInput struct {
	TxnRef          string
	TransactionDate time.Time // intent created_at in ICT
	OrderInfo       string
	ClientIP        string
}

// QueryTransaction calls VNPay querydr and maps a successful payment to Event.
func (v *VNPay) QueryTransaction(ctx context.Context, in QueryTransactionInput) (Event, error) {
	if strings.TrimSpace(in.TxnRef) == "" {
		return Event{}, errVNPayBadRequest
	}
	queryURL := strings.TrimSpace(v.cfg.QueryURL)
	if queryURL == "" {
		queryURL = defaultVNPayQueryURL
	}
	ip := strings.TrimSpace(in.ClientIP)
	if ip == "" {
		ip = "127.0.0.1"
	}
	date := in.TransactionDate.In(v.loc).Format("20060102150405")
	if in.TransactionDate.IsZero() {
		date = v.now().In(v.loc).Format("20060102150405")
	}
	orderInfo := strings.TrimSpace(in.OrderInfo)
	if orderInfo == "" {
		orderInfo = "UniWork billing"
	}
	requestID := util.NewID()
	params := map[string]string{
		"vnp_RequestId":       requestID,
		"vnp_Version":         "2.1.0",
		"vnp_Command":         "querydr",
		"vnp_TmnCode":         v.cfg.TMNCode,
		"vnp_TxnRef":          in.TxnRef,
		"vnp_OrderInfo":       orderInfo,
		"vnp_TransactionDate": date,
		"vnp_CreateDate":      v.now().In(v.loc).Format("20060102150405"),
		"vnp_IpAddr":          ip,
	}
	params["vnp_SecureHash"] = vnpQueryDRSign(params, v.cfg.HashSecret)

	body, err := json.Marshal(params)
	if err != nil {
		return Event{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, queryURL, bytes.NewReader(body))
	if err != nil {
		return Event{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return Event{}, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return Event{}, err
	}
	resp, err := decodeVNPayJSONMap(raw)
	if err != nil {
		return Event{}, fmt.Errorf("vnpay: querydr decode: %w", err)
	}
	if err := vnpVerifyQueryDRResponse(resp, v.cfg.HashSecret); err != nil {
		if code := resp["vnp_ResponseCode"]; code != "" && resp["vnp_SecureHash"] == "" {
			msg := strings.TrimSpace(resp["vnp_Message"])
			if msg == "" {
				msg = "missing SecureHash"
			}
			return Event{}, fmt.Errorf("vnpay: querydr response %q: %s", code, msg)
		}
		return Event{}, err
	}
	if resp["vnp_ResponseCode"] != "00" {
		return Event{}, fmt.Errorf("vnpay: querydr response %q", resp["vnp_ResponseCode"])
	}
	paid := resp["vnp_TransactionStatus"] == "00"
	evType := "invoice.failed"
	if paid {
		evType = "invoice.paid"
	}
	eventID := resp["vnp_TransactionNo"]
	if eventID == "" {
		eventID = in.TxnRef + ":querydr:" + resp["vnp_ResponseCode"]
	}
	var amount int64
	if amt := resp["vnp_Amount"]; amt != "" {
		if n, err := parseVnpayAmountMinor(amt); err == nil {
			amount = n
		}
	}
	return Event{
		ProviderEventID: eventID,
		ProviderTxnRef:  in.TxnRef,
		Type:            evType,
		Paid:            paid,
		Amount:          amount,
		Currency:        resp["vnp_CurrCode"],
		RawParams:       resp,
	}, nil
}

// QueryDRRefundSettled is true when QueryDr reports the original Pay txn was reversed/refunded
// (VNPay vnp_TransactionStatus 04 = reversed, 05 = refunded — merchant portal approval).
// SignQueryDRResponseForTest builds vnp_SecureHash for QueryDr mock responses (tests only).
func SignQueryDRResponseForTest(resp map[string]string, secret string) string {
	return vnpQueryDRResponseSign(resp, secret)
}

func QueryDRRefundSettled(params map[string]string) bool {
	if params["vnp_ResponseCode"] != "00" {
		return false
	}
	switch params["vnp_TransactionStatus"] {
	case "04", "05":
		return true
	default:
		return false
	}
}

// decodeVNPayJSONMap accepts VNPay JSON whose values may be numbers or strings.
func decodeVNPayJSONMap(raw []byte) (map[string]string, error) {
	var loose map[string]json.RawMessage
	if err := json.Unmarshal(raw, &loose); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(loose))
	for k, v := range loose {
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			var n json.Number
			if err2 := json.Unmarshal(v, &n); err2 != nil {
				return nil, fmt.Errorf("field %q: %w", k, err)
			}
			s = n.String()
		}
		out[k] = s
	}
	return out, nil
}

func vnpQueryDRSign(params map[string]string, secret string) string {
	data := strings.Join([]string{
		params["vnp_RequestId"],
		params["vnp_Version"],
		params["vnp_Command"],
		params["vnp_TmnCode"],
		params["vnp_TxnRef"],
		params["vnp_TransactionDate"],
		params["vnp_CreateDate"],
		params["vnp_IpAddr"],
		params["vnp_OrderInfo"],
	}, "|")
	return vnpSignString(data, secret)
}

func vnpVerifyQueryDRResponse(resp map[string]string, secret string) error {
	got := resp["vnp_SecureHash"]
	if got == "" {
		return ErrInvalidWebhookSignature
	}
	want := vnpQueryDRResponseSign(resp, secret)
	if !hmac.Equal([]byte(strings.ToUpper(got)), []byte(strings.ToUpper(want))) {
		return ErrInvalidWebhookSignature
	}
	return nil
}

// vnpQueryDRResponseSign follows VNPay querydr response checksum (includes promotion fields).
func vnpQueryDRResponseSign(resp map[string]string, secret string) string {
	data := strings.Join([]string{
		resp["vnp_ResponseId"],
		resp["vnp_Command"],
		resp["vnp_ResponseCode"],
		resp["vnp_Message"],
		resp["vnp_TmnCode"],
		resp["vnp_TxnRef"],
		resp["vnp_Amount"],
		resp["vnp_BankCode"],
		resp["vnp_PayDate"],
		resp["vnp_TransactionNo"],
		resp["vnp_TransactionType"],
		resp["vnp_TransactionStatus"],
		resp["vnp_OrderInfo"],
		resp["vnp_PromotionCode"],
		resp["vnp_PromotionAmount"],
	}, "|")
	return vnpSignString(data, secret)
}

func parseVnpayAmountMinor(raw string) (int64, error) {
	// shared with service layer; duplicate minimal parse to avoid import cycle
	var minor int64
	for _, ch := range raw {
		if ch < '0' || ch > '9' {
			return 0, errVNPayBadRequest
		}
		minor = minor*10 + int64(ch-'0')
	}
	return minor / 100, nil
}
