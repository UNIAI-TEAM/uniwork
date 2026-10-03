package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// G2-07a (UNI-690): the capability answer, the pre-mutation negotiation and
// the blank-create refusals. The happy paths run against the real engine
// container in TestDocumentOfficeIntegration.

func wantOfficeCode(t *testing.T, err error, code string) *office.EngineError {
	t.Helper()
	var ee *office.EngineError
	if !errors.As(err, &ee) || ee.Code != code {
		t.Fatalf("want office code %s, got %v", code, err)
	}
	return ee
}

func (f *officeFixture) reseed(t *testing.T, filename string, body []byte) {
	t.Helper()
	res, err := f.docs.CreateFileDocument(context.Background(), f.actor, f.ws, CreateFileDocumentInput{
		Title: "Tai lieu " + util.NewID()[20:], Filename: filename, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("reseed %s: %v", filename, err)
	}
	f.doc, f.ver, f.rev = res.Document.ID, res.Version.ID, res.Document.Revision
}

func (f *officeFixture) officeJobCount(t *testing.T, documentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM office_jobs WHERE document_id = $1`, documentID).Scan(&n); err != nil {
		t.Fatalf("count office jobs: %v", err)
	}
	return n
}

func (f *officeFixture) documentCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM documents WHERE workspace_id = $1`, f.ws).Scan(&n); err != nil {
		t.Fatalf("count documents: %v", err)
	}
	return n
}

func capabilityRow(t *testing.T, caps OfficeCapability, operation string) OfficeCapabilityRow {
	t.Helper()
	for _, row := range caps.Operations {
		if row.Operation == operation {
			return row
		}
	}
	t.Fatalf("capability row %q missing from %+v", operation, caps.Operations)
	return OfficeCapabilityRow{}
}

func TestDocumentOfficeCapability(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# Ghi chu\n")
	svc := f.service(newScriptedEngine())

	caps, err := svc.Capability(ctx, f.actor, f.doc)
	if err != nil {
		t.Fatalf("capability: %v", err)
	}
	if caps.Format != office.FormatMD || caps.EngineVersion != office.TrustedEngineVersion {
		t.Fatalf("capability head = %+v", caps)
	}
	blank := capabilityRow(t, caps, officeBlankOperation)
	if !blank.EngineBound || !blank.ProductSupported || blank.EvidenceLevel != string(office.EvidenceProven) {
		t.Fatalf("create_blank row = %+v", blank)
	}
	serialize := capabilityRow(t, caps, string(office.OperationSerialize))
	if !serialize.EngineBound || !serialize.ProductSupported {
		t.Fatalf("serialize row = %+v", serialize)
	}
	// The scripted double binds no convert: bound and product are both false.
	if convert := capabilityRow(t, caps, string(office.OperationConvert)); convert.EngineBound || convert.ProductSupported {
		t.Fatalf("convert row = %+v", convert)
	}

	// A pdf document has no blank generator: the action is withheld, never a
	// zero-byte Office file.
	f.reseed(t, "report.pdf", pdfBody("cap-pdf-"+util.NewID()[20:]))
	pdfCaps, err := svc.Capability(ctx, f.actor, f.doc)
	if err != nil {
		t.Fatalf("pdf capability: %v", err)
	}
	if pdfBlank := capabilityRow(t, pdfCaps, officeBlankOperation); pdfBlank.ProductSupported || pdfBlank.EngineBound {
		t.Fatalf("pdf create_blank row = %+v", pdfBlank)
	} else if pdfBlank.Reason == "" {
		t.Fatal("pdf create_blank row has no reason")
	}

	// A page document is not an engine target.
	page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Trang " + util.NewID()[20:]})
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	if _, err := svc.Capability(ctx, f.actor, page.Document.ID); err == nil {
		t.Fatal("page document answered a capability")
	} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "page_document" {
		t.Fatalf("page refusal = %+v", ee)
	}

	// A member of no workspace sees nothing: no capability, no existence leak.
	outsider := Human(f.tn.outsider.ID)
	if _, err := svc.Capability(ctx, outsider, f.doc); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider capability = %v, want not_found", err)
	}

	// No engine deployed: the typed not-configured error, not an empty row set.
	noEngine := f.service(nil)
	if _, err := noEngine.Capability(ctx, f.actor, f.doc); !errors.Is(err, office.ErrNotConfigured) {
		t.Fatalf("unconfigured capability = %v", err)
	}
}

