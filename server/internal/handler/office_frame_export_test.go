package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// POST /api/v1/office-frame/documents/{documentID}/export/pdf (UNI-1013),
// end to end through the router: frame token, flags, body parsing, the
// export job against a stub engine that binds export, and the PDF bytes.

// exportStub is an HTTP engine stub that binds export:docx and completes
// every job at once by writing pdf into the FileService fake - what the real
// engine's PUT to the output target does.
type exportStub struct {
	mu     sync.Mutex
	inputs map[string]string // job id -> input checksum the grant binds
	fail   string
}

func (s *exportStub) input(jobID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inputs[jobID]
}

func (s *exportStub) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.inputs)
}

func newExportStub(t *testing.T, fake *filesfake.Fake, pdf []byte, stub *exportStub) service.OfficeEngine {
	t.Helper()
	_, version, contract, protocol := service.OfficeEngineIdentity()
	protocolNumber, _ := strconv.Atoi(protocol)
	sum := sha256.Sum256(pdf)
	jobs := map[string]map[string]any{}
	writeJSON := func(w http.ResponseWriter, status int, body any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/capability", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"engine_version": version, "contract_version": contract, "protocol_version": protocolNumber,
			"format": r.URL.Query().Get("format"),
			"capabilities": []map[string]any{
				{"operation": "open", "supported": true, "runtime": "internal_service", "evidence_level": "proven"},
				{"operation": "export", "supported": true, "runtime": "internal_service", "evidence_level": "pending"},
			},
		})
	})
	mux.HandleFunc("POST /v1/jobs", func(w http.ResponseWriter, r *http.Request) {
		body, _, _ := strings.Cut(r.Header.Get("X-Office-Grant"), ".")
		raw, _ := base64.RawURLEncoding.DecodeString(body)
		var grant struct {
			JobID     string `json:"job_id"`
			Operation string `json:"operation"`
			Input     struct {
				Checksum string `json:"checksum"`
			} `json:"input"`
			Output struct {
				FileID string `json:"file_id"`
			} `json:"output"`
		}
		_ = json.Unmarshal(raw, &grant)
		stub.mu.Lock()
		defer stub.mu.Unlock()
		stub.inputs[grant.JobID] = grant.Input.Checksum
		status := map[string]any{"job_id": grant.JobID, "operation": grant.Operation, "format": "docx", "engine_version": version}
		if stub.fail != "" {
			status["state"] = "failed"
			status["error"] = map[string]any{"code": stub.fail, "reason": "scripted"}
		} else {
			if err := fake.WriteProviderOutput(files.ProviderOutput{FileID: files.FileID(grant.Output.FileID)}, pdf, "application/pdf"); err != nil {
				t.Errorf("stub write: %v", err)
			}
			status["state"], status["output_file_id"] = "completed", grant.Output.FileID
			status["output_checksum"], status["output_length"] = hex.EncodeToString(sum[:]), len(pdf)
		}
		jobs[grant.JobID] = status
		writeJSON(w, http.StatusAccepted, status)
	})
	mux.HandleFunc("GET /v1/jobs/{jobID}", func(w http.ResponseWriter, r *http.Request) {
		stub.mu.Lock()
		defer stub.mu.Unlock()
		writeJSON(w, http.StatusOK, jobs[r.PathValue("jobID")])
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	eng, err := service.NewOfficeEngineClient(srv.URL, handlerStubToken, handlerStubKey)
	if err != nil {
		t.Fatal(err)
	}
	return eng
}

func exportFixturePDF(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "office", "g0", "fixtures", "files", "pdf", "pdf-text-editable.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// postExport sends the export request; parts are multipart file parts.
func postExport(t *testing.T, srv *httptest.Server, path, token, contentType string, body []byte) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", srv.URL+path, bytes.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, raw
}

func exportMultipart(t *testing.T, parts ...[]byte) (string, []byte) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	_ = mw.WriteField("note", "ignored")
	for _, p := range parts {
		fw, err := mw.CreateFormFile("file", "current.docx")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = fw.Write(p)
	}
	_ = mw.Close()
	return mw.FormDataContentType(), buf.Bytes()
}

