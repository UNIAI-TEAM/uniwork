package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeIntegration is the G2-07a real-store integration: the real
// engine container (fault operations on) with the real FileService, the real
// document ACL and the one G1-03 commit path - not the filesfake bridge the
// lifecycle suite uses.
//
// Environment (same names the G2-02 suite uses):
//   OFFICE_ENGINE_TEST_URL, OFFICE_ENGINE_TEST_SERVICE_TOKEN,
//   OFFICE_ENGINE_TEST_GRANT_KEY, OFFICE_ENGINE_TEST_CONTAINER
//   MINIO_* for the rows below (the container PUTs to the presigned URL).
//
// The presigned URL is minted for the host the ENGINE reaches: the rows
// require MINIO_PUBLIC_ENDPOINT when the engine container cannot resolve
// MINIO_ENDPOINT (Docker Desktop: MINIO_ENDPOINT=http://127.0.0.1:9000,
// MINIO_PUBLIC_ENDPOINT=http://host.docker.internal:9000 and the container
// started with --add-host host.docker.internal:host-gateway, its output
// origin allowlist carrying both the public MinIO origin and the test's write
// target origin).
//
// The five formats are driven by what the engine build binds: md/html/pdf run
// real engine jobs; docx/pptx have no server-side handler in this build, so
// their row proves the honest refusal plus the store/commit round-trip.

var officeFixtureRoot = filepath.Join("..", "..", "..", "docs", "office", "g0", "fixtures", "files")

type officeRealEnv struct {
	name string
	env  *docStorageEnv
	eng  *office.Client
	jobs *DocumentOfficeService
	svc  *DocumentService
	fs   files.Service
	tn   docTenant
}

func newOfficeRealEnv(t *testing.T, backend fileBackend) *officeRealEnv {
	t.Helper()
	base := newRealDocStorageEnv(t, backend)
	return &officeRealEnv{
		name: backend.name, env: base, eng: realEngine(t), svc: base.svc, fs: base.fs, tn: base.tn,
		jobs: NewDocumentOfficeService(DocumentOfficeOptions{
			Pool: base.f.pool, Queries: base.f.q, Files: base.fs, Engine: realEngine(t), Documents: base.svc,
			MaxDeadline: 2 * time.Minute, ReconcileInterval: 100 * time.Millisecond,
		}),
	}
}

// officeMinioBackend is the MinIO backend of the office rows with the optional
// MINIO_PUBLIC_ENDPOINT: the presigned write target must name the host the
// engine container reaches, while this process keeps reading and writing
// through MINIO_ENDPOINT. The storage layer signs with the public endpoint
// exactly as it does in production (storage.MinIOConfig.PublicEndpoint).
func officeMinioBackend() (fileBackend, bool) {
	for _, key := range []string{"MINIO_ENDPOINT", "MINIO_BUCKET", "MINIO_ACCESS_KEY_ID", "MINIO_SECRET_ACCESS_KEY", "MINIO_REGION"} {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			return fileBackend{}, false
		}
	}
	cfg := storage.Config{Backend: storage.BackendMinIO, MinIO: &storage.MinIOConfig{
		Endpoint: os.Getenv("MINIO_ENDPOINT"), Bucket: os.Getenv("MINIO_BUCKET"), Region: os.Getenv("MINIO_REGION"),
		AccessKeyID: os.Getenv("MINIO_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("MINIO_SECRET_ACCESS_KEY"),
		PublicEndpoint: strings.TrimSpace(os.Getenv("MINIO_PUBLIC_ENDPOINT")),
	}}
	return fileBackend{
		name:   "minio",
		bucket: cfg.MinIO.Bucket,
		build:  func(t *testing.T) storage.ObjectStore { return buildStore(t, cfg, storage.BackendMinIO) },
	}, true
}

