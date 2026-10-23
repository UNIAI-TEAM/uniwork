package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeQ7Integration is the Q7 closing test on the real stack:
// the real engine container (convert:xls, convert:odt bound), the real
// FileService on MinIO, the real document ACL. F-LEGACY-XLS and
// F-UNSUPPORTED-ODT each go upload -> capability -> convert -> change list ->
// cancel (nothing created) and -> accept (an OOXML copy with provenance, the
// source and its history unchanged). The oracles are the G0 fixtures' own
// declared content, read independently of the engine. The XLSX blank create
// runs here too: it needs the engine's serialize:xlsx.
//
// Environment: identical to TestDocumentOfficeIntegration.

type q7ResultView struct {
	SourceFormat string `json:"source_format"`
	TargetFormat string `json:"target_format"`
	Fidelity     struct {
		Level string   `json:"level"`
		Lost  []string `json:"lost"`
	} `json:"fidelity"`
	Content struct {
		Sheets     []string          `json:"sheets"`
		Cells      map[string]string `json:"cells"`
		Paragraphs []string          `json:"paragraphs"`
	} `json:"content"`
}

func zipPart(t *testing.T, body []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	t.Fatalf("package has no %s", name)
	return ""
}

// zipAnyPartContains reports whether any part under prefix carries needle
// (a string may sit inline in the sheet or in the shared-string table).
func zipAnyPartContains(t *testing.T, body []byte, prefix, needle string) bool {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	for _, f := range zr.File {
		if len(f.Name) < len(prefix) || f.Name[:len(prefix)] != prefix {
			continue
		}
		if bytes.Contains([]byte(zipPart(t, body, f.Name)), []byte(needle)) {
			return true
		}
	}
	return false
}

