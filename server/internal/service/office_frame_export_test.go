package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ExportFramePDF (UNI-1013) against the scripted engine and the test
// database: the export is an ordinary office job bound only on this path, it
// renders either the current version or the frame's supplied bytes, waits
// for the engine, and answers the staged PDF.

// exportFixture seeds a DOCX file document from the G0 fixtures.
func exportFixture(t *testing.T) (*officeFixture, []byte) {
	t.Helper()
	f := newOfficeFixture(t, "unused\n")
	docx := mustReadFixture(t, "docs/docx-kitchen-sink.docx")
	res, err := f.docs.CreateFileDocument(context.Background(), f.actor, f.ws, CreateFileDocumentInput{
		Title: "Báo cáo " + util.NewID()[20:], Filename: "report.docx", Body: strings.NewReader(string(docx)),
	})
	if err != nil {
		t.Fatalf("seed docx: %v", err)
	}
	f.doc, f.ver, f.rev = res.Document.ID, res.Version.ID, res.Document.Revision
	return f, docx
}

// exportedPDF is what the scripted renderer answers: a real PDF from the G0
// fixtures, so the stored output passes FileService's PDF checks.
func exportedPDF(t *testing.T) []byte {
	t.Helper()
	return mustReadFixture(t, "pdf/pdf-text-editable.pdf")
}

// exportEngine binds export and plays the renderer: every job it is handed
// completes with exportedPDF, or fails with failCode when set.
func exportEngine(t *testing.T, failCode string) *scriptedEngine {
	t.Helper()
	pdf := exportedPDF(t)
	eng := newScriptedEngine()
	eng.bound = map[office.Operation]bool{office.OperationExport: true, office.OperationOpen: true}
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		done := map[string]bool{}
		for {
			select {
			case <-stop:
				return
			case <-time.After(5 * time.Millisecond):
			}
			eng.mu.Lock()
			var pending []string
			for id, j := range eng.jobs {
				if j.state == office.JobRunning && !done[id] {
					pending = append(pending, id)
				}
			}
			eng.mu.Unlock()
			for _, id := range pending {
				done[id] = true
				if failCode != "" {
					eng.fail(id, office.JobFailed, failCode, "scripted")
					continue
				}
				eng.finish(t, id, pdf, "application/pdf")
			}
		}
	}()
	t.Cleanup(func() { close(stop); wg.Wait() })
	return eng
}

