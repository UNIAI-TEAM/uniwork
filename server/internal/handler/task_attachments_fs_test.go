package handler

// HTTP-level proof of the FileService path (UNI-744, T6): the same routes as
// the legacy suite, but with filesfake injected through the service setters.
// The service tests pin transaction semantics; these pin that the handlers
// read `purpose` off the multipart form and that avatar responses carry a
// presigned URL at emission.

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func fsMutationWorld(t *testing.T) (*httptest.Server, string, string, *db.Queries) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	fake := filesfake.New(filesfake.Options{})
	d.Tasks.SetFiles(fake)
	d.Auth.SetFiles(fake)
	d.Actors.SetFiles(fake)
	d.Workspaces.SetFiles(fake)
	d.OrgMembers.SetFiles(fake)
	d.People.SetFiles(fake)
	d.Meetings.SetFiles(fake)
	q := db.New(pool)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "suite-fs@example.com", "password": "password123", "display_name": "Suite FS",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "Suite Org FS", "slug": "suite-org-fs",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "Suite WS FS", "slug": "suite-ws-fs",
	})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	return srv, token, wsID, q
}

func uploadAttachmentWithPurpose(
	t *testing.T, srv *httptest.Server, token, url, filename, declaredType, purpose string, content []byte,
) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {declaredType},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if purpose != "" {
		if err := mw.WriteField("purpose", purpose); err != nil {
			t.Fatal(err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, url, &body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestTaskAttachmentFSHTTPRoundTrip(t *testing.T) {
	srv, token, wsID, _ := fsMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "FS attachment HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("task = %v", body)
	}

	payload := []byte("# hello fs attachment\n")
	res = uploadAttachmentWithPurpose(t, srv, token,
		srv.URL+"/api/v1/tasks/"+taskID+"/attachments", "note.md", "text/markdown", "task_attachment", payload)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("upload status = %d body=%s", res.StatusCode, raw)
	}
	var uploaded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&uploaded); err != nil {
		t.Fatal(err)
	}
	attID, _ := uploaded["id"].(string)
	if attID == "" || uploaded["filename"] != "note.md" {
		t.Fatalf("upload body = %v", uploaded)
	}
	if _, ok := uploaded["object_key"]; ok {
		t.Fatalf("object_key must not be exposed: %v", uploaded)
	}
	url, _ := uploaded["url"].(string)
	if !strings.HasSuffix(url, "/api/v1/attachments/"+attID+"/content") {
		t.Fatalf("url = %q", url)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/attachments/"+attID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	contentRes, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer contentRes.Body.Close()
	if contentRes.StatusCode != 200 {
		t.Fatalf("content status = %d", contentRes.StatusCode)
	}
	got, _ := io.ReadAll(contentRes.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("content = %q", got)
	}

	res, body = doJSON(t, srv, http.MethodDelete, "/api/v1/attachments/"+attID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d %v", res.StatusCode, body)
	}
	res, _ = doJSON(t, srv, "GET", "/api/v1/attachments/"+attID, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("get after delete = %d", res.StatusCode)
	}
}

func TestTaskAttachmentFSHTTPAcceptsMP4ByBytes(t *testing.T) {
	w := newFilesWorld(t)

	res, body := doJSON(t, w.srv, http.MethodPost, "/api/v1/workspaces/"+w.wsID+"/tasks", w.token, map[string]any{
		"title": "MP4 attachment",
	})
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("task = %v", body)
	}

	var mp4 []byte
	for _, sample := range filescontract.Samples() {
		if sample.Name == "mp4" {
			mp4 = sample.Body
			break
		}
	}
	if len(mp4) == 0 {
		t.Fatal("files contract has no MP4 sample")
	}

	res = uploadAttachmentWithPurpose(t, w.srv, w.token,
		w.srv.URL+"/api/v1/tasks/"+taskID+"/attachments",
		"demo.mp4", "application/octet-stream", "task_attachment", mp4)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("upload status = %d body=%s", res.StatusCode, raw)
	}
	var uploaded map[string]any
	if err := json.NewDecoder(res.Body).Decode(&uploaded); err != nil {
		t.Fatal(err)
	}
	if got := uploaded["content_type"]; got != "video/mp4" {
		t.Fatalf("content_type = %v, want video/mp4", got)
	}
	attID, _ := uploaded["id"].(string)
	att, err := w.q.GetAttachmentByID(t.Context(), attID)
	if err != nil {
		t.Fatal(err)
	}
	if !att.FileID.Valid || att.FileID.String == "" || att.ObjectKey.Valid {
		t.Fatalf("attachment did not use FileService: file_id=%+v object_key=%+v", att.FileID, att.ObjectKey)
	}

	req, err := http.NewRequest(http.MethodGet, w.srv.URL+"/api/v1/attachments/"+attID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+w.token)
	contentRes, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer contentRes.Body.Close()
	if contentRes.StatusCode != http.StatusOK {
		t.Fatalf("content status = %d", contentRes.StatusCode)
	}
	got, err := io.ReadAll(contentRes.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, mp4) {
		t.Fatalf("content bytes changed: got %d bytes, want %d", len(got), len(mp4))
	}
}

func TestWorkspaceAttachmentFSStageThenClaimOnTaskCreate(t *testing.T) {
	srv, token, wsID, _ := fsMutationWorld(t)

	payload := []byte("staged fs bytes\n")
	res := uploadAttachmentWithPurpose(t, srv, token,
		srv.URL+"/api/v1/workspaces/"+wsID+"/attachments", "stage.txt", "text/plain", "task_attachment", payload)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("stage upload status = %d body=%s", res.StatusCode, raw)
	}
	var staged map[string]any
	if err := json.NewDecoder(res.Body).Decode(&staged); err != nil {
		t.Fatal(err)
	}
	attID, _ := staged["id"].(string)
	if attID == "" {
		t.Fatalf("staged = %v", staged)
	}

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title":          "claims staged",
		"attachment_ids": []string{attID},
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	atts, _ := body["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("attachments = %v, want the staged row bound", body)
	}

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/attachments/"+attID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	contentRes, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer contentRes.Body.Close()
	if contentRes.StatusCode != 200 {
		t.Fatalf("content status = %d", contentRes.StatusCode)
	}
	got, _ := io.ReadAll(contentRes.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("content = %q", got)
	}
}

func TestUploadAvatarFSPresignsURL(t *testing.T) {
	srv, token, _, _ := fsMutationWorld(t)

	res := uploadAvatar(t, srv, token, "me.png", "image/png", tinyPNG)
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d body=%s, want 200", res.StatusCode, raw)
	}
	var out struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if !strings.HasPrefix(out.User.AvatarURL, "fake://presign/") {
		t.Fatalf("avatar_url = %q, want a presigned URL", out.User.AvatarURL)
	}

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	me, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer me.Body.Close()
	var meOut struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	_ = json.NewDecoder(me.Body).Decode(&meOut)
	if !strings.HasPrefix(meOut.User.AvatarURL, "fake://presign/") {
		t.Fatalf("/me avatar_url = %q, want presigned", meOut.User.AvatarURL)
	}
}

func TestUploadAvatarFSRejectsOversize(t *testing.T) {
	srv, token, _, _ := fsMutationWorld(t)

	res := uploadAvatar(t, srv, token, "big.png", "image/png", make([]byte, 3<<20))
	defer res.Body.Close()
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", res.StatusCode)
	}
}
