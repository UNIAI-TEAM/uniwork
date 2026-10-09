package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// RefundInput is a refund for a completed Pay checkout (vnp_Command=refund).
type RefundInput struct {
	TxnRef          string
	TransactionDate time.Time // original pay create date (ICT)
	Amount          int64     // VND units to refund (not minor)
	TransactionType string    // 02 full, 03 partial (VNPay)
	OrderInfo       string
	CreateBy        string
	ClientIP        string
	TransactionNo   string // optional vnp_TransactionNo from IPN
}

// RefundResult is VNPay's response to refund.
type RefundResult struct {
	RequestID         string
	ResponseCode      string
	Message           string
	TransactionNo     string
	TransactionStatus string
	Raw               map[string]string
}

func (r RefundResult) OK() bool { return r.ResponseCode == "00" }

// Refund calls VNPay merchant API refund (C-04).
func (v *VNPay) Refund(ctx context.Context, in RefundInput) (RefundResult, error) {
	if strings.TrimSpace(in.TxnRef) == "" || in.Amount <= 0 {
		return RefundResult{}, errVNPayBadRequest
	}
	queryURL := strings.TrimSpace(v.cfg.QueryURL)
	if queryURL == "" {
		queryURL = defaultVNPayQueryURL
	}
	ip := strings.TrimSpace(in.ClientIP)
	if ip == "" {
		ip = "127.0.0.1"
	}
	txDate := in.TransactionDate.In(v.loc).Format("20060102150405")
	if in.TransactionDate.IsZero() {
		txDate = v.now().In(v.loc).Format("20060102150405")
	}
	createDate := v.now().In(v.loc).Format("20060102150405")
	orderInfo := strings.TrimSpace(in.OrderInfo)
	if orderInfo == "" {
		orderInfo = "UniWork refund"
	}
	createBy := strings.TrimSpace(in.CreateBy)
	if createBy == "" {
		createBy = "uniwork-admin"
	}
	requestID := util.NewID()
	txnNo := strings.TrimSpace(in.TransactionNo)
	txType := strings.TrimSpace(in.TransactionType)
	if txType != "03" {
		txType = "02"
	}
	params := map[string]string{
		"vnp_RequestId":       requestID,
		"vnp_Version":         "2.1.0",
		"vnp_Command":         "refund",
		"vnp_TmnCode":         v.cfg.TMNCode,
		"vnp_TransactionType": txType,
		"vnp_TxnRef":          in.TxnRef,
		"vnp_Amount":          strconvFormatAmountMinor(in.Amount),
		"vnp_OrderInfo":       orderInfo,
		"vnp_TransactionNo":   txnNo,
		"vnp_TransactionDate": txDate,
		"vnp_CreateBy":        createBy,
		"vnp_CreateDate":      createDate,
		"vnp_IpAddr":          ip,
	}
	hash := vnpRefundSign(params, v.cfg.HashSecret)
	bodyParams := make(map[string]string, len(params)+1)
	for k, val := range params {
		if k == "vnp_TransactionNo" && val == "" {
			continue
		}
		bodyParams[k] = val
	}
	bodyParams["vnp_SecureHash"] = hash

	body, err := json.Marshal(bodyParams)
	if err != nil {
		return RefundResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, queryURL, bytes.NewReader(body))
	if err != nil {
		return RefundResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return RefundResult{}, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return RefundResult{}, err
	}
	var resp map[string]string
	if err := json.Unmarshal(raw, &resp); err != nil {
		return RefundResult{}, fmt.Errorf("vnpay: refund decode: %w", err)
	}
	if err := vnpVerifyRefundResponse(resp, v.cfg.HashSecret); err != nil {
		return RefundResult{}, err
	}
	out := RefundResult{
		RequestID:         requestID,
		ResponseCode:      resp["vnp_ResponseCode"],
		Message:           resp["vnp_Message"],
		TransactionNo:     resp["vnp_TransactionNo"],
		TransactionStatus: resp["vnp_TransactionStatus"],
		Raw:               resp,
	}
	if !out.OK() {
		return out, fmt.Errorf("vnpay: refund response %q: %s", out.ResponseCode, out.Message)
	}
	return out, nil
}

func strconvFormatAmountMinor(amountVND int64) string {
	return strconv.FormatInt(amountVND*100, 10)
}

func vnpVerifyRefundResponse(resp map[string]string, secret string) error {
	got := resp["vnp_SecureHash"]
	if got == "" {
		return ErrInvalidWebhookSignature
	}
	want := vnpRefundResponseSign(resp, secret)
	if !hmac.Equal([]byte(strings.ToUpper(got)), []byte(strings.ToUpper(want))) {
		return ErrInvalidWebhookSignature
	}
	return nil
}

func vnpRefundResponseSign(resp map[string]string, secret string) string {
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
	}, "|")
	return vnpSignString(data, secret)
}

func vnpRefundSign(params map[string]string, secret string) string {
	data := strings.Join([]string{
		params["vnp_RequestId"],
		params["vnp_Version"],
		params["vnp_Command"],
		params["vnp_TmnCode"],
		params["vnp_TransactionType"],
		params["vnp_TxnRef"],
		params["vnp_Amount"],
		params["vnp_TransactionNo"],
		params["vnp_TransactionDate"],
		params["vnp_CreateBy"],
		params["vnp_CreateDate"],
		params["vnp_IpAddr"],
		params["vnp_OrderInfo"],
	}, "|")
	return vnpSignString(data, secret)
}