func TestOfficeFrameExportPDFRoute(t *testing.T) {
	pdf := exportFixturePDF(t)
	stub := &exportStub{inputs: map[string]string{}}
	w := newOfficeWorldWith(t, true, func(fake *filesfake.Fake) service.OfficeEngine { return newExportStub(t, fake, pdf, stub) })
	stored := frameDocx(t, "stored")
	documentID := w.createDocx(t, "report.docx", stored)
	path := "/api/v1/office-frame/documents/" + documentID + "/export/pdf"

	// A token that does not verify is refused before anything else.
	if res, raw := postExport(t, w.srv, path, "oft1.e30.AAAA", "", nil); res.StatusCode != 401 {
		t.Fatalf("bad token = %d %s", res.StatusCode, raw)
	}
	enableOfficeDocsWeb(t, w.q)
	token := w.mintFrameToken(t, documentID)["token"].(string)

	// No body: the current version renders.
	res, raw := postExport(t, w.srv, path, token, "", nil)
	if res.StatusCode != 200 || !bytes.Equal(raw, pdf) || res.Header.Get("Content-Type") != "application/pdf" ||
		res.Header.Get("Cache-Control") != "private, no-store" || res.Header.Get("X-Office-Job-Id") == "" {
		t.Fatalf("export current = %d %v (%d bytes)", res.StatusCode, res.Header, len(raw))
	}
	storedSum := sha256.Sum256(stored)
	if got := stub.input(res.Header.Get("X-Office-Job-Id")); got != hex.EncodeToString(storedSum[:]) {
		t.Fatalf("current-version export rendered %s", got)
	}

	// A multipart file part: the frame's unsaved bytes render instead.
	edited := frameDocx(t, "unsaved")
	ct, body := exportMultipart(t, edited)
	res, raw = postExport(t, w.srv, path, token, ct, body)
	editedSum := sha256.Sum256(edited)
	if res.StatusCode != 200 || !bytes.Equal(raw, pdf) || stub.input(res.Header.Get("X-Office-Job-Id")) != hex.EncodeToString(editedSum[:]) {
		t.Fatalf("export edited = %d (%d bytes)", res.StatusCode, len(raw))
	}

	// A stored version: save version 2 through the frame, then export 1.
	res, raw = doMultipart(t, w.srv, "POST", "/api/v1/office-frame/documents/"+documentID+"/uploads", token, nil, "report.docx", edited, nil)
	if res.StatusCode != 201 {
		t.Fatalf("upload v2 = %d %s", res.StatusCode, raw)
	}
	var up struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &up)
	_, opened := doJSON(t, w.srv, "GET", "/api/v1/office-frame/documents/"+documentID, token, nil)
	if res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/office-frame/documents/"+documentID+"/versions/commit", token,
		map[string]string{"Idempotency-Key": "export-v2"}, map[string]any{"upload_id": up.UploadID, "base_revision": opened["revision"]}); res.StatusCode != 200 {
		t.Fatalf("commit v2 = %d %v", res.StatusCode, out)
	}
	var vb bytes.Buffer
	vw := multipart.NewWriter(&vb)
	_ = vw.WriteField("version", "1")
	_ = vw.Close()
	res, raw = postExport(t, w.srv, path, token, vw.FormDataContentType(), vb.Bytes())
	if res.StatusCode != 200 || !bytes.Equal(raw, pdf) || stub.input(res.Header.Get("X-Office-Job-Id")) != hex.EncodeToString(storedSum[:]) {
		t.Fatalf("export v1 = %d (%d bytes)", res.StatusCode, len(raw))
	}

	// Bodies the route refuses before any job.
	jobsBefore := stub.count()
	ct2, two := exportMultipart(t, edited, edited)
	ctEmpty, empty := exportMultipart(t, []byte{})
	ctPDF, notDocx := exportMultipart(t, pdf)
	field := func(k, v string, withFile bool) (string, []byte) {
		var b bytes.Buffer
		m := multipart.NewWriter(&b)
		_ = m.WriteField(k, v)
		if withFile {
			fw, _ := m.CreateFormFile("file", "x.docx")
			_, _ = fw.Write(edited)
		}
		_ = m.Close()
		return m.FormDataContentType(), b.Bytes()
	}
	ctBadVersion, badVersion := field("version", "zero", false)
	ctBoth, both := field("version", "1", true)
	for name, c := range map[string]struct {
		ct     string
		body   []byte
		status int
	}{
		"json body":           {"application/json", []byte(`{}`), 400},
		"two file parts":      {ct2, two, 400},
		"empty file part":     {ctEmpty, empty, 400},
		"not a docx":          {ctPDF, notDocx, 400},
		"bad version":         {ctBadVersion, badVersion, 400},
		"file and version":    {ctBoth, both, 400},
		"truncated file part": {"multipart/form-data; boundary=x", []byte("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.docx\"\r\n\r\nPK\x03\x04"), 400},
	} {
		if res, raw := postExport(t, w.srv, path, token, c.ct, c.body); res.StatusCode != c.status {
			t.Fatalf("%s = %d (%d bytes)", name, res.StatusCode, len(raw))
		}
	}
	if stub.count() != jobsBefore {
		t.Fatalf("a refused body reached the engine")
	}

	// The token opens only its own document; the session token is not one.
	other := w.createDocx(t, "other.docx", frameDocx(t, "other"))
	if res, raw := postExport(t, w.srv, "/api/v1/office-frame/documents/"+other+"/export/pdf", token, "", nil); res.StatusCode != 404 {
		t.Fatalf("other document = %d %s", res.StatusCode, raw)
	}
	if res, raw := postExport(t, w.srv, path, w.token, "", nil); res.StatusCode != 401 {
		t.Fatalf("session token = %d %s", res.StatusCode, raw)
	}

	// An engine refusal keeps its contract code.
	stub.mu.Lock()
	stub.fail = "engine_incompatible"
	stub.mu.Unlock()
	res, raw = postExport(t, w.srv, path, token, "", nil)
	var failed map[string]any
	_ = json.Unmarshal(raw, &failed)
	if code, _ := errCodeClass(failed); res.StatusCode < 400 || code != "engine_incompatible" {
		t.Fatalf("engine refusal = %d %s", res.StatusCode, raw)
	}
}

func TestOfficeFrameExportWithoutExportEngine(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	documentID := w.createDocx(t, "plain.docx", frameDocx(t, "plain"))
	token := w.mintFrameToken(t, documentID)["token"].(string)
	res, raw := postExport(t, w.srv, "/api/v1/office-frame/documents/"+documentID+"/export/pdf", token, "", nil)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
		t.Fatalf("engine without export = %d %s", res.StatusCode, raw)
	}
}
