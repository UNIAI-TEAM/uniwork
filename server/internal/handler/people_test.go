package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// signUp registers a verified user and returns their access token and id.
func signUp(t *testing.T, srv *httptest.Server, email, name string) (token, userID string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": name})
	if res.StatusCode != 200 {
		t.Fatalf("register %s: %d %v", email, res.StatusCode, out)
	}
	token = out["access_token"].(string)
	userID = out["user"].(map[string]any)["id"].(string)
	if res, out := doJSON(t, srv, "POST", "/api/v1/me/email/verify", token, map[string]string{"code": testDevCode}); res.StatusCode != 200 {
		t.Fatalf("verify %s: %d %v", email, res.StatusCode, out)
	}
	return token, userID
}

func TestPeopleDirectoryEndToEnd(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, ownerID := signUp(t, srv, "chu@example.com", "Đỗ Thị Hà")
	memberToken, memberID := signUp(t, srv, "an@example.com", "Nguyễn Văn Ân")

	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	// The member joins through a workspace invitation, which is the only path
	// into an organization that exists before org-level invites land.
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", ownerToken, map[string]string{"name": "Đội", "slug": "doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", ownerToken,
		map[string]any{"emails": []string{"an@example.com"}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	acceptInvitation(t, srv, memberToken)

	// A department, then the member placed in it by the owner.
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/unicom/departments", ownerToken,
		map[string]any{"name": "Kỹ thuật", "code": "eng"})
	if res.StatusCode != 201 {
		t.Fatalf("create department: %d %v", res.StatusCode, out)
	}
	deptID := out["department"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "PATCH", "/api/v1/orgs/unicom/people/"+memberID+"/profile", ownerToken,
		map[string]any{"title": "Trưởng nhóm", "department_id": deptID, "manager_id": ownerID, "employee_code": "NV001"})
	if res.StatusCode != 200 {
		t.Fatalf("patch profile: %d %v", res.StatusCode, out)
	}
	person := out["person"].(map[string]any)
	if person["department"].(map[string]any)["name"] != "Kỹ thuật" || person["manager"].(map[string]any)["id"] != ownerID {
		t.Fatalf("profile after patch: %v", person)
	}

	// Accent-insensitive search is the point of the folded search column.
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/unicom/people?q=nguyen+van+an", memberToken, nil)
	if res.StatusCode != 200 || len(out["people"].([]any)) != 1 {
		t.Fatalf("search: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/unicom/people?department_id="+deptID, memberToken, nil)
	if res.StatusCode != 200 || len(out["people"].([]any)) != 1 {
		t.Fatalf("department filter: %d %v", res.StatusCode, out)
	}
	// total counts what the filter matched; total_active is the headcount.
	if out["total"] != float64(1) || out["total_active"] != float64(2) {
		t.Fatalf("department filter totals: %v / %v", out["total"], out["total_active"])
	}

	// A member may not set the fields the company owns.
	res, _ = doJSON(t, srv, "PATCH", "/api/v1/orgs/unicom/people/"+memberID+"/profile", memberToken,
		map[string]any{"employee_code": "NV999"})
	if res.StatusCode != 403 {
		t.Fatalf("member setting employee_code: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "PATCH", "/api/v1/orgs/unicom/people/"+memberID+"/profile", memberToken,
		map[string]any{"title": "Kỹ sư", "phone": "0900000000"})
	if res.StatusCode != 200 {
		t.Fatalf("member editing their own title: %d", res.StatusCode)
	}

	// The export is admin-only and carries a BOM so Excel reads it as UTF-8.
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/orgs/unicom/people.csv", nil)
	req.Header.Set("Authorization", "Bearer "+memberToken)
	csvRes, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if csvRes.StatusCode != 403 {
		t.Fatalf("member export: %d", csvRes.StatusCode)
	}
	req, _ = http.NewRequest("GET", srv.URL+"/api/v1/orgs/unicom/people.csv", nil)
	req.Header.Set("Authorization", "Bearer "+ownerToken)
	csvRes, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := readAll(csvRes)
	if csvRes.StatusCode != 200 || !strings.HasPrefix(csvRes.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("owner export: %d %s", csvRes.StatusCode, csvRes.Header.Get("Content-Type"))
	}
	if len(body) < 3 || body[0] != 0xEF || !strings.Contains(string(body), "Nguyễn Văn Ân") {
		t.Fatalf("csv body: %q", string(body))
	}

	// The export takes the list's filters: the department holds only the member.
	csvRes, body = getCSV(t, srv, "/api/v1/orgs/unicom/people.csv?department_id="+deptID+"&status=active", ownerToken)
	if csvRes.StatusCode != 200 || !strings.Contains(string(body), "Nguyễn Văn Ân") || strings.Contains(string(body), "chu@example.com") {
		t.Fatalf("filtered export: %d %q", csvRes.StatusCode, string(body))
	}
	// A bad filter is a 400 with a JSON body, not a half-written CSV; a member
	// still gets 403 whatever the filter says.
	csvRes, body = getCSV(t, srv, "/api/v1/orgs/unicom/people.csv?status=gone", ownerToken)
	if csvRes.StatusCode != 400 || strings.HasPrefix(csvRes.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("bad status export: %d %s %q", csvRes.StatusCode, csvRes.Header.Get("Content-Type"), string(body))
	}
	if csvRes, _ = getCSV(t, srv, "/api/v1/orgs/unicom/people.csv?role=boss", memberToken); csvRes.StatusCode != 403 {
		t.Fatalf("member export with a bad filter: %d", csvRes.StatusCode)
	}
}

func getCSV(t *testing.T, srv *httptest.Server, path, token string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest("GET", srv.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, err := readAll(res)
	if err != nil {
		t.Fatal(err)
	}
	return res, body
}

func TestOrganizationMemberAdministrationEndToEnd(t *testing.T) {
	srv := newTestServer(t)
	ownerToken, _ := signUp(t, srv, "chu2@example.com", "Chủ")
	memberToken, memberID := signUp(t, srv, "tv@example.com", "Thành Viên")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "Acme", "slug": "acme"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", ownerToken, map[string]string{"name": "Đội", "slug": "doi"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/invitations", ownerToken,
		map[string]any{"emails": []string{"tv@example.com"}, "role": "member"})
	if res.StatusCode != 200 {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	acceptInvitation(t, srv, memberToken)

	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/acme/members/me", memberToken, nil)
	if res.StatusCode != 200 || out["role"] != "member" {
		t.Fatalf("membership: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PATCH", "/api/v1/orgs/acme/members/"+memberID, ownerToken, map[string]string{"role": "admin"})
	if res.StatusCode != 200 || out["member"].(map[string]any)["role"] != "admin" {
		t.Fatalf("promote: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/acme/members/"+memberID+"/deactivate", ownerToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("deactivate: %d", res.StatusCode)
	}
	// From here the whole organization is closed to them, with a code the
	// client can turn into the blocked screen rather than a bare 403.
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/acme/people", memberToken, nil)
	if res.StatusCode != 403 {
		t.Fatalf("deactivated member reading the directory: %d %v", res.StatusCode, out)
	}
	if code := errorCode(out); code != "member_deactivated" {
		t.Fatalf("error code: %q", code)
	}
	// members/me still answers, because that is what the blocked screen reads.
	res, out = doJSON(t, srv, "GET", "/api/v1/orgs/acme/members/me", memberToken, nil)
	if res.StatusCode != 200 || out["deactivated_at"] == "" {
		t.Fatalf("membership while deactivated: %d %v", res.StatusCode, out)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/acme/members/"+memberID+"/reactivate", ownerToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("reactivate: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/acme/leave", memberToken, nil)
	if res.StatusCode != 200 {
		t.Fatalf("leave: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", "/api/v1/orgs/acme/leave", ownerToken, nil)
	if res.StatusCode != 409 {
		t.Fatalf("owner leaving: %d", res.StatusCode)
	}
}

// acceptInvitation reads the invitee's own pending invitation and accepts it.
// The create response deliberately withholds the token: it travels by email.
func acceptInvitation(t *testing.T, srv *httptest.Server, token string) {
	t.Helper()
	res, out := doJSON(t, srv, "GET", "/api/v1/me/invitations", token, nil)
	if res.StatusCode != 200 || len(out["invitations"].([]any)) == 0 {
		t.Fatalf("pending invitations: %d %v", res.StatusCode, out)
	}
	inviteToken := out["invitations"].([]any)[0].(map[string]any)["token"].(string)
	if res, out := doJSON(t, srv, "POST", "/api/v1/invitations/"+inviteToken+"/accept", token, nil); res.StatusCode != 200 {
		t.Fatalf("accept: %d %v", res.StatusCode, out)
	}
}

func errorCode(out map[string]any) string {
	raw, _ := json.Marshal(out["error"])
	var e struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(raw, &e)
	return e.Code
}
