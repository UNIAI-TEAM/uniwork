package service

import (
	"bytes"
	"context"
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
