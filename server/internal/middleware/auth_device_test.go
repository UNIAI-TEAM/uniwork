package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// codedErr stands in for service.CodedError: middleware only sees the
// CodeValue() carrier, never the service package.
type codedErr struct{ code string }

func (e codedErr) Error() string     { return e.code }
func (e codedErr) CodeValue() string { return e.code }

func TestRequireAuthWithDeviceRejectsARevokedDesktopSession(t *testing.T) {
	minter := auth.TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	token, err := minter.MintSession("user-1", "device-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	cases := []struct {
		name       string
		check      func(context.Context, string, string) error
		wantStatus int
		wantCode   string
		reached    bool
	}{
		{"live session passes", func(context.Context, string, string) error { return nil }, http.StatusOK, "", true},
		{"revoked device is refused with device_revoked", func(_ context.Context, uid, sid string) error {
			if uid != "user-1" || sid != "device-1" {
				t.Errorf("checker got uid=%q sid=%q", uid, sid)
			}
			return codedErr{code: "device_revoked"}
		}, http.StatusUnauthorized, "device_revoked", false},
		{"other checker failure stays a plain unauthorized", func(context.Context, string, string) error {
			return errors.New("db down")
		}, http.StatusUnauthorized, "unauthorized", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reached := false
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				reached = true
				w.WriteHeader(http.StatusOK)
			})
			req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			RequireAuthWithDevice(minter, tc.check)(next).ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus || reached != tc.reached {
				t.Fatalf("status=%d reached=%v, want %d reached=%v", rec.Code, reached, tc.wantStatus, tc.reached)
			}
			if tc.wantCode == "" {
				return
			}
			if got := decodeErrObj(t, rec)["code"]; got != tc.wantCode {
				t.Fatalf("error code = %v, want %s", got, tc.wantCode)
			}
			if tc.wantCode == "device_revoked" && rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("device_revoked response must be no-store, got %q", rec.Header().Get("Cache-Control"))
			}
		})
	}
}
