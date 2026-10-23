package handler

import "testing"

// TestReauthPasswordIsRefusedWithout401 pins the split between signing in and
// re-entering a password. A wrong password at login is 401 invalid_credentials;
// a wrong password re-entered by someone already signed in (handing an
// organization over) is 403 password_incorrect. A 401 there would read as an
// expired session: the client would refresh and replay the request, checking
// the password twice and sending it twice.
func TestReauthPasswordIsRefusedWithout401(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, _ := signUp(t, srv, "chuyen-chu@example.com", "Chủ")
	memberToken, memberID := signUp(t, srv, "chuyen-tv@example.com", "Thành viên")

	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Chuyển", "slug": "chuyen-quyen"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", ownerToken, map[string]string{"name": "Đội", "slug": "chuyen-quyen-doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", ownerToken,
		map[string]any{"emails": []string{"chuyen-tv@example.com"}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	acceptInvitation(t, srv, memberToken)

	transfer := func(password string) (int, map[string]any) {
		t.Helper()
		res, out := doJSON(t, srv, "POST", "/api/v1/orgs/chuyen-quyen/transfer-ownership", ownerToken,
			map[string]string{"to_user_id": memberID, "password": password})
		return res.StatusCode, out
	}
	if status, out := transfer("wrong-password"); status != 403 || errorCode(out) != "password_incorrect" {
		t.Fatalf("wrong re-entered password: %d %v", status, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/auth/login", "",
		map[string]string{"email": "chuyen-chu@example.com", "password": "wrong-password"}); res.StatusCode != 401 || errorCode(out) != "invalid_credentials" {
		t.Fatalf("wrong password at login: %d %v", res.StatusCode, out)
	}
	if status, out := transfer("password123"); status != 200 {
		t.Fatalf("transfer: %d %v", status, out)
	}
}
