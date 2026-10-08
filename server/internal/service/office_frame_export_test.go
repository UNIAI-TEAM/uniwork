package service

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

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

	t.Run("bytes that cannot be a DOCX are refused before a job exists", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := exportEngine(t, "")
		svc := f.service(eng)
		_, err := svc.ExportFramePDF(ctx, f.actor, f.doc, OfficeExportPDFInput{Bytes: []byte("%PDF-not a docx")})
		if !errors.Is(err, ErrOfficeExportInput) || len(eng.grants) != 0 {
			t.Fatalf("err = %v, grants = %d", err, len(eng.grants))
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
	if _, err := officeExportInput([]byte("PK")); !errors.Is(err, ErrOfficeExportInput) {
		t.Fatalf("short input: %v", err)
	}
	if in, err := officeExportInput([]byte("PK\x03\x04rest")); err != nil || in.checksum != sha([]byte("PK\x03\x04rest")) {
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