// doc creates one file document from explicit bytes.
func (e *officeRealEnv) doc(t *testing.T, filename string, body []byte) DocumentFileResult {
	t.Helper()
	created, err := e.svc.CreateFileDocument(context.Background(), human(e.tn.member), e.tn.wsA, CreateFileDocumentInput{
		Title: "G2-07a " + filename, Filename: filename, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("create %s: %v", filename, err)
	}
	return created
}

// fixtureDoc creates one file document from a repository fixture.
func (e *officeRealEnv) fixtureDoc(t *testing.T, relative, filename string) DocumentFileResult {
	t.Helper()
	return e.doc(t, filename, mustReadFixture(t, relative))
}

func (e *officeRealEnv) settle(t *testing.T, jobID string) db.OfficeJob {
	t.Helper()
	ctx := context.Background()
	member := human(e.tn.member)
	end := time.Now().Add(90 * time.Second)
	for {
		row, err := e.jobs.GetOfficeJob(ctx, member, e.tn.orgID, e.tn.wsA, jobID)
		if err != nil {
			t.Fatalf("get job: %v", err)
		}
		if !isLiveOfficeState(row.State) {
			return row
		}
		if time.Now().After(end) {
			t.Fatalf("job %s did not settle: %+v", jobID, row)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (e *officeRealEnv) versionCount(t *testing.T, documentID string) int {
	t.Helper()
	return len(e.env.versions(t, e.env.doc(t, documentID)))
}

// runSerialize drives one real serialize job and commits its output through
// the one commit path, proving the bytes survive the round trip.
func (e *officeRealEnv) runSerialize(t *testing.T, created DocumentFileResult, format office.Format, want []byte) db.OfficeJob {
	t.Helper()
	ctx := context.Background()
	member := human(e.tn.member)
	row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
		Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
	})
	if err != nil {
		t.Fatalf("%s serialize: %v", format, err)
	}
	done := e.settle(t, row.ID)
	if done.State != string(office.JobCompleted) {
		t.Fatalf("%s job = %+v", format, done)
	}
	res, err := e.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
		UploadID: done.OutputFileID.String, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatalf("%s commit: %v", format, err)
	}
	if res.Version.EngineVersion.String != office.TrustedEngineVersion ||
		res.Version.ContractVersion.String != office.ContractVersion {
		t.Fatalf("%s provenance = %+v", format, res.Version)
	}
	if got := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, want) {
		t.Fatalf("%s bytes changed: %d bytes, want %d", format, len(got), len(want))
	}
	return done
}

// assertFormatResolves proves a committed document still resolves to its
// engine format through the office service: a nameless provider output must
// not lose md/html to the text/plain sniff (the version keeps the document's
// mime, and the format resolver reads it).
func (e *officeRealEnv) assertFormatResolves(t *testing.T, documentID string, want office.Format) {
	t.Helper()
	cap, err := e.jobs.Capability(context.Background(), human(e.tn.member), documentID)
	if err != nil {
		t.Fatalf("capability after commit: %v", err)
	}
	if cap.Format != want {
		t.Fatalf("format after commit = %s, want %s", cap.Format, want)
	}
}

func mustReadFixture(t *testing.T, relative string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(officeFixtureRoot, filepath.FromSlash(relative)))
	if err != nil {
		t.Fatalf("fixture %s: %v", relative, err)
	}
	return body
}