func TestDocumentOfficeNegotiationGates(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# Ghi chu\n")

	// A build the server was not written against is refused before mutation.
	drift := newScriptedEngine()
	drift.engineVersion = "genoffice@deadbeef+uniwork-office.9"
	svc := f.service(drift)
	if _, err := svc.StartOfficeJob(ctx, f.actor, f.input("gate-drift")); err == nil {
		t.Fatal("drifting build started a job")
	} else if ee := wantOfficeCode(t, err, "engine_incompatible"); ee.Reason == "" {
		t.Fatalf("drift refusal = %+v", ee)
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("drift wrote %d office_jobs rows", n)
	}

	// An operation the build does not bind is refused before mutation too.
	unbound := newScriptedEngine()
	unbound.bound = map[office.Operation]bool{office.OperationOpen: true}
	svc = f.service(unbound)
	if _, err := svc.StartOfficeJob(ctx, f.actor, f.input("gate-unbound")); err == nil {
		t.Fatal("unbound serialize started a job")
	} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "not_bound" {
		t.Fatalf("unbound refusal = %+v", ee)
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("unbound operation wrote %d office_jobs rows", n)
	}

	// A malformed capability answer is drift, not a pass.
	malformed := newScriptedEngine()
	malformed.capabilityErr = office.NewEngineError("engine_result_invalid", "capability_json")
	svc = f.service(malformed)
	if _, err := svc.StartOfficeJob(ctx, f.actor, f.input("gate-malformed")); err == nil {
		t.Fatal("malformed capability started a job")
	} else {
		wantOfficeCode(t, err, "engine_result_invalid")
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("malformed capability wrote %d office_jobs rows", n)
	}

	// A job whose format is not the document's format is a caller error.
	mismatch := f.input("gate-format")
	mismatch.Format = office.FormatPDF
	svc = f.service(newScriptedEngine())
	if _, err := svc.StartOfficeJob(ctx, f.actor, mismatch); err == nil {
		t.Fatal("format mismatch started a job")
	} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "format_mismatch" {
		t.Fatalf("format mismatch refusal = %+v", ee)
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("format mismatch wrote %d office_jobs rows", n)
	}

	// The retry of a refused key still answers the same typed refusal.
	if _, err := svc.StartOfficeJob(ctx, f.actor, mismatch); err == nil {
		t.Fatal("second format mismatch started a job")
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("retry wrote %d office_jobs rows", n)
	}
}

func TestDocumentOfficeBlankRefusals(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# Ghi chu\n")
	svc := f.service(newScriptedEngine())
	human := f.actor
	before := f.documentCount(t)

	// A format with no blank generator stores nothing at all.
	if _, err := svc.CreateBlankFile(ctx, human, f.ws, BlankFileInput{Format: string(office.FormatPDF), Title: "Trong"}); err == nil {
		t.Fatal("pdf blank create succeeded")
	} else if ee := wantOfficeCode(t, err, "unsupported_operation"); ee.Reason != "blank_not_bound" {
		t.Fatalf("pdf blank refusal = %+v", ee)
	}
	if after := f.documentCount(t); after != before {
		t.Fatalf("pdf blank create wrote %d documents", after-before)
	}

	// The same rule holds for the Office packages: an empty DOCX is not a document.
	if _, err := svc.CreateBlankFile(ctx, human, f.ws, BlankFileInput{Format: string(office.FormatDOCX), Title: "Trong"}); err == nil {
		t.Fatal("docx blank create succeeded")
	}
	// An agent never writes documents directly (ADR 0010).
	agent := Actor{Kind: audit.KindAgent, ID: f.tn.agent}
	if _, err := svc.CreateBlankFile(ctx, agent, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Trong"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent blank create = %v, want forbidden", err)
	}
	// No engine: refused before anything exists.
	if _, err := f.service(nil).CreateBlankFile(ctx, human, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Trong"}); !errors.Is(err, office.ErrNotConfigured) {
		t.Fatalf("unconfigured blank create = %v", err)
	}
	// Engine drift: refused before anything exists.
	drift := newScriptedEngine()
	drift.engineVersion = "genoffice@deadbeef+uniwork-office.9"
	if _, err := f.service(drift).CreateBlankFile(ctx, human, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Trong"}); err == nil {
		t.Fatal("drifting engine created a blank")
	} else {
		wantOfficeCode(t, err, "engine_incompatible")
	}
	if after := f.documentCount(t); after != before {
		t.Fatalf("refused blank creates wrote %d documents", after-before)
	}
}

// The blank route shares the create key scope with the plain upload route: a
// key a plain upload used is never replayed as an engine-made blank.
func TestDocumentOfficeBlankRefusalsKeyOfAPlainUpload(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# seed\n")
	eng := newScriptedEngine()
	svc := f.service(eng)
	key := util.NewID()
	if _, err := f.docs.CreateFileDocument(ctx, f.actor, f.ws, CreateFileDocumentInput{
		Title: "Trong", Filename: "tai-len.md", Body: strings.NewReader("arbitrary bytes\n"), IdempotencyKey: key,
	}); err != nil {
		t.Fatal(err)
	}
	before := f.documentCount(t)
	if res, err := svc.CreateBlankFile(ctx, f.actor, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Trong", IdempotencyKey: key}); err == nil {
		t.Fatalf("blank create replayed a plain upload: %+v", res.Document)
	}
	eng.mu.Lock()
	submitted := len(eng.jobs)
	eng.mu.Unlock()
	if submitted != 0 {
		t.Fatalf("blank create on a used key ran the engine: %d jobs", submitted)
	}
	if after := f.documentCount(t); after != before {
		t.Fatalf("blank create on a used key wrote %d documents", after-before)
	}
}

