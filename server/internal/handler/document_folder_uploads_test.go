package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// UNI-2052 w1 over HTTP: the folder upload PLAN route and its config block.

func folderUploadBody() map[string]any {
	return map[string]any{
		"parent_id": nil, "root_name": "Hồ sơ 2026", "share_with_workspace": true,
		"folders": []string{"Hợp đồng"},
		"files": []map[string]any{
			{"file_key": "f-1", "path": "", "filename": "a.md", "size_bytes": 4},
			{"file_key": "f-2", "path": "Hợp đồng", "filename": "b.pdf", "size_bytes": 8},
		},
	}
}

func TestCreateFolderUploadAnswersTheBatch(t *testing.T) {
	z := newZipWorld(t)
	path := "/api/v1/workspaces/" + z.wsID + "/documents/folder-uploads"

	res, out := doJSON(t, z.srv, "POST", path, z.token, folderUploadBody())
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusBadRequest || code != "invalid_request" {
		t.Fatalf("no Idempotency-Key: %d %v", res.StatusCode, out)
	}

	res, out = doJSONHeaders(t, z.srv, "POST", path, z.token, map[string]string{"Idempotency-Key": "plan-1"}, folderUploadBody())
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("plan: %d %v", res.StatusCode, out)
	}
	if out["status"] != "open" || out["root_title"] != "Hồ sơ 2026" || out["share_with_workspace"] != true || out["parent_id"] != nil ||
		out["root_folder_id"] == "" || out["expires_at"] == "" || out["created_at"] == "" || out["total_bytes"] != float64(12) {
		t.Fatalf("batch = %v", out)
	}
	folders, _ := out["folders"].([]any)
	if len(folders) != 2 || folders[0].(map[string]any)["path"] != "" || folders[0].(map[string]any)["id"] != out["root_folder_id"] {
		t.Fatalf("folders = %v", out["folders"])
	}
	counts, _ := out["counts"].(map[string]any)
	if counts["total"] != float64(2) || counts["pending"] != float64(2) || counts["done"] != float64(0) || counts["failed"] != float64(0) {
		t.Fatalf("counts = %v", counts)
	}
	filesOut, _ := out["files"].([]any)
	if len(filesOut) != 2 {
		t.Fatalf("files = %v", out["files"])
	}
	for _, raw := range filesOut {
		f := raw.(map[string]any)
		target, _ := f["target"].(map[string]any)
		if f["status"] != "pending" || f["document_id"] != nil || f["error"] != nil || target == nil ||
			target["kind"] != "put" || target["method"] != "PUT" || target["url"] == "" || target["expires_at"] == "" {
			t.Fatalf("file = %v", f)
		}
		if _, ok := target["headers"].(map[string]any); !ok {
			t.Fatalf("put target without a headers map: %v", target)
		}
		if _, ok := target["auth"]; ok {
			t.Fatalf("a signed target carries auth: %v", target)
		}
	}

	// The same key and body answer the same batch; another body is a 409.
	res, again := doJSONHeaders(t, z.srv, "POST", path, z.token, map[string]string{"Idempotency-Key": "plan-1"}, folderUploadBody())
	if res.StatusCode != http.StatusCreated || again["id"] != out["id"] {
		t.Fatalf("replay: %d %v", res.StatusCode, again)
	}
	body := folderUploadBody()
	body["root_name"] = "Khác"
	res, mismatch := doJSONHeaders(t, z.srv, "POST", path, z.token, map[string]string{"Idempotency-Key": "plan-1"}, body)
	if code, _ := errCodeClass(mismatch); res.StatusCode != http.StatusConflict || code != "idempotency_payload_mismatch" {
		t.Fatalf("mismatch: %d %v", res.StatusCode, mismatch)
	}

	// A limit refusal carries its fields in ErrorSDO.fields.
	body = folderUploadBody()
	body["files"] = []map[string]any{{"file_key": "x", "path": "", "filename": "setup.exe", "size_bytes": 1}}
	res, refused := doJSONHeaders(t, z.srv, "POST", path, z.token, map[string]string{"Idempotency-Key": "plan-2"}, body)
	errObj, _ := refused["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if res.StatusCode != http.StatusUnprocessableEntity || errObj["code"] != "folder_upload_unsupported_type" || fields["filename"] != "setup.exe" || fields["path"] != "" {
		t.Fatalf("unsupported type: %d %v", res.StatusCode, refused)
	}

	// A person outside the workspace is refused before anything is written.
	res, _ = doJSONHeaders(t, z.srv, "POST", path, z.outsider, map[string]string{"Idempotency-Key": "plan-3"}, folderUploadBody())
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider: %d", res.StatusCode)
	}
}

func TestFolderUploadOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]map[string]*struct {
			Parameters []struct {
				Name string `json:"name"`
			} `json:"parameters"`
			RequestBody json.RawMessage            `json:"requestBody"`
			Responses   map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	op := spec.Paths["/api/v1/workspaces/{workspaceID}/documents/folder-uploads"]["post"]
	if op == nil {
		t.Fatal("spec lacks POST /workspaces/{workspaceID}/documents/folder-uploads")
	}
	if _, ok := op.Responses["201"]; !ok || len(op.RequestBody) == 0 {
		t.Fatalf("responses = %v, body documented = %v", op.Responses, len(op.RequestBody) > 0)
	}
	if len(op.Parameters) == 0 || op.Parameters[0].Name != "workspaceID" {
		t.Fatalf("parameters = %+v", op.Parameters)
	}
	for schema, fields := range map[string][]string{
		"SdiCreateFolderUploadSDI": {"parent_id", "root_name", "share_with_workspace", "folders", "files"},
		"SdiFolderUploadFileSDI":   {"file_key", "path", "filename", "size_bytes", "probe"},
		"SdoFolderUploadBatchSDO": {"id", "status", "parent_id", "root_folder_id", "root_title", "share_with_workspace",
			"folders", "files", "counts", "total_bytes", "expires_at", "created_at"},
		"SdoFolderUploadFileSDO":   {"file_key", "path", "filename", "size_bytes", "status", "document_id", "error", "target"},
		"SdoFolderUploadTargetSDO": {"kind", "method", "url", "headers", "auth", "session_id", "part_size", "parts", "expires_at"},
		"SdoFolderUploadCountsSDO": {"total", "done", "failed", "pending"},
	} {
		s, ok := spec.Components.Schemas[schema]
		if !ok {
			t.Errorf("spec lacks schema %s", schema)
			continue
		}
		for _, f := range fields {
			if _, ok := s.Properties[f]; !ok {
				t.Errorf("schema %s lacks field %s", schema, f)
			}
		}
	}
}

func TestConfigPublishesFolderUploadLimits(t *testing.T) {
	h := New(Deps{Cfg: config.Config{}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
	var raw struct {
		Documents struct {
			Limits struct {
				FolderUpload     map[string]float64 `json:"folder_upload"`
				UploadExtensions []string           `json:"upload_extensions"`
			} `json:"limits"`
		} `json:"documents"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	want := map[string]float64{"max_files": 500, "max_folders": 500, "max_total_bytes": 2147483648, "max_depth": 20, "complete_batch": 50, "parallel": 6}
	for k, v := range want {
		if raw.Documents.Limits.FolderUpload[k] != v {
			t.Fatalf("folder_upload.%s = %v, want %v (all %v)", k, raw.Documents.Limits.FolderUpload[k], v, raw.Documents.Limits.FolderUpload)
		}
	}
	have := map[string]bool{}
	for _, ext := range raw.Documents.Limits.UploadExtensions {
		have[ext] = true
	}
	for _, ext := range []string{"pdf", "docx", "xlsx", "pptx", "md", "png"} {
		if !have[ext] {
			t.Fatalf("upload_extensions lacks %s: %v", ext, raw.Documents.Limits.UploadExtensions)
		}
	}
	if have[".pdf"] || have["exe"] {
		t.Fatalf("upload_extensions = %v", raw.Documents.Limits.UploadExtensions)
	}
}
