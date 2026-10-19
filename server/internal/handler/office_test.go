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
	"github.com/jackc/pgx/v5/pgxpool"

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
	return newOfficeWorldWith(t, enableFlag, func(*filesfake.Fake) service.OfficeEngine { return newHandlerStubEngine(t) })
}

// newOfficeWorldWith is newOfficeWorld with the engine built over the
// world's FileService fake, for a stub that writes job outputs into it.
func newOfficeWorldWith(t *testing.T, enableFlag bool, engine func(*filesfake.Fake) service.OfficeEngine) *officeWorld {
	t.Helper()
	return newOfficeWorldTweaked(t, enableFlag, engine, nil)
}

// newOfficeWorldTweaked is newOfficeWorldWith with a hook that may replace
// services in the deps before the server starts (nil = none).
func newOfficeWorldTweaked(t *testing.T, enableFlag bool, engine func(*filesfake.Fake) service.OfficeEngine, tweak func(*Deps, *pgxpool.Pool)) *officeWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	fake := filesfake.New(filesfake.Options{})
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(fake)
	if d.FeatureFlags != nil {
		docs.SetFlags(d.FeatureFlags)
	}
	d.Documents = docs
	d.Office = service.NewDocumentOfficeService(service.DocumentOfficeOptions{
		Pool: pool, Queries: q, Files: fake, Engine: engine(fake), Documents: docs,
		MaxDeadline: time.Minute,
	})
	if tweak != nil {
		tweak(&d, pool)
	}
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
	blankPath := "/api/v1/workspaces/" + w.wsID + "/documents/files/blank"
	rootDocs := func() int {
		rows, err := w.q.ListDocumentsByParent(context.Background(), db.ListDocumentsByParentParams{OrganizationID: w.orgID, WorkspaceID: w.wsID})
		if err != nil {
			t.Fatal(err)
		}
		return len(rows)
	}
	before := rootDocs()
	for _, format := range []string{"xls", "odt"} {
		res, out := doJSON(t, w.srv, "POST", blankPath, w.token, map[string]string{"format": format, "title": "Trong"})
		if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
			t.Fatalf("%s blank = %d %v", format, res.StatusCode, out)
		}
	}
	after := rootDocs()
	if after != before {
		t.Fatalf("refused blanks stored %d documents", after-before)
	}
	// The Office packages are created from the server seed, with the mime type
	// and extension of their format.
	for _, row := range []struct{ format, ext, mime string }{
		{"docx", ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"pptx", ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
	} {
		title := "Chưa đặt tên" + row.ext
		key := util.NewID()
		res, out := doJSONHeaders(t, w.srv, "POST", blankPath, w.token, map[string]string{"Idempotency-Key": key},
			map[string]string{"format": row.format, "title": title})
		doc, _ := out["document"].(map[string]any)
		file, _ := doc["file"].(map[string]any)
		if res.StatusCode != 201 || doc == nil || doc["title"] != title || doc["kind"] != "file" ||
			file == nil || file["mime_type"] != row.mime || !strings.HasSuffix(file["filename"].(string), row.ext) {
			t.Fatalf("%s blank = %d %v", row.format, res.StatusCode, out)
		}
		// The same key answers the same document.
		res, again := doJSONHeaders(t, w.srv, "POST", blankPath, w.token, map[string]string{"Idempotency-Key": key},
			map[string]string{"format": row.format, "title": title})
		if again, _ := again["document"].(map[string]any); res.StatusCode != 201 || again["id"] != doc["id"] {
			t.Fatalf("%s blank replay = %d %v", row.format, res.StatusCode, again)
		}
	}
	res, out := doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+w.wsID+"/documents/files/blank", w.token,
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

// UNI-1872: POST /api/v1/documents/{id}/copies accepts an upload_id staged by
// the same caller on the same document (for example through the office-frame
// upload route when a save conflicts or is locked) and writes that upload as
// the copy's first version while leaving the source document untouched.
func TestOfficeCopyFromUpload(t *testing.T) {
	w := newOfficeWorld(t, true)
	enableOfficeDocsWeb(t, w.q)
	headBytes := frameDocx(t, "head")
	editedBytes := frameDocx(t, "edited")
	docID := w.createDocx(t, "plan.docx", headBytes)
	otherID := w.createDocx(t, "other.docx", headBytes)

	frameTok := w.mintFrameToken(t, docID)["token"].(string)
	frameBase := "/api/v1/office-frame/documents/" + docID
	res, raw := doMultipart(t, w.srv, "POST", frameBase+"/uploads", frameTok, nil, "plan.docx", editedBytes, nil)
	if res.StatusCode != 201 {
		t.Fatalf("frame upload = %d %s", res.StatusCode, raw)
	}
	var staged struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &staged)

	// upload_id together with job_id is 400 invalid_request.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"consent": "copy", "upload_id": staged.UploadID, "job_id": util.NewID()})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("copy with upload_id and job_id = %d %v", res.StatusCode, out)
	}

	// Another document's upload_id fails closed as 404 not_found.
	otherTok := w.mintFrameToken(t, otherID)["token"].(string)
	res, raw = doMultipart(t, w.srv, "POST", "/api/v1/office-frame/documents/"+otherID+"/uploads", otherTok, nil, "other.docx", editedBytes, nil)
	if res.StatusCode != 201 {
		t.Fatalf("other frame upload = %d %s", res.StatusCode, raw)
	}
	var otherStaged struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &otherStaged)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"consent": "copy", "upload_id": otherStaged.UploadID})
	if code, _ := errCodeClass(out); res.StatusCode != 404 || code != "not_found" {
		t.Fatalf("copy with another document's upload_id = %d %v", res.StatusCode, out)
	}

	// Copy from the staged upload creates the new document with the staged bytes.
	idemKey := "copy-upload-key-1"
	res, out = doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"Idempotency-Key": idemKey},
		map[string]string{"consent": "copy", "upload_id": staged.UploadID})
	if res.StatusCode != 201 {
		t.Fatalf("copy with upload_id = %d %v", res.StatusCode, out)
	}
	copied, _ := out["document"].(map[string]any)
	copyID, _ := copied["id"].(string)
	if copyID == "" || copyID == docID || copied["title"] != "plan.docx (bản sao)" {
		t.Fatalf("copied document = %v", out)
	}
	if res, got := doBytes(t, w.srv, "GET", "/api/v1/documents/"+copyID+"/download", w.token); res.StatusCode != 200 || !bytes.Equal(got, editedBytes) {
		t.Fatalf("copied download = %d (%d bytes), want edited (%d bytes)", res.StatusCode, len(got), len(editedBytes))
	}
	if res, got := doBytes(t, w.srv, "GET", "/api/v1/documents/"+docID+"/download", w.token); res.StatusCode != 200 || !bytes.Equal(got, headBytes) {
		t.Fatalf("source download = %d (%d bytes), want head (%d bytes)", res.StatusCode, len(got), len(headBytes))
	}

	// Idempotent replay with the same key and same upload_id returns the first result;
	// replay with another upload_id is 409 idempotency_payload_mismatch; a fresh key
	// naming the already-claimed upload is 409 upload_already_committed.
	res, replay := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"Idempotency-Key": idemKey},
		map[string]string{"consent": "copy", "upload_id": staged.UploadID})
	if replayDoc, _ := replay["document"].(map[string]any); res.StatusCode != 201 || replayDoc["id"] != copyID {
		t.Fatalf("idempotent replay = %d %v", res.StatusCode, replay)
	}
	res, mismatch := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"Idempotency-Key": idemKey},
		map[string]string{"consent": "copy", "upload_id": util.NewID()})
	if code, _ := errCodeClass(mismatch); res.StatusCode != 409 || code != "idempotency_payload_mismatch" {
		t.Fatalf("idempotent mismatch = %d %v", res.StatusCode, mismatch)
	}
	res, reused := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"Idempotency-Key": "copy-upload-key-2"},
		map[string]string{"consent": "copy", "upload_id": staged.UploadID})
	if code, _ := errCodeClass(reused); res.StatusCode != 409 || code != "upload_already_committed" {
		t.Fatalf("reuse claimed upload = %d %v", res.StatusCode, reused)
	}

	// D4 edit-lock check: when another editor holds the edit lock on the source
	// document, the frame upload route still stages bytes (201), versions/commit
	// is refused 423 document_locked, and POST /copies with that upload_id
	// succeeds (201) without touching the locked source document.
	peerTok, peerID := filesRegister(t, w.srv, "office-peer-lock@example.com")
	if err := w.q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: w.orgID, UserID: peerID, Role: "member",
	}); err != nil {
		t.Fatalf("add org member: %v", err)
	}
	if err := w.q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
		WorkspaceID: w.wsID, OrganizationID: w.orgID, UserID: peerID, Role: "member",
	}); err != nil {
		t.Fatalf("add workspace member: %v", err)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/shares", w.token,
		map[string]string{"principal_type": "user", "principal_id": peerID, "level": "edit"}); res.StatusCode != 201 {
		t.Fatalf("share edit to peer = %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/edit-lock", peerTok,
		map[string]string{"editor_id": "01J8X4ED1T0R00000000000001", "client": "web_page"}); res.StatusCode != 201 {
		t.Fatalf("peer acquire edit lock = %d %v", res.StatusCode, out)
	}
	lockedBytes := frameDocx(t, "while-locked")
	res, raw = doMultipart(t, w.srv, "POST", frameBase+"/uploads", frameTok, nil, "plan.docx", lockedBytes, nil)
	if res.StatusCode != 201 {
		t.Fatalf("frame upload while peer holds edit lock = %d %s", res.StatusCode, raw)
	}
	var lockedStaged struct {
		UploadID string `json:"upload_id"`
	}
	_ = json.Unmarshal(raw, &lockedStaged)
	res, lockedCommit := doJSONHeaders(t, w.srv, "POST", frameBase+"/versions/commit", frameTok,
		map[string]string{"Idempotency-Key": "frame-locked-commit"},
		map[string]string{"upload_id": lockedStaged.UploadID, "base_revision": "2"})
	if code, _ := errCodeClass(lockedCommit); res.StatusCode != 423 || code != "document_locked" {
		t.Fatalf("commit while peer holds lock = %d %v", res.StatusCode, lockedCommit)
	}
	res, lockedCopy := doJSONHeaders(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.token,
		map[string]string{"Idempotency-Key": "copy-while-locked"},
		map[string]string{"consent": "copy", "upload_id": lockedStaged.UploadID})
	if res.StatusCode != 201 {
		t.Fatalf("copy with upload_id while peer holds lock = %d %v", res.StatusCode, lockedCopy)
	}
}

// BE-12-201: a share editor with no seat in the source's workspace is told
// so by code on the wire, in the permission class, not by the plain forbidden.
func TestOfficeCopyWithoutWorkspaceSeatAnswersItsOwnCode(t *testing.T) {
	w := newOfficeWorld(t, true)
	docID := w.createMarkdownFile(t, "# Nguon\n")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/shares", w.token,
		map[string]string{"principal_type": "user", "principal_id": w.outsider, "level": "edit"})
	if res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("share = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/copies", w.outsiderToken(t), map[string]string{"consent": "copy"})
	if code, class := errCodeClass(out); res.StatusCode != 403 || code != "workspace_seat_required" || class != "permission" {
		t.Fatalf("share editor copy = %d %v", res.StatusCode, out)
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
