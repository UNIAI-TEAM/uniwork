package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopAuthUnavailableResponsesAreNoStore(t *testing.T) {
	h := &handlers{}
	tests := []struct {
		name string
		h    http.HandlerFunc
		req  *http.Request
	}{
		{name: "start", h: h.desktopStart, req: httptest.NewRequest(http.MethodGet, "/auth/desktop/start", nil)},
		{name: "exchange", h: h.desktopExchange, req: httptest.NewRequest(http.MethodPost, "/auth/desktop/exchange", strings.NewReader(`{}`))},
		{name: "consent command", h: h.desktopConsentCommand, req: httptest.NewRequest(http.MethodPost, "/auth/desktop/authorize", strings.NewReader(`{}`))},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.h(rec, tt.req)
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", got)
			}
			if strings.Contains(rec.Body.String(), "token") {
				t.Fatalf("unavailable response contains a token-like field: %s", rec.Body.String())
			}
		})
	}
}
