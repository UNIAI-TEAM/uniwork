package handler

// Handler tests for the Office HTTP surface (G2-07a / UNI-690): the flag
// gate, document authority, the operation allowlist, and the answer shape.
// The engine is a stub: this layer owns the wire contract, not the engine
// lifecycle (that is TestDocumentOfficeJob and TestDocumentOfficeIntegration).

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	handlerStubToken = "handler-test-service-token-000001"
	handlerStubKey   = "handler-test-grant-key-000000001"
)

// newHandlerStubEngine stands an engine-shaped HTTP stub up and returns the
// service's client for it. The handler tier (and this test) never imports
// internal/office (ADR 0021 leaf guard): the engine seam is reached through
// service, and the stub speaks the pinned contract's JSON.
func newHandlerStubEngine(t *testing.T) service.OfficeEngine {
	t.Helper()
	_, version, contract, protocol := service.OfficeEngineIdentity()
	protocolNumber, err := strconv.Atoi(protocol)
	if err != nil {
		t.Fatalf("stub engine protocol: %v", err)
	}
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, status int, body any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(body); err != nil {
			t.Errorf("stub engine encode: %v", err)
		}
	}
	mux.HandleFunc("GET /v1/capability", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"engine_version": version, "contract_version": contract, "protocol_version": protocolNumber,
			"format": r.URL.Query().Get("format"),
			"capabilities": []map[string]any{
				{"operation": "open", "supported": true, "runtime": "internal_service", "evidence_level": "proven"},
				{"operation": "edit", "supported": true, "runtime": "internal_service", "evidence_level": "proven"},
				{"operation": "serialize", "supported": true, "runtime": "internal_service", "evidence_level": "proven"},
				{"operation": "convert", "supported": false, "runtime": "none", "evidence_level": "pending", "reason": "Q7 blocker"},
			},
		})
	})
	mux.HandleFunc("POST /v1/jobs", func(w http.ResponseWriter, r *http.Request) {
		var env struct {
			RequestID string `json:"request_id"`
			Operation string `json:"operation"`
			Format    string `json:"format"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &env)
		writeJSON(w, http.StatusAccepted, map[string]any{
			"job_id": env.RequestID, "state": "accepted",
			"operation": env.Operation, "format": env.Format, "engine_version": version,
		})
	})
	mux.HandleFunc("GET /v1/jobs/{jobID}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"job_id": r.PathValue("jobID"), "state": "accepted"})
	})
	mux.HandleFunc("POST /v1/jobs/{jobID}/cancel", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"job_id": r.PathValue("jobID"), "state": "running"})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	eng, err := service.NewOfficeEngineClient(srv.URL, handlerStubToken, handlerStubKey)
	if err != nil {
		t.Fatalf("stub engine client: %v", err)
	}
	return eng
}

type officeWorld struct {
	srv         *httptest.Server
	q           *db.Queries
	token       string
	userID      string
	orgID       string
	wsID        string
	outsider    string
	outsiderTok string
}

func newOfficeWorld(t *testing.T, enableFlag bool) *officeWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	fake := filesfake.New(filesfake.Options{})
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(fake)
	d.Documents = docs
	d.Office = service.NewDocumentOfficeService(service.DocumentOfficeOptions{
		Pool: pool, Queries: q, Files: fake, Engine: newHandlerStubEngine(t), Documents: docs,
		MaxDeadline: time.Minute,
	})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	if enableFlag {
		if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
			ID: util.NewID(), FlagKey: "documents", ScopeType: featureflags.ScopeGlobal,
			ScopeID: "", Enabled: true, Note: "office handler tests", CreatedBy: "test",
		}); err != nil {
			t.Fatalf("enable documents flag: %v", err)
		}
		if testFlagOverrides != nil {
			testFlagOverrides.Invalidate()
		}
	} else {
		// documents is on by default; a flag-off world turns it off explicitly.
		disableDocumentsFlag(t)
	}

	w := &officeWorld{srv: srv, q: q}
	w.token, w.userID = filesRegister(t, srv, "office-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Office Org", "slug": "office-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Office WS", "slug": "office-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.outsiderTok, w.outsider = filesRegister(t, srv, "office-outsider@example.com")
	if err := q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: w.outsider, Role: "member",
	}); err != nil {
		t.Fatalf("add outsider: %v", err)
	}
	return w
}

// createMarkdownFile makes one .md file document through the public route.
func (w *officeWorld) createMarkdownFile(t *testing.T, body string) string {
	t.Helper()
	res, raw := doMultipart(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files", w.token,
		map[string]string{"title": "Ghi chu"}, "note.md", []byte(body), nil)
	if res.StatusCode != 201 {
		t.Fatalf("create file document: %d %s", res.StatusCode, raw)
	}
	var out struct {
		Document struct {
			ID       string `json:"id"`
			Revision string `json:"revision"`
		} `json:"document"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Document.ID
}

func TestOfficeRoutesNeedTheDocumentsFlag(t *testing.T) {
	w := newOfficeWorld(t, false)
	res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/01J8X4DOC0N1P2Q3R4S5T6U7/office/capabilities", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("flag off capability = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files/blank", w.token,
		map[string]string{"format": "md", "title": "Trong"})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "feature_disabled" {
		t.Fatalf("flag off blank = %d %v", res.StatusCode, out)
	}
}

func TestOfficeRoutesAuthority(t *testing.T) {
	w := newOfficeWorld(t, true)
	docID := w.createMarkdownFile(t, "# Ghi chu\n")

	// No token: unauthorized, no existence probe.
	res, raw := officeRaw(t, w.srv, "GET", "/api/v1/documents/"+docID+"/office/capabilities", "", nil, nil)
	if res.StatusCode != 401 {
		t.Fatalf("anonymous capability = %d %s", res.StatusCode, raw)
	}
	// Unknown id and a non-member answer the same 404: no existence leak.
	for _, id := range []string{"01J8X4DOC0N1P2Q3R4S5T6U8", docID} {
		token := w.token
		if id == docID {
			token = w.outsiderToken(t)
		}
		res, out := doJSON(t, w.srv, "GET", "/api/v1/documents/"+id+"/office/capabilities", token, nil)
		if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
			t.Fatalf("capability %s = %d %v", id, res.StatusCode, out)
		}
	}
	// Edit uses the same service ACL gate; a non-member cannot probe whether
	// this document is editable (or even whether it exists).
	res, out := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.outsiderToken(t),
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]any{"operation": "edit", "edits": []map[string]any{{"op": "set_cell"}}})
	if code, _ := errCodeClass(out); res.StatusCode != 404 && res.StatusCode != 403 {
		t.Fatalf("outsider edit = %d %v", res.StatusCode, out)
	} else if code != "not_found" && code != "forbidden" {
		t.Fatalf("outsider edit code = %s", code)
	}

	// The capability answer names operations and the pinned engine id, and
	// never an engine address or a storage key.
	res, raw = officeRaw(t, w.srv, "GET", "/api/v1/documents/"+docID+"/office/capabilities", w.token, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("capability = %d %s", res.StatusCode, raw)
	}
	body := string(raw)
	_, engineVersion, _, _ := service.OfficeEngineIdentity()
	if !strings.Contains(body, "create_blank") || !strings.Contains(body, engineVersion) {
		t.Fatalf("capability body = %s", body)
	}
	if strings.Contains(body, "http://") || strings.Contains(body, "grant") {
		t.Fatalf("capability leaks engine detail: %s", body)
	}
}

