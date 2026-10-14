package handler

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// workspaceForProfileTest registers a verified owner with one workspace on a
// server whose WorkspaceService has a fake FileService.
func workspaceForProfileTest(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Workspaces.SetFiles(filesfake.New(filesfake.Options{}))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "profile@example.com", "password": "password123", "display_name": "Profile",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Đội Alpha", "slug": "doi-alpha"})
	if res.StatusCode != 201 {
		t.Fatalf("create workspace: %d %v", res.StatusCode, out)
	}
	return srv, token, out["workspace"].(map[string]any)["id"].(string)
}

func postWorkspaceIcon(t *testing.T, srv *httptest.Server, token, wsID string, content []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", "logo.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/workspaces/"+wsID+"/icon", &body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestPatchWorkspaceProfileFields(t *testing.T) {
	srv, token, wsID := workspaceForProfileTest(t)
	res, out := doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID, token, map[string]string{
		"description": "Nhóm làm sản phẩm", "icon_emoji": "🚀",
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch: %d %v", res.StatusCode, out)
	}
	ws := out["workspace"].(map[string]any)
	if ws["description"] != "Nhóm làm sản phẩm" || ws["icon_emoji"] != "🚀" || ws["icon_url"] != "" || ws["task_prefix"] == "" {
		t.Fatalf("workspace = %v", ws)
	}
	if res, _ := doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+wsID, token, map[string]string{}); res.StatusCode != 400 {
		t.Fatalf("empty patch: %d, want 400", res.StatusCode)
	}
}

func TestWorkspaceIconUploadAndRemove(t *testing.T) {
	srv, token, wsID := workspaceForProfileTest(t)
	if res := postWorkspaceIcon(t, srv, token, wsID, docsPNG); res.StatusCode != 200 {
		t.Fatalf("upload: %d", res.StatusCode)
	}
	if res := postWorkspaceIcon(t, srv, token, wsID, []byte("not a picture")); res.StatusCode != 415 {
		t.Fatalf("text upload: %d, want 415", res.StatusCode)
	}
	res, out := doJSON(t, srv, "DELETE", "/api/v1/workspaces/"+wsID+"/icon", token, nil)
	if res.StatusCode != 200 || out["workspace"].(map[string]any)["icon_url"] != "" {
		t.Fatalf("remove: %d %v", res.StatusCode, out)
	}
}