// A blank seed is always non-empty: the file validator refuses zero bytes, so
// the engine must produce a real first version, never an empty file.
func TestBlankSeedIsNeverEmpty(t *testing.T) {
	for _, format := range []office.Format{office.FormatMD, office.FormatHTML, office.FormatXLSX} {
		seed, filename, ok := blankSeedFor(format, "Tieu de")
		if !ok || len(seed) == 0 || filename == "" {
			t.Fatalf("seed %s = %d bytes, %q, ok=%v", format, len(seed), filename, ok)
		}
	}
	// The XLSX seed is a real SpreadsheetML package (G2-07b), deterministic so
	// the blank job's fingerprint is too.
	if seed := blankXLSXSeed(); files.DetectContentType(seed, "") != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
		!bytes.Equal(seed, blankXLSXSeed()) {
		t.Fatal("the xlsx blank seed is not a stable SpreadsheetML package")
	}
	for _, format := range []office.Format{office.FormatDOCX, office.FormatPPTX, office.FormatPDF, office.FormatXLS, office.FormatODT} {
		if _, _, ok := blankSeedFor(format, "Tieu de"); ok {
			t.Fatalf("unsupported format %s has a blank seed", format)
		}
	}
}

// The blank path must wait for the engine: an accepted/running submit answer
// is not a document yet, and the first version holds whatever bytes the engine
// produced.
func TestDocumentOfficeBlankCreateWaitsForTheEngine(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# seed\n")
	eng := newScriptedEngine()
	eng.fake = f.files.Fake
	entered := make(chan struct{}, 8)
	eng.statusCalls = entered
	svc := f.service(eng)
	before := f.documentCount(t)

	type outcome struct {
		res DocumentFileResult
		err error
	}
	done := make(chan outcome, 1)
	key := util.NewID()
	go func() {
		res, err := svc.CreateBlankFile(ctx, f.actor, f.ws, BlankFileInput{
			Format: string(office.FormatMD), Title: "Trong", IdempotencyKey: key,
		})
		done <- outcome{res, err}
	}()
	// The first status read means the submit is in flight (the scripted engine
	// answers accepted/running); complete it with real bytes, then let the
	// next poll see the terminal state.
	select {
	case <-entered:
	case <-time.After(20 * time.Second):
		t.Fatal("blank create never polled the engine")
	}
	eng.mu.Lock()
	var jobID string
	for id := range eng.jobs {
		jobID = id
	}
	eng.mu.Unlock()
	if jobID == "" {
		t.Fatal("no engine job was submitted")
	}
	eng.finish(t, jobID, []byte("# Trong\n"), "text/markdown; charset=utf-8")
	var created DocumentFileResult
	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("blank create: %v", out.err)
		}
		if out.res.Document.Title != "Trong" || out.res.Document.Kind != DocumentKindFile {
			t.Fatalf("blank document = %+v", out.res.Document)
		}
		created = out.res
	case <-time.After(20 * time.Second):
		t.Fatal("blank create did not settle after the engine completed")
	}
	if after := f.documentCount(t); after != before+1 {
		t.Fatalf("blank create wrote %d documents, want 1", after-before)
	}
	// The first version carries the engine that produced its bytes.
	want := officeEngineInfo()
	if v := created.Version; v.EngineName.String != want.Name || v.EngineVersion.String != want.Version ||
		v.ContractVersion.String != want.ContractVersion || v.ProtocolVersion.String != want.ProtocolVersion {
		t.Fatalf("blank version provenance = %+v", v)
	}
	// A retried key answers the same document without a second engine run;
	// the same key with another title is a payload mismatch.
	again, err := svc.CreateBlankFile(ctx, f.actor, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Trong", IdempotencyKey: key})
	if err != nil || again.Document.ID != created.Document.ID {
		t.Fatalf("blank replay: %+v %v", again.Document, err)
	}
	if _, err := svc.CreateBlankFile(ctx, f.actor, f.ws, BlankFileInput{Format: string(office.FormatMD), Title: "Khac", IdempotencyKey: key}); err == nil {
		t.Fatal("blank replay with another title was accepted")
	}
	if _, err := svc.CreateBlankFile(ctx, f.actor, f.ws, BlankFileInput{Format: string(office.FormatHTML), Title: "Trong", IdempotencyKey: key}); err == nil {
		t.Fatal("blank replay with another format was accepted")
	}
	eng.mu.Lock()
	submitted := len(eng.jobs)
	eng.mu.Unlock()
	if submitted != 1 {
		t.Fatalf("blank replay ran the engine again: %d jobs", submitted)
	}
	if after := f.documentCount(t); after != before+1 {
		t.Fatalf("blank replay wrote %d documents, want 1", after-before)
	}
}

