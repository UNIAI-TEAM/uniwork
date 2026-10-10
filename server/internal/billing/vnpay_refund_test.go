package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestVNPayRefundSignAndCall(t *testing.T) {
	secret := "testsecret"
	var got map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		resp := map[string]string{
			"vnp_ResponseId":        "VNPREF1",
			"vnp_Command":           "refund",
			"vnp_ResponseCode":      "00",
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            got["vnp_TxnRef"],
			"vnp_Amount":            got["vnp_Amount"],
			"vnp_BankCode":          "NCB",
			"vnp_PayDate":           "20261008120000",
			"vnp_TransactionNo":     "14312345",
			"vnp_TransactionType":   "02",
			"vnp_TransactionStatus": "00",
			"vnp_OrderInfo":         got["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = vnpRefundResponseSign(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	v, err := NewVNPay(VNPayConfig{TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	v.now = func() time.Time { return time.Date(2026, 10, 8, 12, 0, 0, 0, time.FixedZone("ICT", 7*3600)) }
	res, err := v.Refund(context.Background(), RefundInput{
		TxnRef: "01INTENT0000000001", TransactionDate: time.Date(2026, 10, 7, 16, 45, 0, 0, time.UTC),
		Amount: 1499000, OrderInfo: "Hoàn tiền test", CreateBy: "admin1", ClientIP: "127.0.0.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK() || res.TransactionNo != "14312345" || got["vnp_Command"] != "refund" || got["vnp_Amount"] != "149900000" {
		t.Fatalf("refund: %+v got=%v", res, got)
	}
}
