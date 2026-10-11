package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIdempotencyKeyFormat(t *testing.T) {
	cases := []struct {
		name string
		key  string
		want int
	}{
		{"absent", "", http.StatusNoContent},
		{"uuid", "0b7f3c1e-5a52-4c43-9a0d-6a0c3f1d2e9b", http.StatusNoContent},
		{"printable ascii", "upload:doc 1/v2~x", http.StatusNoContent},
		{"non ascii utf-8", "kh\u00f3a-\u0111\u1ed9c", http.StatusBadRequest},
		{"invalid utf-8 bytes", "k\xe1\xbb-x", http.StatusBadRequest},
		{"control byte", "k\x01x", http.StatusBadRequest},
		{"too long", strings.Repeat("k", 256), http.StatusBadRequest},
		{"longest accepted", strings.Repeat("k", 255), http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var reached bool
			h := IdempotencyKeyFormat(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached = true
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodPost, "/x", nil)
			if tc.key != "" {
				req.Header["Idempotency-Key"] = []string{tc.key}
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want == http.StatusBadRequest {
				if reached {
					t.Fatal("a refused key reached the handler")
				}
				if !strings.Contains(rec.Body.String(), `"invalid_request"`) {
					t.Fatalf("body = %s, want invalid_request", rec.Body.String())
				}
			}
		})
	}
}
