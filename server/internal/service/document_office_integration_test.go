package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
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
// The five formats are driven by what the engine build binds: md/html/pdf run
// real engine jobs; docx/pptx have no server-side handler in this build, so
// their row proves the honest refusal plus the store/commit round-trip.

var officeFixtureRoot = filepath.Join("..", "..", "docs", "office", "g0", "fixtures", "files")

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
		Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
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

func mustReadFixture(t *testing.T, relative string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(officeFixtureRoot, filepath.FromSlash(relative)))
	if err != nil {
		t.Fatalf("fixture %s: %v", relative, err)
	}
	return body
}

func TestDocumentOfficeIntegration(t *testing.T) {
	backend, ok := minioFileBackend()
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
	})

	t.Run("html: engine serialize to a committed version and back", func(t *testing.T) {
		body := mustReadFixture(t, "text/html-vietnamese.html")
		created := e.doc(t, "vietnamese.html", body)
		e.runSerialize(t, created, office.FormatHTML, body)
	})

	t.Run("pdf: open probes, serialize commits, bytes survive", func(t *testing.T) {
		body := mustReadFixture(t, "pdf/pdf-text-editable.pdf")
		created := e.doc(t, "text-editable.pdf", body)
		open, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: office.OperationOpen, IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
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
				Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
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

	t.Run("fault: type-version-mismatch is refused before a job exists", func(t *testing.T) {
		jobID, grantID := util.NewID(), util.NewID()
		grant, err := office.SignGrant(office.ServiceGrant{
			V: 1, GrantID: grantID, JobID: jobID, ActorID: util.NewID(), ActorKind: "human",
			OrganizationID: e.tn.orgID, WorkspaceID: e.tn.wsA, DocumentID: util.NewID(),
			Operation: office.OperationSerialize, Format: office.FormatMD,
			DeadlineAt: time.Now().Add(time.Minute).UnixMilli(), IssuedAt: time.Now().UnixMilli(),
			ExpiresAt: time.Now().Add(30 * time.Second).UnixMilli(),
		}, []byte(officeEnv("OFFICE_ENGINE_TEST_GRANT_KEY", officeDevKey)))
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(map[string]any{
			"input_bytes": "", "input_checksum": sha(nil), "input_length": 0, "document_model_ref": "drift",
		})
		_, err = e.eng.Submit(ctx, grant, office.Envelope{
			RequestID: jobID, ContractVersion: "uniwork-office-engine-contract/9", ProtocolVersion: office.ProtocolVersion,
			Operation: office.OperationSerialize, Format: office.FormatMD, IdempotencyKey: jobID,
			ClientEngineVersion: office.TrustedEngineVersion, GrantID: grantID, Payload: payload,
		})
		if ee := wantOfficeCode(t, err, "contract_mismatch"); ee.Status != http.StatusConflict {
			t.Fatalf("contract mismatch = %+v", ee)
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
		created := e.doc(t, "checksum.md", []byte("uniwork-fault:code engine_checksum_mismatch\n\ntext\n"))
		before := e.versionCount(t, created.Document.ID)
		row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
		})
		if err != nil {
			t.Fatalf("start: %v", err)
		}
		done := e.settle(t, row.ID)
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
			Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 2 * time.Second,
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
				Operation: office.OperationSerialize, IdempotencyKey: key, Deadline: 30 * time.Second,
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
			Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
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
			Operation: office.OperationSerialize, IdempotencyKey: util.NewID(), Deadline: 10 * time.Second,
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