func TestOfficeJobRoutes(t *testing.T) {
	w := newOfficeWorld(t, true)
	docID := w.createMarkdownFile(t, "# Ghi chu\n")

	// The SDI allowlist is enforced before the service: an unknown operation
	// is a 400, and a convert the engine does not bind for the document's
	// format (markdown has no Q7 converter) answers 501 without a job row.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token, map[string]string{"operation": "publish"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad operation = %d %v", res.StatusCode, out)
	}
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]string{"operation": "convert", "target_format": "docx"})
	if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
		t.Fatalf("convert = %d %v", res.StatusCode, out)
	}

	// A stale base revision is refused by the service, typed.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		map[string]string{"operation": "serialize", "base_revision": "999"})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "base_version_mismatch" {
		t.Fatalf("stale base = %d %v", res.StatusCode, out)
	}

	// Edit accepts the format-specific operation list and keeps it inside the
	// service-owned job path; the handler never writes a document directly.
	res, raw := officeRaw(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		[]byte(`{"operation":"edit","edits":[{"op":"set_cell","target":{"sheet":"Data","cell":"A1"},"attributes":{"value":7}}]}`),
		map[string]string{"Idempotency-Key": util.NewID(), "Content-Type": "application/json"})
	if res.StatusCode != 201 {
		t.Fatalf("edit job = %d %s", res.StatusCode, raw)
	}
	var editJob struct {
		JobID     string `json:"job_id"`
		Operation string `json:"operation"`
	}
	if err := json.Unmarshal(raw, &editJob); err != nil || editJob.JobID == "" || editJob.Operation != "edit" {
		t.Fatalf("edit job body = %s", raw)
	}
	if res, _ = officeRaw(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs/"+editJob.JobID+"/cancel", w.token, nil, nil); res.StatusCode != 200 {
		t.Fatalf("cancel edit job = %d", res.StatusCode)
	}
	// Edits are rejected on every other operation before the service starts a
	// job, preventing an accidental payload from changing its fingerprint.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]any{"operation": "serialize", "edits": []map[string]any{{"op": "set_cell"}}})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("serialize edits = %d %v", res.StatusCode, out)
	}

	// A bound operation starts a job with an idempotency key; the answer is
	// the job SDO (state accepted/running), never an engine address.
	res, raw = officeRaw(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		[]byte(`{"operation":"serialize"}`), map[string]string{"Idempotency-Key": util.NewID(), "Content-Type": "application/json"})
	if res.StatusCode != 201 {
		t.Fatalf("start job = %d %s", res.StatusCode, raw)
	}
	var job struct {
		JobID   string `json:"job_id"`
		State   string `json:"state"`
		Output  string `json:"output_file_id"`
		EngName string `json:"engine_name"`
		EngVer  string `json:"engine_version"`
	}
	if err := json.Unmarshal(raw, &job); err != nil {
		t.Fatal(err)
	}
	_, engineVersion, _, _ := service.OfficeEngineIdentity()
	// The submit answer maps the engine's accepted/running onto the row's live
	// state: once the engine holds the dispatched job the row is running.
	if job.JobID == "" || (job.State != "running" && job.State != "accepted") || job.EngVer != engineVersion || job.EngName != "genoffice" {
		t.Fatalf("job = %+v", job)
	}
	if strings.Contains(string(raw), "http://") || strings.Contains(string(raw), "grant") {
		t.Fatalf("job answer leaks engine detail: %s", raw)
	}

	// Status reads the job; a job id under another document is a 404.
	res, raw = officeRaw(t, w.srv, "GET", "/api/v1/documents/"+docID+"/office/jobs/"+job.JobID, w.token, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("job status = %d %s", res.StatusCode, raw)
	}
	other := w.createMarkdownFile(t, "# Khac\n")
	res, out = doJSON(t, w.srv, "GET", "/api/v1/documents/"+other+"/office/jobs/"+job.JobID, w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("cross-document status = %d %v", res.StatusCode, out)
	}

	// Cancel is a POST with no body and answers the settled row.
	res, raw = officeRaw(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs/"+job.JobID+"/cancel", w.token, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("cancel = %d %s", res.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, &job); err != nil {
		t.Fatal(err)
	}
	if job.State != "cancelled" {
		t.Fatalf("cancelled job = %+v", job)
	}
}

