package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Step 0 regression tests for the task attachment module (UNI-744, plan T6).
// They pin the legacy HTTP surface the FileService migration must keep, plus
// the two-organization case: another org's member guessing the id or URL is
// refused, with the right status and without leaking bytes.

// registerOrgWorkspace walks a brand-new account through registration, email
// verification, organization and workspace creation over HTTP, and returns the
// bearer token with the workspace id.
func registerOrgWorkspace(t *testing.T, srv *httptest.Server, email, name, slug string) (string, string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": name,
	})
	if res.StatusCode != 200 {
		t.Fatalf("register %s: %d %v", email, res.StatusCode, out)
	}
	token, _ := out["access_token"].(string)
	if token == "" {
		t.Fatalf("register %s returned no token: %v", email, out)
	}
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": name + " Org", "slug": slug,
	})
	if res.StatusCode != 201 {
		t.Fatalf("create org %s: %d %v", slug, res.StatusCode, out)
	}
	orgID, _ := out["organization"].(map[string]any)["id"].(string)
	if orgID == "" {
		t.Fatalf("create org %s returned no id: %v", slug, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": name + " WS", "slug": slug + "-ws",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create workspace for %s: %d %v", slug, res.StatusCode, out)
	}
	wsID, _ := out["workspace"].(map[string]any)["id"].(string)
	if wsID == "" {
		t.Fatalf("create workspace for %s returned no id: %v", slug, out)
	}
	return token, wsID
}

func TestAttachmentHTTPFromAnotherOrganizationIsBlocked(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	srv := newTestServer(t)

	ownerToken, wsID := registerOrgWorkspace(t, srv, "owner-att@example.com", "Chu so huu", "org-owner-att")
	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", ownerToken, map[string]any{
		"title": "Tenant file",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("create task returned no id: %v", body)
	}

	payload := []byte("owner only\n")
	up := uploadTaskAttachment(t, srv, ownerToken, taskID, "private.txt", "text/plain", payload)
	defer up.Body.Close()
	if up.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(up.Body)
		t.Fatalf("owner upload = %d %s", up.StatusCode, raw)
	}
	var uploaded map[string]any
	if err := json.NewDecoder(up.Body).Decode(&uploaded); err != nil {
		t.Fatal(err)
	}
	attID, _ := uploaded["id"].(string)
	if attID == "" {
		t.Fatalf("upload returned no id: %v", uploaded)
	}

	otherToken, otherWS := registerOrgWorkspace(t, srv, "other-att@example.com", "Nguoi khac", "org-other-att")
	if otherWS == wsID {
		t.Fatal("second account landed in the same workspace")
	}

	guesses := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/attachments/" + attID},
		{http.MethodGet, "/api/v1/attachments/" + attID + "/download"},
		{http.MethodDelete, "/api/v1/attachments/" + attID},
		{http.MethodGet, "/api/v1/tasks/" + taskID + "/attachments"},
	}
	for _, g := range guesses {
		res, out := doJSON(t, srv, g.method, g.path, otherToken, nil)
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("%s %s = %d %v, want 403", g.method, g.path, res.StatusCode, out)
		}
	}

	// The content route streams, so it is read raw: a 403 must not carry the
	// file, and the owner must still get the exact bytes afterwards.
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/attachments/"+attID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+otherToken)
	blocked, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	blockedBody, _ := io.ReadAll(blocked.Body)
	blocked.Body.Close()
	if blocked.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-org content read = %d %s, want 403", blocked.StatusCode, blockedBody)
	}
	if strings.Contains(string(blockedBody), "owner only") {
		t.Fatalf("cross-org content read leaked bytes: %s", blockedBody)
	}

	req, err = http.NewRequest(http.MethodGet, srv.URL+"/api/v1/attachments/"+attID+"/download", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+ownerToken)
	owner, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Body.Close()
	if owner.StatusCode != http.StatusOK {
		t.Fatalf("owner download after blocked guesses = %d", owner.StatusCode)
	}
	got, _ := io.ReadAll(owner.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("owner download body changed: %q", got)
	}
}

func TestUploadTaskAttachmentOverCapIsRejected(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	srv := newTestServer(t)
	token, wsID := registerOrgWorkspace(t, srv, "cap-att@example.com", "Cap", "org-cap-att")

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{"title": "Cap"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	// The UI lets up to 100 MiB through; this route caps at 25 MiB
	// (service.MaxAttachmentBytes) and must say so instead of truncating.
	over := bytes.Repeat([]byte("x"), (25<<20)+1)
	up := uploadTaskAttachment(t, srv, token, taskID, "big.txt", "text/plain", over)
	defer up.Body.Close()
	raw, _ := io.ReadAll(up.Body)
	if up.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("over-cap upload = %d %s, want 413", up.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "too_large") {
		t.Fatalf("over-cap error body = %s, want code too_large", raw)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list after over-cap upload: %d %v", res.StatusCode, body)
	}
	if atts, _ := body["attachments"].([]any); len(atts) != 0 {
		t.Fatalf("over-cap upload left a row behind: %v", atts)
	}
}

func TestUploadTaskAttachmentRejectsDisallowedType(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	srv := newTestServer(t)
	token, wsID := registerOrgWorkspace(t, srv, "type-att@example.com", "Loai tep", "org-type-att")

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{"title": "Type"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	up := uploadTaskAttachment(t, srv, token, taskID, "evil.exe", "application/x-msdownload", []byte("MZ\x00\x00"))
	defer up.Body.Close()
	raw, _ := io.ReadAll(up.Body)
	if up.StatusCode != http.StatusBadRequest {
		t.Fatalf("disallowed type upload = %d %s, want 400", up.StatusCode, raw)
	}
	if !strings.Contains(string(raw), "attachment_mime_rejected") {
		t.Fatalf("disallowed type error body = %s", raw)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list after rejected upload: %d %v", res.StatusCode, body)
	}
	if atts, _ := body["attachments"].([]any); len(atts) != 0 {
		t.Fatalf("rejected upload left a row behind: %v", atts)
	}
}