func readExport(t *testing.T, out OfficeExportPDF) []byte {
	t.Helper()
	defer out.Reader.Close()
	body, err := io.ReadAll(out.Reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestOfficeFrameExportPDF(t *testing.T) {
	ctx := context.Background()
	prev := officeExportPoll
	officeExportPoll = 10 * time.Millisecond
	t.Cleanup(func() { officeExportPoll = prev })

	t.Run("the current version renders through an export job and the access log records it", func(t *testing.T) {
		f, docx := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{})
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		if got := readExport(t, out); string(got) != string(exportedPDF(t)) {
			t.Fatalf("pdf = %d bytes", len(got))
		}
		row := out.Job
		if row.Operation != "export" || row.Format != "docx" || row.TargetFormat.String != "pdf" || row.State != "completed" ||
			row.BaseVersionID != f.ver || row.InputChecksum != sha(docx) {
			t.Fatalf("job = %+v", row)
		}
		g := eng.grants[0]
		if g.Operation != office.OperationExport || g.Format != office.FormatDOCX || g.Input == nil || g.Input.Checksum != sha(docx) ||
			g.DocumentID != f.doc || g.ActorID != f.actor.ID {
			t.Fatalf("grant = %+v", g)
		}
		logs, err := f.docs.ListDocumentAccessLogs(ctx, human(f.tn.owner), f.doc, DocumentAccessLogQuery{Action: DocumentAccessExport})
		if err != nil || len(logs) != 1 || logs[0].ActorID.String != f.actor.ID || !logs[0].Version.Valid {
			t.Fatalf("access log = %+v, %v", logs, err)
		}
	})

	t.Run("supplied bytes render instead of the stored version, and a reused key must carry the same bytes", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		edited := append([]byte("PK\x03\x04"), []byte("unsaved edit")...)
		out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{IdempotencyKey: "exp-1", Bytes: edited})
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		readExport(t, out)
		if out.Job.InputChecksum != sha(edited) || eng.grants[0].Input.Checksum != sha(edited) {
			t.Fatalf("the job did not bind the supplied bytes: %+v", out.Job)
		}
		again, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{IdempotencyKey: "exp-1", Bytes: edited})
		if err != nil || again.Job.ID != out.Job.ID {
			t.Fatalf("replay: %+v %v", again.Job, err)
		}
		readExport(t, again)
		other := append([]byte("PK\x03\x04"), []byte("another edit")...)
		_, err = svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{IdempotencyKey: "exp-1", Bytes: other})
		if office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("changed bytes under one key: %v", err)
		}
	})

	t.Run("the configured file cap bounds supplied bytes", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		// A non-default cap: the wrapper reports the registry the production
		// FileService would have been built with while the bridge fake still
		// stores every byte (the seeded base file, the export output).
		const cap = 1 << 20
		specs := files.SpecsWithDocumentMaxBytes(cap)
		reg, err := files.NewRegistry(specs...)
		if err != nil {
			t.Fatal(err)
		}
		svc.files = &cappedFiles{Service: f.files, registry: reg}

		ok := append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, cap-4)...)
		out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Bytes: ok})
		if err != nil {
			t.Fatalf("input at the configured cap: %v", err)
		}
		readExport(t, out)

		over := append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, cap-3)...)
		_, err = svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Bytes: over})
		if office.ErrorCode(err) != "upload_bounds" {
			t.Fatalf("input over the configured cap: %v", err)
		}
		var ee *office.EngineError
		if !errors.As(err, &ee) || ee.Reason != "input_too_large" {
			t.Fatalf("reason = %v, want input_too_large", err)
		}
	})

	t.Run("bytes that cannot be a DOCX are refused before a job exists", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		_, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Bytes: []byte("%PDF-not a docx")})
		if !errors.Is(err, ErrOfficeExportInput) || len(eng.grants) != 0 {
			t.Fatalf("err = %v, grants = %d", err, len(eng.grants))
		}
	})

	t.Run("a version number picks the stored bytes; with supplied bytes it is invalid", func(t *testing.T) {
		f, docx := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
		if err != nil {
			t.Fatalf("export v1: %v", err)
		}
		readExport(t, out)
		if out.Job.InputChecksum != sha(docx) {
			t.Fatalf("v1 rendered %s", out.Job.InputChecksum)
		}
		if _, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 9}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("unknown version: %v", err)
		}
		if _, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: -1}); !errors.Is(err, ErrOfficeExportInput) {
			t.Fatalf("negative version: %v", err)
		}
		both := OfficeExportPDFInput{Version: 1, Bytes: []byte("PK\x03\x04x")}
		if _, err := svc.ExportFramePDF(ctx, f.actor, f.doc, both); !errors.Is(err, ErrOfficeExportInput) {
			t.Fatalf("bytes and version: %v", err)
		}
	})

	t.Run("an engine refusal reaches the caller with its code", func(t *testing.T) {
		f, _ := exportFixture(t)
		svc := f.service(exportEngine(t, "engine_incompatible"))
		_, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{})
		if office.ErrorCode(err) != "engine_incompatible" {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("an engine build without export answers unsupported_operation", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := newScriptedEngine()
		svc := f.service(eng)
		_, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{})
		if office.ErrorCode(err) != "unsupported_operation" || len(eng.grants) != 0 {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("no engine is office_not_configured", func(t *testing.T) {
		f, _ := exportFixture(t)
		svc := f.service(nil)
		if _, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{}); !errors.Is(err, office.ErrNotConfigured) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("someone without access to the document gets nothing", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		for _, who := range []db.User{f.tn.outsider, f.tn.bMember} {
			_, err := svc.ExportFramePDF(ctx, human(who), f.doc, OfficeExportPDFInput{})
			if !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
				t.Fatalf("%s: err = %v", who.ID, err)
			}
		}
		if len(eng.grants) != 0 {
			t.Fatalf("a refused export reached the engine: %d grants", len(eng.grants))
		}
	})

	t.Run("the public job route still refuses export", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		in := f.input("k-public-export")
		in.Operation, in.Format, in.TargetFormat = office.OperationExport, office.FormatDOCX, office.FormatPDF
		_, err := svc.StartOfficeJob(ctx, f.actor, in)
		if office.ErrorCode(err) != "unsupported_operation" || len(eng.grants) != 0 {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("an export output never becomes a version of its source", func(t *testing.T) {
		f, _ := exportFixture(t)
		svc := f.service(exportEngine(t, ""))
		out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{})
		if err != nil {
			t.Fatal(err)
		}
		readExport(t, out)
		_, err = f.docs.CommitFileVersion(ctx, f.actor, f.doc, CommitFileVersionInput{
			UploadID: out.Job.OutputFileID.String, BaseRevision: f.rev, IdempotencyKey: util.NewID(),
		})
		var coded CodedError
		if !errors.As(err, &coded) || coded.Fields["reason"] != "office_job_export_not_a_version" {
			t.Fatalf("commit of an export output: %v", err)
		}
	})
}

func TestOfficeExportInputAndOutcome(t *testing.T) {
	if _, err := officeExportInputWithCap([]byte("PK"), 0); !errors.Is(err, ErrOfficeExportInput) {
		t.Fatalf("short input: %v", err)
	}
	if in, err := officeExportInputWithCap([]byte("PK\x03\x04rest"), 0); err != nil || in.checksum != sha([]byte("PK\x03\x04rest")) {
		t.Fatalf("docx input: %+v %v", in, err)
	}
	cases := map[string]db.OfficeJob{
		"engine_timeout":   {State: "timed_out"},
		"engine_cancelled": {State: "cancelled"},
		"engine_crashed":   {State: "failed"},
	}
	for want, row := range cases {
		if got := office.ErrorCode(officeJobOutcome(row)); got != want {
			t.Fatalf("%s: got %s", row.State, got)
		}
	}
	if got := office.ErrorCode(officeJobOutcome(db.OfficeJob{State: "completed"})); got != "engine_result_invalid" {
		t.Fatalf("completed without output: %s", got)
	}
}

// cappedFiles reports a different purpose registry than the service it wraps,
// the way a FileService built with DocumentMaxBytes does.
type cappedFiles struct {
	files.Service
	registry files.Registry
}

func (c *cappedFiles) Registry() files.Registry { return c.registry }

// preSubmitLimitFiles fails a Read when more than maxPreRead bytes are pulled
// from storage before the engine's Submit starts.
type preSubmitLimitFiles struct {
	*countingFiles
	inSubmit   *atomic.Bool
	maxPreRead int64
}

type preSubmitLimitBody struct {
	io.ReadCloser
	parent *preSubmitLimitFiles
}

func (b *preSubmitLimitBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	total := b.parent.read.Load()
	if !b.parent.inSubmit.Load() && total > b.parent.maxPreRead {
		return n, fmt.Errorf("read %d bytes before Submit started (limit %d): input was buffered", total, b.parent.maxPreRead)
	}
	return n, err
}

func (f *preSubmitLimitFiles) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	r, err := f.countingFiles.Open(ctx, in)
	if err != nil {
		return r, err
	}
	r.Body = &preSubmitLimitBody{ReadCloser: r.Body, parent: f}
	return r, nil
}

// exportOlderVersionFixture creates a document whose v1 is v1Body (v1Filename)
// and commits a DOCX v2 on top, so v1 is an older stored version while the
// current document version is a valid DOCX.
func exportOlderVersionFixture(t *testing.T, v1Filename string, v1Body []byte) (*officeFixture, string) {
	t.Helper()
	ctx := context.Background()
	f := newOfficeFixture(t, "unused\n")
	res, err := f.docs.CreateFileDocument(ctx, f.actor, f.ws, CreateFileDocumentInput{
		Title: "Báo cáo " + util.NewID()[20:], Filename: v1Filename, Body: bytes.NewReader(v1Body),
	})
	if err != nil {
		t.Fatalf("seed v1: %v", err)
	}
	v1ID := res.Version.ID
	v2Docx := mustReadFixture(t, "docs/docx-simple.docx")
	up, err := f.docs.UploadDocumentFile(ctx, f.actor, res.Document.ID, DocumentUploadInput{
		Filename: "report-v2.docx", Body: bytes.NewReader(v2Docx),
	})
	if err != nil {
		t.Fatalf("upload v2: %v", err)
	}
	v2, err := f.docs.CommitFileVersion(ctx, f.actor, res.Document.ID, CommitFileVersionInput{
		UploadID: up.UploadID, BaseRevision: res.Document.Revision, IdempotencyKey: util.NewID(),
	})
	if err != nil {
		t.Fatalf("commit v2: %v", err)
	}
	f.doc, f.ver, f.rev = v2.Document.ID, v2.Version.ID, v2.Document.Revision
	return f, v1ID
}

func TestOfficeFrameExportVersionStreamsStoredInput(t *testing.T) {
	ctx := context.Background()
	prev := officeExportPoll
	officeExportPoll = 10 * time.Millisecond
	t.Cleanup(func() { officeExportPoll = prev })

	v1Docx := mustReadFixture(t, "docs/docx-kitchen-sink.docx")
	f, _ := exportOlderVersionFixture(t, "report-v1.docx", v1Docx)

	var inSubmit atomic.Bool
	cf := &countingFiles{bridgeFiles: f.files}
	lf := &preSubmitLimitFiles{countingFiles: cf, inSubmit: &inSubmit, maxPreRead: 4}
	f.docs.SetFiles(lf)
	eng := exportEngine(t, "")
	seen := recordSubmits(eng, cf, nil)
	prevHook := eng.submitHook
	eng.submitHook = func(env office.Envelope, in office.InputSource) error {
		inSubmit.Store(true)
		return prevHook(env, in)
	}
	svc := f.streamService(eng, lf)

	out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
	if err != nil {
		t.Fatalf("export v1: %v", err)
	}
	if got := readExport(t, out); !bytes.Equal(got, exportedPDF(t)) {
		t.Fatalf("pdf = %d bytes", len(got))
	}
	if len(*seen) != 1 {
		t.Fatalf("submits: %d, want 1", len(*seen))
	}
	s := (*seen)[0]
	if s.readAtStart > 4 {
		t.Fatalf("%d bytes read before Submit started, want at most 4-byte magic peek", s.readAtStart)
	}
	if !bytes.Equal(s.body, v1Docx) {
		t.Fatalf("streamed %d bytes, want the %d-byte v1 docx byte-exact", len(s.body), len(v1Docx))
	}
	want := sha(v1Docx)
	if s.source.Checksum != want || s.source.Length != int64(len(v1Docx)) || out.Job.InputChecksum != want || out.Job.InputLength != int64(len(v1Docx)) {
		t.Fatalf("digest: source=%+v job=%+v want=%s/%d", s.source, out.Job, want, len(v1Docx))
	}
}

func TestOfficeFrameExportVersionSpoolsLegacyInputAndDeletesIt(t *testing.T) {
	ctx := context.Background()
	prev := officeExportPoll
	officeExportPoll = 10 * time.Millisecond
	t.Cleanup(func() { officeExportPoll = prev })

	v1Docx := mustReadFixture(t, "docs/docx-kitchen-sink.docx")
	f, v1ID := exportOlderVersionFixture(t, "report-v1.docx", v1Docx)
	if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, v1ID); err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)

	cf := &countingFiles{bridgeFiles: f.files}
	f.docs.SetFiles(cf)
	eng := exportEngine(t, "")
	var spooledDuringSubmit int
	seen := recordSubmits(eng, cf, func(int) error {
		entries, _ := os.ReadDir(spool)
		spooledDuringSubmit = len(entries)
		return nil
	})
	svc := f.streamService(eng, cf)

	out, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
	if err != nil {
		t.Fatalf("export legacy v1: %v", err)
	}
	if got := readExport(t, out); !bytes.Equal(got, exportedPDF(t)) {
		t.Fatalf("pdf = %d bytes", len(got))
	}
	s := (*seen)[0]
	want := sha(v1Docx)
	if !bytes.Equal(s.body, v1Docx) || s.source.Checksum != want || out.Job.InputChecksum != want {
		t.Fatalf("spooled export submit: %d bytes, source %+v, row %s", len(s.body), s.source, out.Job.InputChecksum)
	}
	if spooledDuringSubmit != 1 {
		t.Fatalf("temp files while submitting: %d, want 1", spooledDuringSubmit)
	}
	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("spool file left behind after export answered: %v", entries)
	}
}