func TestOfficeBlankAndCopyRoutes(t *testing.T) {
	w := newOfficeWorld(t, true)

	// A format with no blank generator never reaches storage.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files/blank", w.token,
		map[string]string{"format": "pdf", "title": "Trong"})
	if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
		t.Fatalf("pdf blank = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files/blank", w.token,
		map[string]string{"format": "nope", "title": "Trong"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad format blank = %d %v", res.StatusCode, out)
	}

	docID := w.createMarkdownFile(t, "# Nguon\n")
	// Copy needs the explicit consent value.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token, map[string]string{})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "copy_consent_required" {
		t.Fatalf("copy without consent = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token, map[string]string{"consent": "copy"})
	if res.StatusCode != 201 {
		t.Fatalf("copy = %d %v", res.StatusCode, out)
	}
	copied, _ := out["document"].(map[string]any)
	if copied == nil || copied["id"] == docID {
		t.Fatalf("copy document = %v", out)
	}
	// A non-member cannot copy, and learns nothing about the document.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.outsiderToken(t), map[string]string{"consent": "copy"})
	if code, _ := errCodeClass(out); res.StatusCode != 404 && res.StatusCode != 403 {
		t.Fatalf("outsider copy = %d %v", res.StatusCode, out)
	} else if code != "not_found" && code != "forbidden" {
		t.Fatalf("outsider copy code = %s", code)
	}
	// Accepting a conversion needs a convert job of this document: an
	// unknown job id is not found and creates nothing (G2-07b).
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"consent": "copy", "job_id": util.NewID()})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("copy with an unknown job = %d %v", res.StatusCode, out)
	}
	// A target format on a non-convert job is a caller error.
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		map[string]string{"Idempotency-Key": util.NewID()}, map[string]string{"operation": "serialize", "target_format": "docx"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "office_job_invalid" {
		t.Fatalf("serialize with a target = %d %v", res.StatusCode, out)
	}
}

