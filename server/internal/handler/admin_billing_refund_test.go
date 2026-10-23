package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminRefundInvoiceRejectsNonPositiveAmount(t *testing.T) {
	h := &handlers{}
	for _, body := range []string{
		`{"reason":"hoàn với số tiền không hợp lệ","refund_amount":0}`,
		`{"reason":"hoàn với số tiền không hợp lệ","refund_amount":-1}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/invoices/x/refund", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.adminRefundInvoice(rec, req)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_refund_amount") {
			t.Fatalf("body %s: %d %s", body, rec.Code, rec.Body.String())
		}
	}
}
