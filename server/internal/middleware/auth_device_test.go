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
		// A DB timeout says nothing about the session: 401 would make the
		// client refresh and, if that fails too, sign the user out (H8).
		{"infrastructure failure is 503, never 401", func(context.Context, string, string) error {
			return errors.New("db down")
		}, http.StatusServiceUnavailable, "unavailable", false},
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
			if tc.wantStatus == http.StatusServiceUnavailable && rec.Header().Get("Retry-After") == "" {
				t.Fatal("503 must carry Retry-After")
			}
		})
	}
}

// A browser session never has a device row, so its token skips the lookup:
// one DB round trip less on every authenticated request.
func TestRequireAuthWithDeviceSkipsTheLookupForWebSessions(t *testing.T) {
	minter := auth.TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	token, err := minter.MintWebSession("user-1", "sess-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	called := false
	check := func(context.Context, string, string) error { called = true; return errors.New("db down") }
	var gotSID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSID = SessionID(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	RequireAuthWithDevice(minter, check)(next).ServeHTTP(rec, req)
	if called || rec.Code != http.StatusOK || gotSID != "sess-1" {
		t.Fatalf("checker called=%v status=%d sid=%q, want false 200 sess-1", called, rec.Code, gotSID)
	}
}