// One format's storage spellings: markdown is the only format with two (a
// nameless provider text output sniffs as text/plain); the drift rule must
// never widen across formats.
func TestOfficeOutputKeepsFormat(t *testing.T) {
	md := "text/markdown"
	cases := []struct {
		name     string
		job      office.Format
		current  string
		incoming string
		want     bool
	}{
		{"md keeps its text output", office.FormatMD, md, "text/plain; charset=utf-8", true},
		{"md accepts the named spelling", office.FormatMD, "text/plain", md, true},
		{"md never accepts html", office.FormatMD, md, "text/html", false},
		{"pdf keeps only pdf", office.FormatPDF, "application/pdf", "application/pdf", true},
		{"pdf does not accept markdown", office.FormatPDF, "application/pdf", md, false},
		{"html keeps only html", office.FormatHTML, "text/html", "text/plain", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := officeOutputKeepsFormat(string(c.job), c.current, c.incoming); got != c.want {
				t.Fatalf("officeOutputKeepsFormat(%s, %q, %q) = %v, want %v", c.job, c.current, c.incoming, got, c.want)
			}
		})
	}
}

// TestValidateOfficeJobEdits is the per-op-kind table: the bound vocabulary
// (set_cell, clear_cell, set_cells) accepts real payloads and refuses unknown
// op names, malformed targets and malformed attributes/styles before a job
// row exists. The loop-level count and marshalled-size bounds are unchanged.
func TestValidateOfficeJobEdits(t *testing.T) {
	target := json.RawMessage(`{"sheet":"Data","cell":"B2"}`)
	edit := func(op string, mutate func(*office.EditOp)) office.EditOp {
		out := office.EditOp{Op: op, Target: target}
		if mutate != nil {
			mutate(&out)
		}
		return out
	}
	overText := strings.Repeat("a", maxOfficeEditTextLen+1)
	bigStyle := json.RawMessage(`{"padding":"` + strings.Repeat("x", 5_000) + `"}`)
	filterValues := make([]string, maxOfficeFilterValues+1)
	for i := range filterValues {
		filterValues[i] = `"v"`
	}
	overValues := "[" + strings.Join(filterValues, ",") + "]"
	filterHidden := make([]string, maxOfficeFilterHiddenRow+1)
	for i := range filterHidden {
		filterHidden[i] = "0"
	}
	overHidden := "[" + strings.Join(filterHidden, ",") + "]"
	bigEdits := make([]office.EditOp, 2_000)
	for i := range bigEdits {
		bigEdits[i] = edit("set_cell", func(e *office.EditOp) { e.Style = bigStyle })
	}
	if raw, err := json.Marshal(bigEdits); err != nil || len(raw) <= maxOfficeEditsSize {
		t.Fatalf("size fixture does not exceed the bound: %d bytes, %v", len(raw), err)
	}
	tooMany := make([]office.EditOp, maxOfficeEditOps+1)
	for i := range tooMany {
		tooMany[i] = edit("clear_cell", nil)
	}

	cases := []struct {
		name      string
		operation office.Operation
		edits     []office.EditOp
		valid     bool
	}{
		{"set_cell text", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Text = "hello" })}, true},
		{"set_cell attributes value", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"value":100}`) })}, true},
		{"set_cell formula", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"formula":"=SUM(A1:A3)"}`) })}, true},
		{"set_cell row/column", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","row":0,"column":25}`), Text: "x"}}, true},
		{"set_cell style only", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Style = json.RawMessage(`{"bold":true}`) })}, true},
		{"set_cell styleReset without style", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"styleReset":false}`) })}, true},
		{"set_cell attributes style", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"style":{"bold":true}}`) })}, true},
		{"clear_cell", office.OperationEdit, []office.EditOp{edit("clear_cell", nil)}, true},
		// set_cells reads its target only for the sheet (parseRange); the
		// fixture the engine grammar accepts is sheet-only.
		{"set_cells sheet-only target with A1 range", office.OperationEdit, []office.EditOp{{Op: "set_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:B2"`), Text: "x"}}, true},
		{"set_cells bounds range", office.OperationEdit, []office.EditOp{{Op: "set_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`{"startRow":0,"startColumn":0,"endRow":1,"endColumn":1}`), Attributes: json.RawMessage(`{"value":0}`)}}, true},
		{"set_cells ignores a target cell address", office.OperationEdit, []office.EditOp{{Op: "set_cells", Target: json.RawMessage(`{"sheet":"S","cell":"XFE99999"}`), Range: json.RawMessage(`"A1:B2"`), Text: "x"}}, true},
		// Row/column structure (B1): fields ride attributes; target needs only
		// the sheet ref, positions are 0-based on the op's own axis.
		{"insert_rows", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":0,"count":1}`) })}, true},
		{"remove_rows at the last row", office.OperationEdit, []office.EditOp{edit("remove_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":1048575,"count":1}`) })}, true},
		{"insert_cols at the last column", office.OperationEdit, []office.EditOp{edit("insert_cols", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":16383,"count":1}`) })}, true},
		{"remove_cols sheet-only target", office.OperationEdit, []office.EditOp{{Op: "remove_cols", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"index":5,"count":2}`)}}, true},
		{"set_row_size points", office.OperationEdit, []office.EditOp{edit("set_row_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":1,"end":4,"size":30}`) })}, true},
		{"set_col_size reset to default", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":2,"size":null}`) })}, true},
		{"set_rows_hidden", office.OperationEdit, []office.EditOp{edit("set_rows_hidden", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":2,"end":2,"hidden":true}`) })}, true},
		{"set_cols_hidden false", office.OperationEdit, []office.EditOp{edit("set_cols_hidden", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"hidden":false}`) })}, true},
		{"set_rows_outline with collapsed", office.OperationEdit, []office.EditOp{edit("set_rows_outline", func(e *office.EditOp) {
			e.Attributes = json.RawMessage(`{"start":1,"end":3,"level":2,"collapsed":false}`)
		})}, true},
		{"set_cols_outline level 0", office.OperationEdit, []office.EditOp{edit("set_cols_outline", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"level":0}`) })}, true},
		// Merges (B2): the rectangle rides the envelope's own range field; the
		// target only needs the sheet ref (a cell address there is ignored).
		{"merge_cells A1 range", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:B2"`)}}, true},
		{"unmerge_cells bounds range", office.OperationEdit, []office.EditOp{{Op: "unmerge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}`)}}, true},
		{"merge_cells ignores a target cell address", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S","cell":"XFE99999"}`), Range: json.RawMessage(`"A1:B2"`)}}, true},
		{"merge_cells at the last cell", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"XFD1048575:XFD1048576"`)}}, true},
		// Filters (B4): the declarative snapshot rides attributes; the target
		// only needs the sheet ref.
		{"set_filter value and custom criteria", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":3,"endColumn":1},"columns":[{"colId":0,"values":["alpha","beta"]},{"colId":1,"customs":{"and":true,"filters":[{"val":"x","operator":"notEqual"},{"val":5,"operator":"greaterThanOrEqual"}]}}]},"hiddenRows":[2,3],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":3,"endColumn":1}}`)}}, true},
		{"set_filter blank-only column and no criteria", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":1,"startColumn":2,"endRow":4,"endColumn":2},"columns":[{"colId":0,"blank":true}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":4,"endColumn":2}}`)}}, true},
		{"clear_filter visibility range", office.OperationEdit, []office.EditOp{{Op: "clear_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"visibilityRange":{"startRow":0,"startColumn":0,"endRow":9,"endColumn":3}}`)}}, true},
		{"set_filter custom value without operator", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":1,"endColumn":0},"columns":[{"colId":0,"customs":{"filters":[{"val":"text"}]}}]},"hiddenRows":[1],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":1,"endColumn":0}}`)}}, true},
		// Page setup (C2): the declarative page-layout snapshot rides attributes.
		{"set_page_setup orientation and print area", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"orientation":"landscape","printArea":"A1:C10"}`)}}, true},
		{"set_page_setup fit to page and margins", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"fitToPage":true,"fitToWidth":1,"fitToHeight":0,"margins":"narrow","paperSize":9,"scale":75}`)}}, true},
		{"set_page_setup titles, breaks and frozen panes", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printTitles":"1:2","rowBreaks":[1,5],"colBreaks":[2],"frozenRows":1,"frozenColumns":0,"printGridlines":true,"printHeadings":false}`)}}, true},
		{"set_page_setup clears print area and titles with null", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printArea":null,"printTitles":null}`)}}, true},
		{"set_page_setup single field", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"orientation":"portrait"}`)}}, true},
		// Sheet management (B3): shape-only rows (the live sheet set, name
		// uniqueness and the last-sheet rule live with the engine).
		{"add_sheet name", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"Scratch"}`)}}, true},
		{"add_sheet name with index", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"Scratch","index":0}`)}}, true},
		{"add_sheet empty target object", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Target: json.RawMessage(`{}`), Attributes: json.RawMessage(`{"name":"Scratch"}`)}}, true},
		{"duplicate_sheet name", office.OperationEdit, []office.EditOp{{Op: "duplicate_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"name":"S copy","index":1}`)}}, true},
		{"rename_sheet newName", office.OperationEdit, []office.EditOp{{Op: "rename_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"newName":"Ngân sách"}`)}}, true},
		{"rename_sheet 31 characters", office.OperationEdit, []office.EditOp{{Op: "rename_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"newName":"` + strings.Repeat("a", 31) + `"}`)}}, true},
		{"remove_sheet target only", office.OperationEdit, []office.EditOp{{Op: "remove_sheet", Target: json.RawMessage(`{"sheet":"S"}`)}}, true},
		{"reorder_sheet index", office.OperationEdit, []office.EditOp{{Op: "reorder_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"index":2}`)}}, true},
		{"set_sheet_hidden true", office.OperationEdit, []office.EditOp{{Op: "set_sheet_hidden", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"hidden":true}`)}}, true},
		{"set_sheet_hidden false", office.OperationEdit, []office.EditOp{{Op: "set_sheet_hidden", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"hidden":false}`)}}, true},
		{"serialize without edits", office.OperationSerialize, nil, true},

		{"unknown op", office.OperationEdit, []office.EditOp{edit("drop_sheet", func(e *office.EditOp) { e.Text = "x" })}, false},
		{"op with surrounding space", office.OperationEdit, []office.EditOp{edit(" set_cell", func(e *office.EditOp) { e.Text = "x" })}, false},
		{"empty op", office.OperationEdit, []office.EditOp{edit("", func(e *office.EditOp) { e.Text = "x" })}, false},
		{"set_cell missing target", office.OperationEdit, []office.EditOp{{Op: "set_cell", Text: "x"}}, false},
		{"set_cell target without sheet", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"cell":"A1"}`), Text: "x"}}, false},
		{"set_cell sheet empty", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"","cell":"A1"}`), Text: "x"}}, false},
		{"set_cell cell outside grid", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","cell":"XFE1"}`), Text: "x"}}, false},
		{"set_cell row outside grid", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","row":1048576,"column":0}`), Text: "x"}}, false},
		{"set_cell row not an integer", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","row":0.5,"column":0}`), Text: "x"}}, false},
		{"set_cell row not a number", office.OperationEdit, []office.EditOp{{Op: "set_cell", Target: json.RawMessage(`{"sheet":"Data","row":"0","column":0}`), Text: "x"}}, false},
		{"set_cell without content or style", office.OperationEdit, []office.EditOp{edit("set_cell", nil)}, false},
		{"set_cell malformed formula", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"formula":"SUM(A1:A2)"}`) })}, false},
		{"set_cell non-scalar value", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"value":{"a":1}}`) })}, false},
		{"set_cell style not an object", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Style = json.RawMessage(`"bold"`) })}, false},
		{"set_cell styleReset not a boolean", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Text = "x"; e.Attributes = json.RawMessage(`{"styleReset":1}`) })}, false},
		{"set_cell attributes not an object", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Text = "x"; e.Attributes = json.RawMessage(`[1]`) })}, false},
		{"set_cell text over the bound", office.OperationEdit, []office.EditOp{edit("set_cell", func(e *office.EditOp) { e.Text = overText })}, false},
		{"clear_cell missing target", office.OperationEdit, []office.EditOp{{Op: "clear_cell"}}, false},
		{"set_cells missing range", office.OperationEdit, []office.EditOp{edit("set_cells", func(e *office.EditOp) { e.Text = "x" })}, false},
		{"set_cells malformed range", office.OperationEdit, []office.EditOp{edit("set_cells", func(e *office.EditOp) { e.Range = json.RawMessage(`"A1"`); e.Text = "x" })}, false},
		{"set_cells reversed range", office.OperationEdit, []office.EditOp{edit("set_cells", func(e *office.EditOp) { e.Range = json.RawMessage(`"B2:A1"`); e.Text = "x" })}, false},
		{"set_cells over the op budget", office.OperationEdit, []office.EditOp{edit("set_cells", func(e *office.EditOp) { e.Range = json.RawMessage(`"A1:Z1000"`); e.Text = "x" })}, false},
		{"set_cells without content", office.OperationEdit, []office.EditOp{edit("set_cells", func(e *office.EditOp) { e.Range = json.RawMessage(`"A1:B2"`) })}, false},
		{"insert_rows without attributes", office.OperationEdit, []office.EditOp{edit("insert_rows", nil)}, false},
		{"insert_rows attributes not an object", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`[0,1]`) })}, false},
		{"insert_rows negative index", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":-1,"count":1}`) })}, false},
		{"insert_rows zero count", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":0,"count":0}`) })}, false},
		{"insert_rows fractional count", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":0,"count":1.5}`) })}, false},
		{"insert_rows index outside the grid", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":1048576,"count":1}`) })}, false},
		{"insert_rows count overflows the grid", office.OperationEdit, []office.EditOp{edit("insert_rows", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":1048575,"count":2}`) })}, false},
		{"insert_cols count overflows the grid", office.OperationEdit, []office.EditOp{edit("insert_cols", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"index":16383,"count":2}`) })}, false},
		{"insert_rows missing target sheet", office.OperationEdit, []office.EditOp{{Op: "insert_rows", Target: json.RawMessage(`{"cell":"A1"}`), Attributes: json.RawMessage(`{"index":0,"count":1}`)}}, false},
		{"set_row_size reversed span", office.OperationEdit, []office.EditOp{edit("set_row_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":5,"end":2,"size":10}`) })}, false},
		{"set_row_size end outside the grid", office.OperationEdit, []office.EditOp{edit("set_row_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":1048576,"size":10}`) })}, false},
		{"set_row_size over the span ceiling", office.OperationEdit, []office.EditOp{edit("set_row_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":100000,"size":10}`) })}, false},
		{"set_col_size zero size", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"size":0}`) })}, false},
		{"set_col_size negative size", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"size":-5}`) })}, false},
		{"set_col_size size over the bound", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"size":501}`) })}, false},
		{"set_col_size size not a number", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"size":"10"}`) })}, false},
		{"set_col_size missing size", office.OperationEdit, []office.EditOp{edit("set_col_size", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0}`) })}, false},
		{"set_rows_hidden not a boolean", office.OperationEdit, []office.EditOp{edit("set_rows_hidden", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"hidden":1}`) })}, false},
		{"set_rows_outline level over 7", office.OperationEdit, []office.EditOp{edit("set_rows_outline", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"level":8}`) })}, false},
		{"set_rows_outline negative level", office.OperationEdit, []office.EditOp{edit("set_rows_outline", func(e *office.EditOp) { e.Attributes = json.RawMessage(`{"start":0,"end":0,"level":-1}`) })}, false},
		{"set_rows_outline collapsed not a boolean", office.OperationEdit, []office.EditOp{edit("set_rows_outline", func(e *office.EditOp) {
			e.Attributes = json.RawMessage(`{"start":0,"end":0,"level":1,"collapsed":"yes"}`)
		})}, false},
		{"merge_cells missing range", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`)}}, false},
		{"merge_cells malformed range", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1"`)}}, false},
		{"merge_cells three-part range", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:B2:C3"`)}}, false},
		{"merge_cells reversed range", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"B2:A1"`)}}, false},
		{"merge_cells single cell", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:A1"`)}}, false},
		{"unmerge_cells single cell bounds", office.OperationEdit, []office.EditOp{{Op: "unmerge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`{"startRow":3,"startColumn":3,"endRow":3,"endColumn":3}`)}}, false},
		{"merge_cells range outside the grid", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:XFE1"`)}}, false},
		{"merge_cells bounds outside the grid", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`{"startRow":0,"startColumn":0,"endRow":0,"endColumn":16384}`)}}, false},
		{"merge_cells over the span ceiling", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`"A1:A100001"`)}}, false},
		{"merge_cells fractional bounds", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"sheet":"S"}`), Range: json.RawMessage(`{"startRow":0,"startColumn":0,"endRow":1.5,"endColumn":1}`)}}, false},
		{"merge_cells missing target sheet", office.OperationEdit, []office.EditOp{{Op: "merge_cells", Target: json.RawMessage(`{"cell":"A1"}`), Range: json.RawMessage(`"A1:B2"`)}}, false},
		// Filter (B4) refusals.
		{"set_filter missing attributes", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`)}}, false},
		{"set_filter missing filter", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":1,"endColumn":0}}`)}}, false},
		{"set_filter header-only range", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":0,"endColumn":1},"columns":[]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":0,"endColumn":1}}`)}}, false},
		{"set_filter column outside the range", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":1},"columns":[{"colId":2,"blank":true}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":1}}`)}}, false},
		{"set_filter duplicate column", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":1},"columns":[{"colId":0,"blank":true},{"colId":0,"values":["x"]}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":1}}`)}}, false},
		{"set_filter column without criteria", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter non-string value", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"values":[7]}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter null values", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"values":null}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter over the value count", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"values":` + overValues + `}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter three custom conditions", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"customs":{"filters":[{"val":"a"},{"val":"b"},{"val":"c"}]}}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter unknown operator", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"customs":{"filters":[{"val":"a","operator":"contains"}]}}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter null custom value", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"customs":{"filters":[{"val":null}]}}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter non-boolean join", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[{"colId":0,"customs":{"and":1,"filters":[{"val":"a"}]}}]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter hidden row outside the grid", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[]},"hiddenRows":[1048576],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter over the hidden-row count", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[]},"hiddenRows":` + overHidden + `,"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"set_filter reversed visibility range", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[]},"hiddenRows":[],"visibilityRange":{"startRow":2,"startColumn":0,"endRow":0,"endColumn":0}}`)}}, false},
		{"set_filter missing visibility range", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[]},"hiddenRows":[]}`)}}, false},
		{"set_filter over the span ceiling", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":100000,"endColumn":0},"columns":[]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":100000,"endColumn":0}}`)}}, false},
		{"set_filter missing target sheet", office.OperationEdit, []office.EditOp{{Op: "set_filter", Target: json.RawMessage(`{"cell":"A1"}`), Attributes: json.RawMessage(`{"filter":{"range":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0},"columns":[]},"hiddenRows":[],"visibilityRange":{"startRow":0,"startColumn":0,"endRow":2,"endColumn":0}}`)}}, false},
		{"clear_filter missing visibility range", office.OperationEdit, []office.EditOp{{Op: "clear_filter", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{}`)}}, false},
		{"clear_filter missing attributes", office.OperationEdit, []office.EditOp{{Op: "clear_filter", Target: json.RawMessage(`{"sheet":"S"}`)}}, false},
		// Page setup (C2) refusals.
		{"set_page_setup missing attributes", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(``)}}, false},
		{"set_page_setup missing attributes object", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`)}}, false},
		{"set_page_setup empty attributes", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{}`)}}, false},
		{"set_page_setup unknown field", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"orientation":"portrait","foo":1}`)}}, false},
		{"set_page_setup bad orientation", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"orientation":"diagonal"}`)}}, false},
		{"set_page_setup bad margins", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"margins":"huge"}`)}}, false},
		{"set_page_setup paper size over range", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"paperSize":119}`)}}, false},
		{"set_page_setup paper size not an integer", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"paperSize":9.5}`)}}, false},
		{"set_page_setup scale below minimum", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"scale":9}`)}}, false},
		{"set_page_setup scale above maximum", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"scale":401}`)}}, false},
		{"set_page_setup fit width negative", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"fitToWidth":-1}`)}}, false},
		{"set_page_setup fit height over bound", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"fitToHeight":1001}`)}}, false},
		{"set_page_setup fit to page non-boolean", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"fitToPage":1}`)}}, false},
		{"set_page_setup print gridlines non-boolean", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printGridlines":"yes"}`)}}, false},
		{"set_page_setup frozen rows negative", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"frozenRows":-1}`)}}, false},
		{"set_page_setup frozen columns out of grid", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"frozenColumns":16384}`)}}, false},
		{"set_page_setup malformed print area", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printArea":"A1:"}`)}}, false},
		{"set_page_setup print area out of grid", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printArea":"A1:XFE1"}`)}}, false},
		{"set_page_setup print titles malformed", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printTitles":"A1:B2"}`)}}, false},
		{"set_page_setup print titles reversed span", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printTitles":"3:1"}`)}}, false},
		{"set_page_setup print titles non-string", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"printTitles":3}`)}}, false},
		{"set_page_setup row break zero", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"rowBreaks":[0]}`)}}, false},
		{"set_page_setup row break out of grid", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"rowBreaks":[1048576]}`)}}, false},
		{"set_page_setup row breaks not an array", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"rowBreaks":1}`)}}, false},
		{"set_page_setup col break fractional", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"colBreaks":[1.5]}`)}}, false},
		{"set_page_setup missing target sheet", office.OperationEdit, []office.EditOp{{Op: "set_page_setup", Target: json.RawMessage(`{"cell":"A1"}`), Attributes: json.RawMessage(`{"orientation":"portrait"}`)}}, false},
		// Sheet management (B3) refusals.
		{"add_sheet missing name", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{}`)}}, false},
		{"add_sheet empty name", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":""}`)}}, false},
		{"add_sheet name too long", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"` + strings.Repeat("a", 32) + `"}`)}}, false},
		{"add_sheet forbidden character", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"a/b"}`)}}, false},
		{"add_sheet quoted name", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"'q'"}`)}}, false},
		{"add_sheet non-string name", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":7}`)}}, false},
		{"add_sheet missing attributes", office.OperationEdit, []office.EditOp{{Op: "add_sheet"}}, false},
		{"add_sheet with a sheet target", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"name":"Scratch"}`)}}, false},
		{"add_sheet negative index", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"Scratch","index":-1}`)}}, false},
		{"add_sheet fractional index", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"Scratch","index":1.5}`)}}, false},
		{"add_sheet index over the ceiling", office.OperationEdit, []office.EditOp{{Op: "add_sheet", Attributes: json.RawMessage(`{"name":"Scratch","index":10000}`)}}, false},
		{"duplicate_sheet missing name", office.OperationEdit, []office.EditOp{{Op: "duplicate_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"index":1}`)}}, false},
		{"duplicate_sheet missing target", office.OperationEdit, []office.EditOp{{Op: "duplicate_sheet", Attributes: json.RawMessage(`{"name":"Copy"}`)}}, false},
		{"rename_sheet missing newName", office.OperationEdit, []office.EditOp{{Op: "rename_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{}`)}}, false},
		{"rename_sheet malformed newName", office.OperationEdit, []office.EditOp{{Op: "rename_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"newName":"a[b"}`)}}, false},
		{"remove_sheet missing target", office.OperationEdit, []office.EditOp{{Op: "remove_sheet", Attributes: json.RawMessage(`{}`)}}, false},
		{"remove_sheet array attributes", office.OperationEdit, []office.EditOp{{Op: "remove_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`[1]`)}}, false},
		{"reorder_sheet missing index", office.OperationEdit, []office.EditOp{{Op: "reorder_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{}`)}}, false},
		{"reorder_sheet index over the ceiling", office.OperationEdit, []office.EditOp{{Op: "reorder_sheet", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"index":10000}`)}}, false},
		{"set_sheet_hidden missing hidden", office.OperationEdit, []office.EditOp{{Op: "set_sheet_hidden", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{}`)}}, false},
		{"set_sheet_hidden non-boolean", office.OperationEdit, []office.EditOp{{Op: "set_sheet_hidden", Target: json.RawMessage(`{"sheet":"S"}`), Attributes: json.RawMessage(`{"hidden":1}`)}}, false},
		{"set_sheet_hidden missing target sheet", office.OperationEdit, []office.EditOp{{Op: "set_sheet_hidden", Target: json.RawMessage(`{"cell":"A1"}`), Attributes: json.RawMessage(`{"hidden":true}`)}}, false},
		{"edits on a non-edit operation", office.OperationSerialize, []office.EditOp{edit("clear_cell", nil)}, false},
		{"over the op count", office.OperationEdit, tooMany, false},
		{"over the marshalled size", office.OperationEdit, bigEdits, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateOfficeJobEdits(c.operation, c.edits)
			if c.valid && err != nil {
				t.Fatalf("validateOfficeJobEdits = %v, want nil", err)
			}
			if !c.valid && !errors.Is(err, ErrOfficeJobInvalid) {
				t.Fatalf("validateOfficeJobEdits = %v, want office_job_invalid", err)
			}
		})
	}
}
