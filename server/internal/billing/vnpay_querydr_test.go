package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestVNPayQueryDRTimesOutOnHungServer(t *testing.T) {
	prev := vnpHTTP.Timeout
	vnpHTTP.Timeout = 50 * time.Millisecond
	t.Cleanup(func() { vnpHTTP.Timeout = prev })

	hung, release := context.WithCancel(context.Background())
	t.Cleanup(release)
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-hung.Done()
	}))
	t.Cleanup(func() {
		release()
		srv.Close()
	})

	v, err := NewVNPay(VNPayConfig{TMNCode: "TMNTEST1", HashSecret: "testsecret", QueryURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	_, err = v.QueryTransaction(context.Background(), QueryTransactionInput{TxnRef: "01INTENT0000000001"})
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("hung querydr returned success")
	}
	if !clientTimedOut(err) {
		t.Fatalf("want a client timeout, got %v", err)
	}
	if strings.Contains(err.Error(), "querydr response") {
		t.Fatalf("timeout treated as a VNPay rejection: %v", err)
	}
	if elapsed > time.Second {
		t.Fatalf("querydr blocked for %s", elapsed)
	}
}

func clientTimedOut(err error) bool {
	var netErr net.Error
	return (errors.As(err, &netErr) && netErr.Timeout()) ||
		errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "Client.Timeout")
}
