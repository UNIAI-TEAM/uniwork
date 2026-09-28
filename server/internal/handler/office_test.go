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
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type handlerStubEngine struct{}

const handlerStubKey = "handler-test-grant-key-0000000001"

func (handlerStubEngine) Sign(g office.ServiceGrant) (string, error) {
	return office.SignGrant(g, []byte(handlerStubKey))
}

func (handlerStubEngine) Submit(_ context.Context, _ string, env office.Envelope) (office.JobStatus, error) {
	return office.JobStatus{
		JobID: env.RequestID, RequestID: env.RequestID, State: office.JobAccepted,
		Operation: env.Operation, Format: env.Format, EngineVersion: office.TrustedEngineVersion,
	}, nil
}

func (handlerStubEngine) Status(_ context.Context, jobID, _ string) (office.JobStatus, error) {
	return office.JobStatus{JobID: jobID, State: office.JobAccepted}, nil
}

func (handlerStubEngine) Cancel(_ context.Context, jobID, _ string) (office.JobStatus, error) {
	return office.JobStatus{JobID: jobID, State: office.JobRunning}, nil
}

func (handlerStubEngine) Ready(context.Context) (office.Readiness, error) {
	return office.Readiness{Status: "ready"}, nil
}

func (handlerStubEngine) Capability(_ context.Context, format office.Format) (office.CapabilityResult, error) {
	return office.CapabilityResult{
		EngineVersion: office.TrustedEngineVersion, Format: format,
		Capabilities: []office.CapabilityEntry{
			{Operation: string(office.OperationOpen), Supported: true, Runtime: office.RuntimeInternalService, EvidenceLevel: office.EvidenceProven},
			{Operation: string(office.OperationSerialize), Supported: true, Runtime: office.RuntimeInternalService, EvidenceLevel: office.EvidenceProven},
			{Operation: string(office.OperationConvert), Supported: false, Runtime: office.RuntimeNone, EvidenceLevel: office.EvidencePending, Reason: "Q7 blocker"},
			{Operation: string(office.OperationExport), Supported: false, Runtime: office.RuntimeNone, EvidenceLevel: office.EvidencePending},
		},
	}, nil
}

type officeWorld struct {
	srv         *httptest.Server
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
		Pool: pool, Queries: q, Files: fake, Engine: handlerStubEngine{}, Documents: docs,
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
	}

	w := &officeWorld{srv: srv}
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
	w.outsider, w.outsiderTok = filesRegister(t, srv, "office-outsider@example.com")
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

	// The capability answer names operations and the pinned engine id, and
	// never an engine address or a storage key.
	res, raw = officeRaw(t, w.srv, "GET", "/api/v1/documents/"+docID+"/office/capabilities", w.token, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("capability = %d %s", res.StatusCode, raw)
	}
	body := string(raw)
	if !strings.Contains(body, "create_blank") || !strings.Contains(body, office.TrustedEngineVersion) {
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
	// is a 400, and the Q7 blocker answers 501 without a job row.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token, map[string]string{"operation": "publish"})
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("bad operation = %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token, map[string]string{"operation": "convert"})
	if code, _ := errCodeClass(out); res.StatusCode != 501 || code != "unsupported_operation" {
		t.Fatalf("convert = %d %v", res.StatusCode, out)
	}

	// A stale base revision is refused by the service, typed.
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
		map[string]string{"operation": "serialize", "base_revision": "999"})
	if code, _ := errCodeClass(out); res.StatusCode != 409 || code != "base_version_mismatch" {
		t.Fatalf("stale base = %d %v", res.StatusCode, out)
	}

	// A bound operation starts a job with an idempotency key; the answer is
	// the job SDO (state accepted/running), never an engine address.
	res, raw := officeRaw(t, w.srv, "POST", "/api/v1/documents/"+docID+"/office/jobs", w.token,
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
	if job.JobID == "" || job.State != "accepted" || job.EngVer != office.TrustedEngineVersion || job.EngName != "genoffice" {
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
