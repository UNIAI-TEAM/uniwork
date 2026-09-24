package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func uploadTaskAttachment(
	t *testing.T, srv *httptest.Server, token, taskID, filename, declaredType string, content []byte,
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
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/tasks/"+taskID+"/attachments", &body)
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

func TestAttachmentHTTPRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")

	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Attachment HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("task = %v", body)
	}

	payload := []byte("# hello attachment\n")
	res = uploadTaskAttachment(t, srv, token, taskID, "note.md", "text/markdown", payload)
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
	downloadURL, _ := uploaded["download_url"].(string)
	if !strings.HasSuffix(url, "/api/v1/attachments/"+attID+"/content") {
		t.Fatalf("url = %q", url)
	}
	if !strings.HasSuffix(downloadURL, "/api/v1/attachments/"+attID+"/download") {
		t.Fatalf("download_url = %q", downloadURL)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, body)
	}
	atts, _ := body["attachments"].([]any)
	if len(atts) != 1 {
		t.Fatalf("list = %v", body)
	}
	listed, _ := atts[0].(map[string]any)
	if _, ok := listed["object_key"]; ok {
		t.Fatalf("list object_key must not be exposed: %v", listed)
	}
	if listed["id"] != attID {
		t.Fatalf("list id = %v", listed)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/attachments/"+attID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get: %d %v", res.StatusCode, body)
	}
	if _, ok := body["object_key"]; ok {
		t.Fatalf("get object_key must not be exposed: %v", body)
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
	if contentRes.Header.Get("Content-Disposition") != "inline" {
		t.Fatalf("content disposition = %q", contentRes.Header.Get("Content-Disposition"))
	}

	req, err = http.NewRequest(http.MethodGet, srv.URL+"/api/v1/attachments/"+attID+"/download", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	dlRes, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer dlRes.Body.Close()
	if dlRes.StatusCode != 200 {
		t.Fatalf("download status = %d", dlRes.StatusCode)
	}
	if !strings.Contains(dlRes.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("download disposition = %q", dlRes.Header.Get("Content-Disposition"))
	}
	got, _ = io.ReadAll(dlRes.Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("download body = %q", got)
	}

	res, body = doJSON(t, srv, http.MethodDelete, "/api/v1/attachments/"+attID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("delete status = %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/attachments/"+attID, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("get after delete = %d %v", res.StatusCode, body)
	}
}

func TestUploadTaskAttachmentRejectsMissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")

	srv, token, wsID, _ := suiteMutationWorld(t)
	_, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "No file",
	})
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("not_file", "x")
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/tasks/"+taskID+"/attachments", &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	up, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer up.Body.Close()
	if up.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", up.StatusCode)
	}
}
