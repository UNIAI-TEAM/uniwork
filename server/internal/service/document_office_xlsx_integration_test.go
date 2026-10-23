package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeXlsxIntegration is the G2-07b real-store XLSX row: the
// real engine container (patched gateway + Rust recalc sidecar) with the real
// FileService, the real document ACL and the one G1-03 commit path. It drives
// the same main flow the 07a rows drive - upload -> open base -> edit ->
// serialize -> stage -> validate -> commit -> read back -> reopen - and proves
// the native recalculation landed in the committed bytes by reading the
// output package's own sheet XML with an independent oracle (the arithmetic
// computed from the literals the output carries).
//
// Environment: identical to TestDocumentOfficeIntegration (OFFICE_ENGINE_TEST_*,
// MINIO_*), including the write-target split: this file must run in the same
// invocation as TestDocumentOfficeJob (container-reachable bridge origin).

// xlsxSheetXML returns the worksheet XML of the sheet whose part carries the
// given marker (a formula string is unique per fixture sheet).
func xlsxSheetXML(t *testing.T, body []byte, marker string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("committed xlsx does not open as a zip: %v", err)
	}
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, "xl/worksheets/") || !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		raw, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		text := string(raw)
		if strings.Contains(text, marker) {
			return text
		}
	}
	t.Fatalf("no worksheet in the committed package carries %q", marker)
	return ""
}

var xlsxCellPattern = regexp.MustCompile(`<c r="(B[2-9])"(?:[^>]*)>(.*?)</c>`)

// xlsxCellValues reads the numeric <v> values keyed by cell ref from one
// worksheet XML. Only the simple single-<v> cells the fixture uses are read.
func xlsxCellValues(t *testing.T, sheetXML string) map[string]float64 {
	t.Helper()
	out := map[string]float64{}
	for _, match := range xlsxCellPattern.FindAllStringSubmatch(sheetXML, -1) {
		value := regexp.MustCompile(`<v>([^<]+)</v>`).FindStringSubmatch(match[2])
		if value == nil {
			continue
		}
		number, err := strconv.ParseFloat(value[1], 64)
		if err != nil {
			t.Fatalf("cell %s value %q: %v", match[1], value[1], err)
		}
		out[match[1]] = number
	}
	return out
}

// runXlsxEdit starts one real edit job on the document's current version and
// commits its output through the one commit path. The edits are the same ops
// shape the browser adapter sends (set_cell value).
func (e *officeRealEnv) runXlsxEdit(t *testing.T, documentID string, baseRevision int64, edits []office.EditOp) (db.OfficeJob, []byte) {
	t.Helper()
	ctx := context.Background()
	member := human(e.tn.member)
	row, err := e.jobs.StartOfficeJob(ctx, member, OfficeJobInput{
		OrganizationID: e.tn.orgID, WorkspaceID: e.tn.wsA, DocumentID: documentID,
		BaseVersionID: e.env.doc(t, documentID).FileVersionID.String, BaseRevision: baseRevision,
		Operation: office.OperationEdit, Format: office.FormatXLSX, Edits: edits,
		IdempotencyKey: util.NewID(), Deadline: 120 * time.Second,
	})
	if err != nil {
		t.Fatalf("xlsx edit: %v", err)
	}
	done := e.settle(t, row.ID)
	if done.State != string(office.JobCompleted) {
		t.Fatalf("xlsx edit job = %+v", done)
	}
	if _, err := e.svc.CommitFileVersion(ctx, member, documentID, CommitFileVersionInput{
		UploadID: done.OutputFileID.String, BaseRevision: baseRevision, IdempotencyKey: util.NewID(),
	}); err != nil {
		t.Fatalf("xlsx commit: %v", err)
	}
	body := e.env.read(t, member, documentID, 0, DocumentByteRange{})
	if len(body) == 0 {
		t.Fatal("committed xlsx version is empty")
	}
	return done, body
}

