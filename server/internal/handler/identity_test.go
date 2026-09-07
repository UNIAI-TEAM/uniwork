package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// enrolMFA walks the settings flow over HTTP and returns the TOTP secret
// plus the recovery codes the confirm step showed once.
func enrolMFA(t *testing.T, srv *httptest.Server, token string) (string, []string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/me/mfa/setup", token, nil)
	if res.StatusCode != 200 || out["secret"] == "" || out["otpauth_url"] == "" {
		t.Fatalf("setup: %d %v", res.StatusCode, out)
	}
	secret := out["secret"].(string)
	code, _ := auth.TOTPCode(secret, time.Now())
	res, out = doJSON(t, srv, "POST", "/api/v1/me/mfa/confirm", token, map[string]string{"code": code})
	if res.StatusCode != 200 {
		t.Fatalf("confirm: %d %v", res.StatusCode, out)
	}
	raw := out["recovery_codes"].([]any)
	codes := make([]string, len(raw))
	for i, c := range raw {
		codes[i] = c.(string)
	}
	return secret, codes
}

func TestMFALoginOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)
	secret, codes := enrolMFA(t, srv, w.token)

	res, out := doJSON(t, srv, "GET", "/api/v1/me", w.token, nil)
	if res.StatusCode != 200 || out["user"].(map[string]any)["mfa_enabled_at"] == nil {
		t.Fatalf("me must show mfa_enabled_at: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "audit@example.com", "password": "password123"})
	if res.StatusCode != 200 || out["mfa_required"] != true || out["access_token"] != nil {
		t.Fatalf("login with MFA on: %d %v", res.StatusCode, out)
	}
	mfaToken := out["mfa_token"].(string)
	// The challenge token must not open a Bearer route.
	res, _ = doJSON(t, srv, "GET", "/api/v1/me", mfaToken, nil)
	if res.StatusCode != 401 {
		t.Fatalf("challenge token as bearer: %d, want 401", res.StatusCode)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/mfa/verify", "", map[string]string{"mfa_token": mfaToken, "code": "000000"})
	if res.StatusCode != 401 {
		t.Fatalf("wrong code: %d %v", res.StatusCode, out)
	}
	code, _ := auth.TOTPCode(secret, time.Now())
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/mfa/verify", "", map[string]string{"mfa_token": mfaToken, "code": code})
	if res.StatusCode != 200 || out["access_token"] == nil {
		t.Fatalf("verify: %d %v", res.StatusCode, out)
	}
	hasRefresh := false
	for _, c := range res.Cookies() {
		if c.Name == refreshCookie && c.Value != "" {
			hasRefresh = true
		}
	}
	if !hasRefresh {
		t.Fatal("verify must set the refresh cookie")
	}

	// Recovery code disables MFA; a used one is refused.
	res, out = doJSON(t, srv, "POST", "/api/v1/me/mfa/disable", w.token, map[string]string{"code": codes[0]})
	if res.StatusCode != 200 || out["user"].(map[string]any)["mfa_enabled_at"] != nil {
		t.Fatalf("disable: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "audit@example.com", "password": "password123"})
	if res.StatusCode != 200 || out["access_token"] == nil {
		t.Fatalf("login after disable: %d %v", res.StatusCode, out)
	}
}

func TestSessionsOverHTTP(t *testing.T) {
	srv := newTestServer(t)
	w := buildAuditWorld(t, srv)
	res, second := doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "audit@example.com", "password": "password123"})
	if res.StatusCode != 200 {
		t.Fatalf("second login: %d", res.StatusCode)
	}
	res, out := doJSON(t, srv, "GET", "/api/v1/me/sessions", w.token, nil)
	sessions := out["sessions"].([]any)
	if res.StatusCode != 200 || len(sessions) != 2 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	var currentID, otherID string
	for _, s := range sessions {
		m := s.(map[string]any)
		if m["current"] == true {
			currentID = m["id"].(string)
		} else {
			otherID = m["id"].(string)
		}
	}
	if currentID == "" || otherID == "" {
		t.Fatalf("exactly one session is current: %v", sessions)
	}
	res, _ = doJSON(t, srv, "DELETE", "/api/v1/me/sessions/"+otherID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("revoke: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "DELETE", "/api/v1/me/sessions/"+otherID, w.token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("revoke twice: %d, want 404", res.StatusCode)
	}
	// The other session's bearer still works until its access token expires
	// (spec §4.3), but its refresh chain is gone.
	res, _ = doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "audit@example.com", "password": "password123"})
	if res.StatusCode != 200 {
		t.Fatal("third login")
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/sessions/revoke-others", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("revoke others: %d", res.StatusCode)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/me/sessions", w.token, nil)
	if res.StatusCode != 200 || len(out["sessions"].([]any)) != 1 {
		t.Fatalf("after revoke-others: %v", out)
	}
	_ = second
}

func TestDeleteAccountOverHTTP(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)
	// The world's owner cannot go; a plain member can.
	res, out := doJSON(t, srv, "POST", "/api/v1/me/delete", w.token, map[string]string{"password": "password123"})
	if res.StatusCode != 409 || out["error"].(map[string]any)["code"] != "owner_must_transfer" {
		t.Fatalf("owner delete: %d %v", res.StatusCode, out)
	}
	res, member := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{"email": "gone@example.com", "password": "password123", "display_name": "Gone"})
	if res.StatusCode != 200 {
		t.Fatal("register member")
	}
	token := member["access_token"].(string)
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/delete", token, map[string]string{"password": "nope"})
	if res.StatusCode != 401 {
		t.Fatalf("wrong password: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/me/delete", token, map[string]string{"password": "password123"})
	if res.StatusCode != 200 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/auth/login", "", map[string]string{"email": "gone@example.com", "password": "password123"})
	if res.StatusCode != 401 {
		t.Fatalf("login after delete: %d, want 401", res.StatusCode)
	}
	u, err := db.New(pool).GetUserByID(t.Context(), member["user"].(map[string]any)["id"].(string))
	if err != nil || !u.DeletedAt.Valid || u.Email == "gone@example.com" {
		t.Fatalf("row not anonymised: %+v %v", u, err)
	}
}

func TestPlatformRoleNeedsMFA(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	w := buildAuditWorld(t, srv)
	if _, err := d.Admin.SetPlatformRole(t.Context(), service.CLIActor, "audit@example.com", "support", "test fixture grant"); err != nil {
		t.Fatal(err)
	}
	res, out := doJSON(t, srv, "GET", "/api/v1/admin/me", w.token, nil)
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "mfa_required" {
		t.Fatalf("platform role without MFA: %d %v, want 403 mfa_required", res.StatusCode, out)
	}
	enrolMFA(t, srv, w.token)
	res, out = doJSON(t, srv, "GET", "/api/v1/admin/me", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("with MFA: %d %v", res.StatusCode, out)
	}
	_ = http.StatusOK
}