func TestDocumentOfficeIntegration(t *testing.T) {
	backend, ok := officeMinioBackend()
	if !ok {
		t.Skip("MINIO_* is not set: the engine container PUTs to the presigned URL, so the real-store rows need MinIO")
	}
	e := newOfficeRealEnv(t, backend)
	ctx := context.Background()
	member := human(e.tn.member)

	t.Run("md: engine serialize to a committed version and back", func(t *testing.T) {
		body := mustReadFixture(t, "text/markdown-kitchen-sink.md")
		created := e.doc(t, "kitchen-sink.md", body)
		e.runSerialize(t, created, office.FormatMD, body)
		e.assertFormatResolves(t, created.Document.ID, office.FormatMD)
	})

	t.Run("html: engine serialize to a committed version and back", func(t *testing.T) {
		body := mustReadFixture(t, "text/html-vietnamese.html")
		created := e.doc(t, "vietnamese.html", body)
		e.runSerialize(t, created, office.FormatHTML, body)
		e.assertFormatResolves(t, created.Document.ID, office.FormatHTML)
	})

	t.Run("pdf: open probes, serialize commits, bytes survive, reopen", func(t *testing.T) {
		body := mustReadFixture(t, "pdf/pdf-text-editable.pdf")
		created := e.doc(t, "text-editable.pdf", body)
		open, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationOpen), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		if err != nil {
			t.Fatalf("pdf open: %v", err)
		}
		probe := e.settle(t, open.ID)
		if probe.State != string(office.JobCompleted) {
			t.Fatalf("pdf open job = %+v", probe)
		}
		// The probe artifact is engine JSON, not the document bytes.
		if probe.OutputChecksum.String == sha(body) {
			t.Fatal("pdf open returned the input instead of a probe artifact")
		}
		e.runSerialize(t, created, office.FormatPDF, body)
		e.assertFormatResolves(t, created.Document.ID, office.FormatPDF)
		// Reopen: the committed version comes back through the service - the
		// nameless provider output must not lose the document's format.
		doc := e.env.doc(t, created.Document.ID)
		reopen, err := e.jobs.StartOfficeJobForDocument(ctx, member, doc.ID, OfficeJobRequest{
			Operation: string(office.OperationOpen), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		if err != nil {
			t.Fatalf("pdf reopen: %v", err)
		}
		if settled := e.settle(t, reopen.ID); settled.State != string(office.JobCompleted) {
			t.Fatalf("pdf reopen job = %+v", settled)
		}
	})

	t.Run("docx/pptx: no bound handler -> typed refusal, store round-trip intact", func(t *testing.T) {
		for _, row := range []struct {
			rel, filename string
			format        office.Format
		}{
			{"docs/docx-simple.docx", "simple.docx", office.FormatDOCX},
			{"slides/pptx-standard-business.pptx", "standard-business.pptx", office.FormatPPTX},
		} {
			created := e.fixtureDoc(t, row.rel, row.filename)
			_, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
			})
			ee := wantOfficeCode(t, err, "unsupported_operation")
			if ee.Reason != "not_bound" {
				t.Fatalf("%s refusal = %+v", row.format, ee)
			}
			if n := e.env.officeJobRows(t, created.Document.ID); n != 0 {
				t.Fatalf("%s wrote %d job rows", row.format, n)
			}
			// The store path still round-trips the bytes a client editor would
			// have saved: upload -> commit -> read back.
			source := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{})
			upload := e.env.upload(t, member, created.Document.ID, row.filename, append([]byte(nil), source...))
			if _, err := e.env.commit(member, created.Document.ID, upload.UploadID, created.Document.Revision, util.NewID()); err != nil {
				t.Fatalf("%s commit: %v", row.format, err)
			}
			if got := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, source) {
				t.Fatalf("%s round-trip changed the bytes", row.format)
			}
		}
	})

	t.Run("blank: create_blank makes real engine bytes for md and html", func(t *testing.T) {
		for _, format := range []office.Format{office.FormatMD, office.FormatHTML} {
			res, err := e.jobs.CreateBlankFile(ctx, member, e.tn.wsA, BlankFileInput{
				Format: string(format), Title: "Blank " + string(format), IdempotencyKey: util.NewID(),
			})
			if err != nil {
				t.Fatalf("%s blank: %v", format, err)
			}
			if res.Document.Kind != DocumentKindFile {
				t.Fatalf("%s blank document = %+v", format, res.Document)
			}
			if body := e.env.read(t, member, res.Document.ID, 0, DocumentByteRange{}); len(body) == 0 {
				t.Fatalf("%s blank first version is empty", format)
			}
			// The engine's bytes went through the one G1 create path; the new
			// document resolves to its format like any other file document.
			e.assertFormatResolves(t, res.Document.ID, format)
		}
	})

	t.Run("fault: type-version-mismatch is refused before a job exists", func(t *testing.T) {
		// The frozen DOC-004 case (docs/office/g0/RT02-fault-type-version-mismatch.json):
		// a wrong contract, a wrong protocol type, a wrong protocol value and an
		// untrusted engine build are each refused with zero jobs, while the
		// accepted control (a real job) lives in the format rows above. These
		// probes post raw JSON because the Go client cannot even represent a
		// string protocol_version - the claim under test is that the REAL
		// engine refuses wire drift, not that Go can send it. Go's own
		// pre-mutation contract gate (office.Negotiate) is covered by
		// TestDocumentOfficeNegotiationGates.
		jobID, grantID := util.NewID(), util.NewID()
		grant, err := office.SignGrant(office.ServiceGrant{
			V: 1, GrantID: grantID, JobID: jobID, ActorID: util.NewID(), ActorKind: "human",
			OrganizationID: e.tn.orgID, WorkspaceID: e.tn.wsA, DocumentID: util.NewID(),
			Operation: office.OperationSerialize, Format: office.FormatMD, BaseRevision: 1, BaseVersionID: util.NewID(),
			Input:      &office.GrantInput{Checksum: sha(nil), Length: 0},
			DeadlineAt: time.Now().Add(time.Minute).UnixMilli(), IssuedAt: time.Now().UnixMilli(),
			ExpiresAt: time.Now().Add(30 * time.Second).UnixMilli(),
		}, []byte(officeEnv("OFFICE_ENGINE_TEST_GRANT_KEY", officeDevKey)))
		if err != nil {
			t.Fatal(err)
		}
		envelope := func(mutate func(map[string]any)) []byte {
			body := map[string]any{
				"request_id": jobID, "contract_version": office.ContractVersion, "protocol_version": office.ProtocolVersion,
				"operation": office.OperationSerialize, "format": office.FormatMD,
				"idempotency_key": jobID, "client_engine_version": office.TrustedEngineVersion, "grant_id": grantID,
				"payload": map[string]any{
					"input_bytes": "", "input_checksum": sha(nil), "input_length": 0, "document_model_ref": "drift",
				},
			}
			if mutate != nil {
				mutate(body)
			}
			raw, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			return raw
		}
		post := func(t *testing.T, body []byte) (int, map[string]any) {
			t.Helper()
			req, err := http.NewRequestWithContext(ctx, http.MethodPost,
				officeEnv("OFFICE_ENGINE_TEST_URL", "")+"/v1/jobs", bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer "+officeEnv("OFFICE_ENGINE_TEST_SERVICE_TOKEN", officeDevToken))
			req.Header.Set("X-Office-Grant", grant)
			req.Header.Set("Content-Type", "application/json")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			raw, _ := io.ReadAll(res.Body)
			var parsed map[string]any
			if err := json.Unmarshal(raw, &parsed); err != nil {
				t.Fatalf("engine answer is not JSON: %s", raw)
			}
			return res.StatusCode, parsed
		}
		refusal := func(t *testing.T, body map[string]any) (code, kind string) {
			t.Helper()
			outer, _ := body["error"].(map[string]any)
			if outer == nil {
				t.Fatalf("no error object in %v", body)
			}
			code, _ = outer["code"].(string)
			kind, _ = outer["kind"].(string)
			return code, kind
		}
		for _, c := range []struct {
			name     string
			mutate   func(map[string]any)
			wantHTTP int
			wantCode string
			wantKind string
		}{
			{"contract version outside the pin", func(m map[string]any) { m["contract_version"] = "uniwork-office-engine-contract/999" }, http.StatusBadRequest, "", "contract_violation"},
			{"protocol version sent as a string", func(m map[string]any) { m["protocol_version"] = "1" }, http.StatusBadRequest, "", "contract_violation"},
			{"protocol version outside the pin", func(m map[string]any) { m["protocol_version"] = 2 }, http.StatusBadRequest, "", "contract_violation"},
			{"untrusted engine build", func(m map[string]any) { m["client_engine_version"] = "untrusted@0" }, http.StatusConflict, "engine_incompatible", ""},
		} {
			t.Run(c.name, func(t *testing.T) {
				status, body := post(t, envelope(c.mutate))
				if status != c.wantHTTP {
					t.Fatalf("status = %d, want %d (%v)", status, c.wantHTTP, body)
				}
				code, kind := refusal(t, body)
				if c.wantCode != "" && code != c.wantCode {
					t.Fatalf("code = %q, want %q (%v)", code, c.wantCode, body)
				}
				if c.wantKind != "" && kind != c.wantKind {
					t.Fatalf("kind = %q, want %q (%v)", kind, c.wantKind, body)
				}
			})
		}
		// Every drifted envelope had to leave the engine without a job. The
		// grant was never consumed, so a status read under the same grant must
		// answer not_found.
		if _, err := e.eng.Status(ctx, jobID, grant); office.ErrorCode(err) != "not_found" {
			t.Fatalf("drift created or leaked a job: %v", err)
		}
	})

	t.Run("fault: malformed engine answer is engine_result_invalid", func(t *testing.T) {
		stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"capabilities":`))
		}))
		t.Cleanup(stub.Close)
		c, err := office.NewClient(office.Config{
			BaseURL: stub.URL, ServiceToken: officeEnv("OFFICE_ENGINE_TEST_SERVICE_TOKEN", officeDevToken),
			GrantKey: officeEnv("OFFICE_ENGINE_TEST_GRANT_KEY", officeDevKey),
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := c.Capability(ctx, office.FormatMD); office.ErrorCode(err) != "engine_result_invalid" {
			t.Fatalf("malformed answer = %v", err)
		}
	})

	t.Run("fault: checksum mismatch settles failed and commits nothing", func(t *testing.T) {
		// DOC-004 checksum-mismatch on the real engine: the container really
		// produces and PUTs the output, and the verification models the one
		// controlled field of the frozen oracle (RT02-fault-checksum-mismatch.json:
		// "controlled host-response checksum field") - FileService re-hashes the
		// real stored object while the engine's declared checksum drifts, so the
		// job fails engine_checksum_mismatch with zero commits and zero versions.
		body := mustReadFixture(t, "text/markdown-vietnamese.md")
		created := e.doc(t, "checksum.md", body)
		before := e.versionCount(t, created.Document.ID)
		row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
		})
		if err != nil {
			t.Fatalf("start: %v", err)
		}
		// Wait for the ENGINE to finish by reading it directly: the product's
		// own poll path would verify with the engine's real checksum.
		var engine office.JobStatus
		giveUp := time.Now().Add(60 * time.Second)
		for {
			grant, err := e.jobs.grantFor(row, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			engine, err = e.eng.Status(ctx, row.ID, grant)
			if err != nil {
				t.Fatalf("engine status: %v", err)
			}
			if !isLiveOfficeState(string(engine.State)) {
				break
			}
			if time.Now().After(giveUp) {
				t.Fatalf("engine job did not settle: %+v", engine)
			}
			time.Sleep(200 * time.Millisecond)
		}
		if engine.State != office.JobCompleted {
			t.Fatalf("engine job = %+v", engine)
		}
		done, err := e.jobs.verifyOutput(ctx, row, sha([]byte("not the engine's output")), nil)
		if err != nil {
			t.Fatalf("verify: %v", err)
		}
		if done.State != string(office.JobFailed) || done.ErrorCode.String != "engine_checksum_mismatch" {
			t.Fatalf("checksum job = %+v", done)
		}
		if _, err := e.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
			UploadID: done.OutputFileID.String, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
		}); err == nil {
			t.Fatal("a failed job committed a version")
		}
		if after := e.versionCount(t, created.Document.ID); after != before {
			t.Fatalf("versions moved %d -> %d", before, after)
		}
	})

	t.Run("fault: timeout settles timed_out and commits nothing", func(t *testing.T) {
		created := e.doc(t, "timeout.md", []byte("uniwork-fault:sleep 5000\n\ntext\n"))
		before := e.versionCount(t, created.Document.ID)
		row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 2 * time.Second,
		})
		if err != nil {
			t.Fatalf("start: %v", err)
		}
		done := e.settle(t, row.ID)
		if done.State != string(office.JobTimedOut) {
			t.Fatalf("timeout job = %+v", done)
		}
		if after := e.versionCount(t, created.Document.ID); after != before {
			t.Fatalf("versions moved %d -> %d", before, after)
		}
	})

	t.Run("fault: cancel wins while the engine is still working", func(t *testing.T) {
		created := e.doc(t, "cancel.md", []byte("uniwork-fault:sleep 4000\n\ntext\n"))
		key := util.NewID()
		var (
			wg       sync.WaitGroup
			startErr error
		)
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, startErr = e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
				Operation: string(office.OperationSerialize), IdempotencyKey: key, Deadline: 30 * time.Second,
			})
		}()
		var live db.OfficeJob
		for i := 0; i < 400; i++ {
			row, err := e.env.f.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{
				OrganizationID: e.tn.orgID, WorkspaceID: e.tn.wsA, IdempotencyKey: key,
			})
			if err == nil {
				live = row
				break
			}
			time.Sleep(25 * time.Millisecond)
		}
		if live.ID == "" {
			t.Fatal("no live job appeared to cancel")
		}
		cancelled, err := e.jobs.CancelOfficeJobForDocument(ctx, member, created.Document.ID, live.ID)
		if err != nil {
			t.Fatalf("cancel: %v", err)
		}
		if cancelled.State != string(office.JobCancelled) {
			t.Fatalf("cancelled = %+v", cancelled)
		}
		wg.Wait()
		if startErr != nil {
			t.Fatalf("start: %v", startErr)
		}
		if _, err := e.svc.CommitFileVersion(ctx, member, created.Document.ID, CommitFileVersionInput{
			UploadID: cancelled.OutputFileID.String, BaseRevision: created.Document.Revision, IdempotencyKey: util.NewID(),
		}); err == nil {
			t.Fatal("a cancelled job committed a version")
		}
		if got := e.jobs.mustGet(t, e.tn.orgID, e.tn.wsA, cancelled.ID); got.State != string(office.JobCancelled) {
			t.Fatalf("cancel was undone by a late engine answer: %+v", got)
		}
	})

	t.Run("fault: crash then restart, and a new job completes", func(t *testing.T) {
		container := restartable(t)
		created := e.doc(t, "crash.md", []byte("uniwork-fault:crash\n\ntext\n"))
		before := e.versionCount(t, created.Document.ID)
		row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
		})
		if err == nil {
			if settled := e.settle(t, row.ID); settled.State == string(office.JobCompleted) {
				t.Fatalf("crashed worker completed: %+v", settled)
			}
		}
		if after := e.versionCount(t, created.Document.ID); after != before {
			t.Fatalf("crash wrote a version: %d -> %d", before, after)
		}
		restartEngine(t, container, e.eng)
		fresh := e.fixtureDoc(t, "text/markdown-vietnamese.md", "after-restart.md")
		e.runSerialize(t, fresh, office.FormatMD, mustReadFixture(t, "text/markdown-vietnamese.md"))
	})

	t.Run("fault: metadata and bytes stay readable while the engine is down", func(t *testing.T) {
		container := restartable(t)
		created := e.fixtureDoc(t, "text/markdown-vietnamese.md", "engine-down.md")
		stopEngine(t, container)
		t.Cleanup(func() { startEngine(t, container) })
		if _, err := e.svc.GetDocument(ctx, member, created.Document.ID); err != nil {
			t.Fatalf("document read with engine down: %v", err)
		}
		if body := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); len(body) == 0 {
			t.Fatal("download with engine down returned nothing")
		}
		if _, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationSerialize), IdempotencyKey: util.NewID(), Deadline: 10 * time.Second,
		}); err == nil {
			t.Fatal("a job started with the engine down")
		}
		if n := e.env.officeJobRows(t, created.Document.ID); n != 0 {
			t.Fatalf("engine down wrote %d job rows", n)
		}
	})
}

func stopEngine(t *testing.T, container string) {
	t.Helper()
	if out, err := exec.Command("docker", "stop", "-t", "2", container).CombinedOutput(); err != nil {
		t.Fatalf("docker stop: %v %s", err, out)
	}
}

func startEngine(t *testing.T, container string) {
	t.Helper()
	if out, err := exec.Command("docker", "start", container).CombinedOutput(); err != nil {
		t.Fatalf("docker start: %v %s", err, out)
	}
}