func TestDocumentOfficeXlsxIntegration(t *testing.T) {
	backend, ok := officeMinioBackend()
	if !ok {
		t.Skip("MINIO_* is not set: the engine container PUTs to the presigned URL, so the real-store rows need MinIO")
	}
	e := newOfficeRealEnv(t, backend)
	ctx := context.Background()
	member := human(e.tn.member)

	// The G2-04 replay oracle on the same fixture: Data!B2-B4 feed
	// Data!B5=SUM(B2:B4), and the cross-sheet PhuLuc!B2=SUM(Data!B2:B4) is the
	// clean recalculated cell (Data!B5's relocated formula keeps its file
	// `<v>` and warns, so it is not the value proof).
	const dataFormula = "<f>SUM(B2:B4)</f>"
	const crossFormula = "<f>SUM(Data!B2:B4)</f>"

	t.Run("xlsx: open probes, edit recalcs natively, commit, read back, reopen", func(t *testing.T) {
		body := mustReadFixture(t, "sheets/xlsx-kitchen-sink.xlsx")
		created := e.doc(t, "kitchen-sink.xlsx", body)

		open, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: string(office.OperationOpen), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		if err != nil {
			t.Fatalf("xlsx open: %v", err)
		}
		probe := e.settle(t, open.ID)
		if probe.State != string(office.JobCompleted) {
			t.Fatalf("xlsx open job = %+v", probe)
		}
		// The open output is the engine's probe JSON, not the input bytes.
		if probe.OutputChecksum.String == sha(body) {
			t.Fatal("xlsx open returned the input instead of a probe artifact")
		}

		_, committed := e.runXlsxEdit(t, created.Document.ID, created.Document.Revision, []office.EditOp{{
			Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","cell":"B2"}`), Attributes: json.RawMessage(`{"value":100}`),
		}})

		// Native recalculation evidence, independent of the engine: read the
		// output's own literals and recompute the cross-sheet sum.
		cross := xlsxSheetXML(t, committed, crossFormula)
		data := xlsxSheetXML(t, committed, dataFormula)
		literals := xlsxCellValues(t, data)
		oracle := literals["B2"] + literals["B3"] + literals["B4"]
		cells := xlsxCellValues(t, cross)
		if cells["B2"] != oracle {
			t.Fatalf("PhuLuc!B2 <v>=%v, oracle from output literals=%v", cells["B2"], oracle)
		}
		if literals["B2"] != 100 {
			t.Fatalf("Data!B2 = %v, want the edit's 100", literals["B2"])
		}

		// Reopen: the committed version comes back through the service.
		doc := e.env.doc(t, created.Document.ID)
		reopen, err := e.jobs.StartOfficeJobForDocument(ctx, member, doc.ID, OfficeJobRequest{
			Operation: string(office.OperationOpen), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		if err != nil {
			t.Fatalf("xlsx reopen: %v", err)
		}
		if settled := e.settle(t, reopen.ID); settled.State != string(office.JobCompleted) {
			t.Fatalf("xlsx reopen job = %+v", settled)
		}
		e.assertFormatResolves(t, created.Document.ID, office.FormatXLSX)
	})

	t.Run("xlsx: two saves rebase on the committed bytes and recalc again", func(t *testing.T) {
		created := e.fixtureDoc(t, "sheets/xlsx-kitchen-sink.xlsx", "two-save.xlsx")
		_, first := e.runXlsxEdit(t, created.Document.ID, created.Document.Revision, []office.EditOp{{
			Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","cell":"B2"}`), Attributes: json.RawMessage(`{"value":10}`),
		}})
		secondRevision := e.env.doc(t, created.Document.ID).Revision
		_, second := e.runXlsxEdit(t, created.Document.ID, secondRevision, []office.EditOp{{
			Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","cell":"B3"}`), Attributes: json.RawMessage(`{"value":20}`),
		}})
		if sha(first) == sha(second) {
			t.Fatal("the second save did not change the bytes")
		}
		data := xlsxSheetXML(t, second, dataFormula)
		literals := xlsxCellValues(t, data)
		if literals["B2"] != 10 || literals["B3"] != 20 {
			t.Fatalf("edited literals = B2 %v, B3 %v", literals["B2"], literals["B3"])
		}
		cells := xlsxCellValues(t, xlsxSheetXML(t, second, crossFormula))
		oracle := literals["B2"] + literals["B3"] + literals["B4"]
		if cells["B2"] != oracle {
			t.Fatalf("second save PhuLuc!B2 <v>=%v, oracle=%v", cells["B2"], oracle)
		}
	})

	t.Run("xlsx: convert/export rows answer unsupported_operation without a job", func(t *testing.T) {
		created := e.fixtureDoc(t, "sheets/xlsx-kitchen-sink.xlsx", "convert-rows.xlsx")
		cap, err := e.jobs.Capability(ctx, member, created.Document.ID)
		if err != nil {
			t.Fatalf("xlsx capability: %v", err)
		}
		if cap.Format != office.FormatXLSX {
			t.Fatalf("capability format = %s", cap.Format)
		}
		rows := map[string]OfficeCapabilityRow{}
		for _, row := range cap.Operations {
			rows[row.Operation] = row
		}
		for _, op := range []string{"open", "edit", "serialize"} {
			if !rows[op].EngineBound {
				t.Fatalf("xlsx %s is not engine-bound: %+v", op, rows[op])
			}
			if !rows[op].ProductSupported || rows[op].EvidenceLevel != string(office.EvidenceProven) {
				t.Fatalf("xlsx %s is not product-supported with proven evidence: %+v", op, rows[op])
			}
		}
		for _, op := range []string{"convert", "export"} {
			if !rows[op].EngineBound && rows[op].ProductSupported {
				t.Fatalf("xlsx %s claims product support without an engine binding", op)
			}
		}
		// Both operations are refused before a row exists (export names its own
		// reason; convert is gated by the engine's conversion capability).
		for _, op := range []office.Operation{office.OperationExport, office.OperationConvert} {
			_, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
				Operation: string(op), IdempotencyKey: util.NewID(), Deadline: 30 * time.Second,
			})
			if err == nil {
				t.Fatalf("xlsx %s started a job", op)
			}
			if got := office.ErrorCode(err); got != "unsupported_operation" {
				t.Fatalf("xlsx %s refusal = %v", op, err)
			}
			if n := e.env.officeJobRows(t, created.Document.ID); n != 0 {
				t.Fatalf("xlsx %s wrote %d job rows", op, n)
			}
		}
	})

	t.Run("xlsx: a corrupt upload is refused by the document validator", func(t *testing.T) {
		// The validator is the store-side half of "never upload an empty or
		// broken Office package": a PK zip without the xlsx main part is
		// refused before any document exists.
		if _, err := e.svc.CreateFileDocument(ctx, member, e.tn.wsA, CreateFileDocumentInput{
			Title: "broken xlsx", Filename: "broken.xlsx", Body: bytes.NewReader([]byte("PK\x03\x04not a package")),
		}); err == nil {
			t.Fatal("a broken xlsx upload created a document")
		}
	})
}