func TestOfficeFrameExportVersionRefusesNonZipAndOverCap(t *testing.T) {
	ctx := context.Background()
	prev := officeExportPoll
	officeExportPoll = 10 * time.Millisecond
	t.Cleanup(func() { officeExportPoll = prev })

	t.Run("a stored version that is not a ZIP answers ErrOfficeExportInput without buffering or creating a job", func(t *testing.T) {
		nonZip := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("not a zip container\n"), 2000)...)
		f, v1ID := exportOlderVersionFixture(t, "report-v1.docx", mustReadFixture(t, "docs/docx-kitchen-sink.docx"))
		up, err := f.files.Upload(ctx, files.UploadInput{
			Actor: f.actor, Purpose: files.DocumentFile,
			Scope:          files.Scope{OrganizationID: f.org, WorkspaceID: f.ws},
			IdempotencyKey: util.NewID(), Filename: "not-a-zip.pdf", Body: bytes.NewReader(nonZip),
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET file_id = $1, checksum_sha256 = $2, size_bytes = $3 WHERE id = $4`,
			string(up.File.ID), up.File.ChecksumSHA256, up.File.SizeBytes, v1ID); err != nil {
			t.Fatal(err)
		}
		var inSubmit atomic.Bool
		cf := &countingFiles{bridgeFiles: f.files}
		lf := &preSubmitLimitFiles{countingFiles: cf, inSubmit: &inSubmit, maxPreRead: 4}
		f.docs.SetFiles(lf)
		eng := exportEngine(t, "")
		svc := f.streamService(eng, lf)

		_, err = svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
		if !errors.Is(err, ErrOfficeExportInput) {
			t.Fatalf("stored non-zip err = %v, want ErrOfficeExportInput", err)
		}
		if got := cf.read.Load(); got > 4 {
			t.Fatalf("read %d bytes before refusing non-zip, want at most 4", got)
		}
		if got := cf.closes.Load(); got != 1 {
			t.Fatalf("closes = %d, want 1", got)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 || len(eng.grants) != 0 {
			t.Fatalf("office_jobs = %d, grants = %d, want 0", n, len(eng.grants))
		}

		// Legacy (no checksum) non-ZIP also cleans up its spool and creates no job.
		if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, v1ID); err != nil {
			t.Fatal(err)
		}
		spool := t.TempDir()
		t.Setenv("TMPDIR", spool)
		cfLegacy := &countingFiles{bridgeFiles: f.files}
		f.docs.SetFiles(cfLegacy)
		svcLegacy := f.streamService(eng, cfLegacy)
		_, err = svcLegacy.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
		if !errors.Is(err, ErrOfficeExportInput) {
			t.Fatalf("legacy non-zip err = %v, want ErrOfficeExportInput", err)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 || len(eng.grants) != 0 {
			t.Fatalf("office_jobs = %d, grants = %d, want 0", n, len(eng.grants))
		}
		if entries, _ := os.ReadDir(spool); len(entries) != 0 {
			t.Fatalf("spool file left behind after refused non-zip: %v", entries)
		}
	})

	t.Run("an over-cap stored version answers upload_bounds with reason input_too_large and creates no job", func(t *testing.T) {
		v1Docx := mustReadFixture(t, "docs/docx-kitchen-sink.docx")
		f, v1ID := exportOlderVersionFixture(t, "report-v1.docx", v1Docx)
		capBytes := int64(len(v1Docx)) - 1
		reg, err := files.NewRegistry(files.SpecsWithDocumentMaxBytes(capBytes)...)
		if err != nil {
			t.Fatal(err)
		}
		cf := &countingFiles{bridgeFiles: f.files}
		capped := &cappedFiles{Service: cf, registry: reg}
		f.docs.SetFiles(capped)
		eng := exportEngine(t, "")
		svc := f.streamService(eng, capped)

		_, err = svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
		if office.ErrorCode(err) != "upload_bounds" {
			t.Fatalf("over-cap stored version err = %v, want upload_bounds", err)
		}
		var ee *office.EngineError
		if !errors.As(err, &ee) || ee.Reason != "input_too_large" {
			t.Fatalf("reason = %v, want input_too_large", err)
		}
		if got := cf.read.Load(); got != 0 {
			t.Fatalf("read %d bytes from over-cap stored version, want 0 (size check before reading)", got)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 || len(eng.grants) != 0 {
			t.Fatalf("office_jobs = %d, grants = %d, want 0", n, len(eng.grants))
		}

		// Legacy (no checksum) over-cap version also answers upload_bounds / input_too_large and leaves no spool.
		if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, v1ID); err != nil {
			t.Fatal(err)
		}
		spool := t.TempDir()
		t.Setenv("TMPDIR", spool)
		_, err = svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Version: 1})
		if office.ErrorCode(err) != "upload_bounds" {
			t.Fatalf("over-cap legacy version err = %v, want upload_bounds", err)
		}
		if !errors.As(err, &ee) || ee.Reason != "input_too_large" {
			t.Fatalf("legacy reason = %v, want input_too_large", err)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 || len(eng.grants) != 0 {
			t.Fatalf("office_jobs = %d, grants = %d, want 0", n, len(eng.grants))
		}
		if entries, _ := os.ReadDir(spool); len(entries) != 0 {
			t.Fatalf("spool file left behind after over-cap legacy version: %v", entries)
		}
	})
}