func TestDocumentOfficeQ7Integration(t *testing.T) {
	backend, ok := officeMinioBackend()
	if !ok {
		t.Skip("MINIO_* is not set: the engine container PUTs to the presigned URL, so the real-store rows need MinIO")
	}
	e := newOfficeRealEnv(t, backend)
	ctx := context.Background()
	member := human(e.tn.member)

	odtSource := mustReadFixture(t, "legacy/unsupported-sample.odt")
	odtContent := zipPart(t, odtSource, "content.xml")
	odtTitle := regexp.MustCompile(`<text:h[^>]*>([^<]+)</text:h>`).FindStringSubmatch(odtContent)
	odtBody := regexp.MustCompile(`<text:p[^>]*>([^<]+)</text:p>`).FindStringSubmatch(odtContent)
	if odtTitle == nil || odtBody == nil {
		t.Fatal("the ODT fixture has no heading/paragraph oracle")
	}

	cases := []struct {
		id, fixture, filename string
		source, target        office.Format
		sourceMime            string
		oracle                func(t *testing.T, r q7ResultView, copyBytes []byte)
	}{
		{
			id: "F-LEGACY-XLS", fixture: "sheets/legacy-xls.xls", filename: "legacy.xls",
			source: office.FormatXLS, target: office.FormatXLSX, sourceMime: "application/vnd.ms-excel",
			oracle: func(t *testing.T, r q7ResultView, copyBytes []byte) {
				if len(r.Content.Sheets) != 3 || r.Content.Sheets[0] != "Sheet1" || r.Content.Cells["Sheet1!A1"] != "replaceMe" {
					t.Fatalf("xls change list = %+v", r.Content)
				}
				if !zipAnyPartContains(t, copyBytes, "xl/", "replaceMe") {
					t.Fatal("the xlsx copy does not carry Sheet1!A1")
				}
			},
		},
		{
			id: "F-UNSUPPORTED-ODT", fixture: "legacy/unsupported-sample.odt", filename: "unsupported.odt",
			source: office.FormatODT, target: office.FormatDOCX, sourceMime: "application/vnd.oasis.opendocument.text",
			oracle: func(t *testing.T, r q7ResultView, copyBytes []byte) {
				if len(r.Content.Paragraphs) != 2 || r.Content.Paragraphs[0] != odtTitle[1] || r.Content.Paragraphs[1] != odtBody[1] {
					t.Fatalf("odt change list = %+v, want [%q %q]", r.Content.Paragraphs, odtTitle[1], odtBody[1])
				}
				doc := zipPart(t, copyBytes, "word/document.xml")
				if !bytes.Contains([]byte(doc), []byte(odtTitle[1])) || !bytes.Contains([]byte(doc), []byte(odtBody[1])) {
					t.Fatal("the docx copy does not carry the ODT text")
				}
			},
		},
	}

	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			source := mustReadFixture(t, c.fixture)
			created := e.doc(t, c.filename, source)
			srcBefore := e.env.doc(t, created.Document.ID)

			caps, err := e.jobs.Capability(ctx, member, created.Document.ID)
			mustf(t, err, "capability")
			if caps.Format != c.source {
				t.Fatalf("source format = %s", caps.Format)
			}
			convert := capabilityRow(t, caps, "convert")
			if !convert.ProductSupported || convert.TargetFormat != string(c.target) {
				t.Fatalf("convert row = %+v", convert)
			}
			for _, op := range []string{"open", "edit", "serialize"} {
				if capabilityRow(t, caps, op).EngineBound {
					t.Fatalf("%s %s is bound: a legacy source must never open in place", c.id, op)
				}
			}

			start := func() db.OfficeJob {
				row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
					Operation: "convert", TargetFormat: string(c.target), IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
				})
				mustf(t, err, "convert")
				done := e.settle(t, row.ID)
				if done.State != string(office.JobCompleted) {
					t.Fatalf("convert job = %+v", done)
				}
				return done
			}

			// Cancel: the change list was shown, the user declined.
			declined := start()
			docsBefore := e.docCount(t)
			if _, err := e.jobs.CancelOfficeJobForDocument(ctx, member, created.Document.ID, declined.ID); err != nil {
				t.Fatalf("cancel: %v", err)
			}
			if _, err := e.svc.CopyDocument(ctx, member, created.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: declined.ID, IdempotencyKey: util.NewID(),
			}); err == nil {
				t.Fatal("a cancelled conversion was accepted")
			}
			if e.docCount(t) != docsBefore {
				t.Fatal("cancel created a document")
			}

			// Accept.
			job := start()
			var result q7ResultView
			if err := json.Unmarshal(job.Result, &result); err != nil {
				t.Fatalf("stored result: %v", err)
			}
			if result.SourceFormat != string(c.source) || result.TargetFormat != string(c.target) ||
				result.Fidelity.Level != "limited" || len(result.Fidelity.Lost) == 0 {
				t.Fatalf("result = %+v", result)
			}
			copied, err := e.svc.CopyDocument(ctx, member, created.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: job.ID, IdempotencyKey: util.NewID(),
			})
			mustf(t, err, "accept")
			d := copied.Document
			if d.SourceDocumentID.String != created.Document.ID || d.SourceVersionID.String != created.Version.ID ||
				d.SourceChecksumSha256.String != sha(source) || d.SourceFormat.String != c.sourceMime ||
				d.ConversionReason.String != "convert" || d.SourceEngine.String != office.TrustedEngineVersion {
				t.Fatalf("%s provenance = %+v", c.id, d)
			}
			copyBytes := e.env.read(t, member, d.ID, 0, DocumentByteRange{})
			c.oracle(t, result, copyBytes)
			// The copy is an ordinary OOXML document of the target format.
			e.assertFormatResolves(t, d.ID, c.target)

			// Source and history unchanged.
			srcAfter := e.env.doc(t, created.Document.ID)
			if srcAfter.Revision != srcBefore.Revision || srcAfter.FileVersionID != srcBefore.FileVersionID || e.versionCount(t, created.Document.ID) != 1 {
				t.Fatalf("source changed: before %+v after %+v", srcBefore, srcAfter)
			}
			if got := e.env.read(t, member, created.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(got, source) {
				t.Fatal("source bytes changed")
			}
			// A second member cannot accept it and learns nothing new.
			if _, err := e.svc.CopyDocument(ctx, human(e.tn.bMember), created.Document.ID, CopyDocumentInput{
				Consent: "copy", JobID: job.ID, IdempotencyKey: util.NewID(),
			}); err == nil {
				t.Fatal("a workspace-B member accepted the conversion")
			}
		})
	}

	t.Run("F-LEGACY-XLS converted copy opens as xlsx", func(t *testing.T) {
		created := e.doc(t, "legacy-edit.xls", mustReadFixture(t, "sheets/legacy-xls.xls"))
		row, err := e.jobs.StartOfficeJobForDocument(ctx, member, created.Document.ID, OfficeJobRequest{
			Operation: "convert", TargetFormat: "xlsx", IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		mustf(t, err, "convert")
		job := e.settle(t, row.ID)
		copied, err := e.svc.CopyDocument(ctx, member, created.Document.ID, CopyDocumentInput{Consent: "copy", JobID: job.ID, IdempotencyKey: util.NewID()})
		mustf(t, err, "accept")
		open, err := e.jobs.StartOfficeJobForDocument(ctx, member, copied.Document.ID, OfficeJobRequest{
			Operation: "open", IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		mustf(t, err, "open copy")
		if done := e.settle(t, open.ID); done.State != string(office.JobCompleted) {
			t.Fatalf("open converted copy = %+v", done)
		}
	})

	t.Run("create-blank xlsx: engine-made workbook, reopens", func(t *testing.T) {
		res, err := e.jobs.CreateBlankFile(ctx, member, e.tn.wsA, BlankFileInput{Format: "xlsx", Title: "Bang tinh moi", IdempotencyKey: util.NewID()})
		mustf(t, err, "blank xlsx")
		if res.Version.EngineVersion.String != office.TrustedEngineVersion {
			t.Fatalf("blank xlsx version = %+v", res.Version)
		}
		body := e.env.read(t, member, res.Document.ID, 0, DocumentByteRange{})
		if !bytes.Contains([]byte(zipPart(t, body, "xl/workbook.xml")), []byte("Sheet1")) {
			t.Fatal("blank xlsx has no Sheet1")
		}
		caps, err := e.jobs.Capability(ctx, member, res.Document.ID)
		mustf(t, err, "capability")
		if blank := capabilityRow(t, caps, officeBlankOperation); !blank.ProductSupported {
			t.Fatalf("create_blank row on xlsx = %+v", blank)
		}
		open, err := e.jobs.StartOfficeJobForDocument(ctx, member, res.Document.ID, OfficeJobRequest{
			Operation: "open", IdempotencyKey: util.NewID(), Deadline: 60 * time.Second,
		})
		mustf(t, err, "open blank")
		if done := e.settle(t, open.ID); done.State != string(office.JobCompleted) {
			t.Fatalf("open blank xlsx = %+v", done)
		}
	})
}

func (e *officeRealEnv) docCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.env.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM documents WHERE workspace_id = $1`, e.tn.wsA).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