// The job SDO carries a convert job's target and change list, decoded from
// the stored engine result; anything that does not decode is left out.
func TestOfficeJobResultDTO(t *testing.T) {
	raw := []byte(`{"operation":"convert","source_format":"xls","target_format":"xlsx",` +
		`"fidelity":{"level":"limited","lost":["cell_formatting"]},"content":{"sheets":["Sheet1"],"cells":{"Sheet1!A1":"replaceMe"}}}`)
	target := "xlsx"
	out := officeJobDTO(db.OfficeJob{ID: "j", Operation: "convert", Format: "xls",
		TargetFormat: pgtype.Text{String: target, Valid: true}, Result: raw})
	if out.TargetFormat == nil || *out.TargetFormat != "xlsx" || out.Result == nil ||
		out.Result.Fidelity.Level != "limited" || out.Result.Content.Cells["Sheet1!A1"] != "replaceMe" {
		t.Fatalf("convert job SDO = %+v result %+v", out, out.Result)
	}
	for _, bad := range [][]byte{nil, []byte(`[]`), []byte(`{"target_format":""}`), []byte(`{not json`)} {
		if got := officeJobDTO(db.OfficeJob{ID: "j", Result: bad}); got.Result != nil {
			t.Fatalf("result %q decoded to %+v", bad, got.Result)
		}
	}
}

// outsiderToken is the org member who is in no workspace.
func (w *officeWorld) outsiderToken(t *testing.T) string {
	t.Helper()
	if w.outsiderTok == "" {
		t.Fatal("outsider token missing")
	}
	return w.outsiderTok
}

// officeRaw sends an optional raw body plus headers and returns the bytes.
func officeRaw(t *testing.T, srv *httptest.Server, method, path, token string, body []byte, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, srv.URL+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	return res, raw
}
