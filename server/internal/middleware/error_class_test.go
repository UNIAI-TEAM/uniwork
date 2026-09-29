package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

func decodeErrObj(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("error body is not the envelope: %v (%q)", err, rec.Body.String())
	}
	return body["error"]
}

// The 401 a dead or absent session produces rides the same envelope as the
// handler's writer, so it carries the session class a client recovers from.
func TestRequireAuthUnauthorizedCarriesSessionClass(t *testing.T) {
	minter := auth.TokenMinter{Secret: []byte("test-secret"), TTL: time.Minute}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("unauthenticated request reached the handler")
	})

	for _, tc := range []struct {
		name   string
		header string
	}{
		{"missing bearer", ""},
		{"invalid token", "Bearer not-a-token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/x", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			RequireAuth(minter)(next).ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rec.Code)
			}
			errObj := decodeErrObj(t, rec)
			if errObj["code"] != "unauthorized" || errObj["error_class"] != "session" {
				t.Fatalf("error = %v, want unauthorized/session", errObj)
			}
		})
	}
}

type stubPlatformRoles struct {
	role string
	mfa  bool
}

func (s stubPlatformRoles) PlatformRole(ctx context.Context, userID string) (string, bool, error) {
	return s.role, s.mfa, nil
}

// platform_role_insufficient is a permission denial, mfa_required is not in
// the table and must not invent a class.
func TestRequirePlatformRoleErrorClasses(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("request reached the handler")
	})

	t.Run("support on admin route is permission", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/x", nil)
		RequirePlatformRole(stubPlatformRoles{role: "support", mfa: true}, "admin")(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", rec.Code)
		}
		errObj := decodeErrObj(t, rec)
		if errObj["code"] != "platform_role_insufficient" || errObj["error_class"] != "permission" {
			t.Fatalf("error = %v, want platform_role_insufficient/permission", errObj)
		}
	})

	t.Run("mfa gate carries no class", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/x", nil)
		RequirePlatformRole(stubPlatformRoles{role: "admin", mfa: false}, "admin")(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", rec.Code)
		}
		errObj := decodeErrObj(t, rec)
		if errObj["code"] != "mfa_required" {
			t.Fatalf("error = %v, want mfa_required", errObj)
		}
		if _, present := errObj["error_class"]; present {
			t.Fatalf("mfa_required must not carry error_class: %v", errObj)
		}
	})
}
