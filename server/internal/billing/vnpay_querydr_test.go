package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDecodeVNPayJSONMapNumbers(t *testing.T) {
	m, err := decodeVNPayJSONMap([]byte(`{"vnp_ResponseCode":"00","vnp_Amount":1000000}`))
	if err != nil {
		t.Fatal(err)
	}
	if m["vnp_Amount"] != "1000000" {
		t.Fatalf("amount %q", m["vnp_Amount"])
	}
}

func TestVNPayQueryDRSignAndCall(t *testing.T) {
	secret := "testsecret"
	var got map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		wantReq := vnpQueryDRSign(got, secret)
		if got["vnp_SecureHash"] != wantReq {
			t.Fatalf("request hash: got %q want %q", got["vnp_SecureHash"], wantReq)
		}
		resp := map[string]string{
			"vnp_ResponseId":        "VNPQ1",
			"vnp_Command":           "querydr",
			"vnp_ResponseCode":      "00",
			"vnp_Message":           "Success",
			"vnp_TmnCode":           "TMNTEST1",
			"vnp_TxnRef":            got["vnp_TxnRef"],
			"vnp_Amount":            "49900000",
			"vnp_BankCode":          "NCB",
			"vnp_PayDate":           "20261007164500",
			"vnp_TransactionNo":     "14399999",
			"vnp_TransactionType":   "01",
			"vnp_TransactionStatus": "00",
			"vnp_OrderInfo":         got["vnp_OrderInfo"],
		}
		resp["vnp_SecureHash"] = vnpQueryDRResponseSign(resp, secret)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	v, err := NewVNPay(VNPayConfig{TMNCode: "TMNTEST1", HashSecret: secret, QueryURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	ict := time.FixedZone("ICT", 7*3600)
	v.now = func() time.Time { return time.Date(2026, 10, 8, 12, 0, 0, 0, ict) }
	ev, err := v.QueryTransaction(context.Background(), QueryTransactionInput{
		TxnRef:          "01INTENT0000000001",
		TransactionDate: time.Date(2026, 10, 7, 16, 45, 0, 0, ict),
		OrderInfo:       "UniWork billing",
		ClientIP:        "127.0.0.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ev.Paid || ev.RawParams["vnp_TransactionNo"] != "14399999" || got["vnp_Command"] != "querydr" {
		t.Fatalf("querydr: ev=%+v got=%v", ev, got)
	}
}
