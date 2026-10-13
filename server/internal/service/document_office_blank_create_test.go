package service

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// blankFormatCase is one format of the blank create route: the extension the
// document gets, the mime type its first version is stored with, the seed
// bytes it starts from, and whether the engine serializes them.
type blankFormatCase struct {
	format    office.Format
	ext       string
	mime      string
	seed      func() []byte
	viaEngine bool
}

var blankCreateCases = []blankFormatCase{
	{office.FormatDOCX, ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", blankDOCXSeed, false},
	{office.FormatPPTX, ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", blankPPTXSeed, false},
	{office.FormatPDF, ".pdf", "application/pdf", blankPDFSeed, true},
	{office.FormatXLSX, ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", blankXLSXSeed, true},
}

// createBlank runs CreateBlankFile; for an engine format it plays the engine
// completing the serialize job with the seed bytes, as the real one does.
func createBlank(t *testing.T, f *officeFixture, svc *DocumentOfficeService, eng *scriptedEngine, c blankFormatCase, in BlankFileInput) DocumentFileResult {
	t.Helper()
	type outcome struct {
		res DocumentFileResult
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := svc.CreateBlankFile(context.Background(), f.actor, f.ws, in)
		done <- outcome{res, err}
	}()
	if c.viaEngine {
		deadline := time.Now().Add(20 * time.Second)
		for {
			eng.mu.Lock()
			var jobID string
			for id, j := range eng.jobs {
				if j.state == office.JobRunning {
					jobID = id
				}
			}
			eng.mu.Unlock()
			if jobID != "" {
				eng.finish(t, jobID, c.seed(), c.mime)
				break
			}
			select {
			case out := <-done:
				t.Fatalf("%s blank create settled before the engine ran: %+v", c.format, out.err)
			case <-time.After(20 * time.Millisecond):
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s blank create never submitted an engine job", c.format)
			}
		}
	}
	select {
	case out := <-done:
		if out.err != nil {
			t.Fatalf("%s blank create: %v", c.format, out.err)
		}
		return out.res
	case <-time.After(20 * time.Second):
		t.Fatalf("%s blank create did not settle", c.format)
	}
	return DocumentFileResult{}
}

func (f *officeFixture) readVersion(t *testing.T, res DocumentFileResult) []byte {
	t.Helper()
	r, err := f.files.Open(context.Background(), files.OpenInput{
		Scope: files.Scope{OrganizationID: f.org, WorkspaceID: f.ws}, FileID: files.FileID(res.File.FileID),
	})
	if err != nil {
		t.Fatalf("open first version: %v", err)
	}
	defer func() { _ = r.Close() }()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatalf("read first version: %v", err)
	}
	return body
}

// Every blank format creates one file document with the right title,
// extension and mime type, whose first version holds the deterministic seed;
// the formats the engine does not serialize (docx, pptx) never start a job.
func TestDocumentOfficeBlankCreatesEveryFormat(t *testing.T) {
	f := newOfficeFixture(t, "# seed\n")
	eng := newScriptedEngine()
	eng.fake = f.files.Fake
	svc := f.service(eng)
	for _, c := range blankCreateCases {
		before := f.documentCount(t)
		jobsBefore := len(eng.jobs)
		title := "Chưa đặt tên" + c.ext
		res := createBlank(t, f, svc, eng, c, BlankFileInput{Format: string(c.format), Title: title, IdempotencyKey: util.NewID()})
		if res.Document.Kind != DocumentKindFile || res.Document.Title != title {
			t.Fatalf("%s document = %+v", c.format, res.Document)
		}
		if !strings.EqualFold(res.File.Filename[strings.LastIndex(res.File.Filename, "."):], c.ext) {
			t.Fatalf("%s filename = %q, want extension %s", c.format, res.File.Filename, c.ext)
		}
		if res.File.MimeType != c.mime || res.Version.MimeType.String != c.mime {
			t.Fatalf("%s mime = %q / %q, want %q", c.format, res.File.MimeType, res.Version.MimeType.String, c.mime)
		}
		if !bytes.Equal(f.readVersion(t, res), c.seed()) {
			t.Fatalf("%s first version is not the seed", c.format)
		}
		// The document resolves back to its format like any file document.
		if got, err := f.service(eng).formatForVersion(context.Background(), res.Document, nil); err != nil || got != c.format {
			t.Fatalf("%s resolves to %q, %v", c.format, got, err)
		}
		if after := f.documentCount(t); after != before+1 {
			t.Fatalf("%s blank create wrote %d documents, want 1", c.format, after-before)
		}
		eng.mu.Lock()
		ran := len(eng.jobs) - jobsBefore
		eng.mu.Unlock()
		if want := map[bool]int{true: 1, false: 0}[c.viaEngine]; ran != want {
			t.Fatalf("%s blank create ran %d engine jobs, want %d", c.format, ran, want)
		}
	}
}

// The seed formats need no engine at all; the replay of a key answers the same
// document without storing a second one, and another title or format under the
// key is a payload mismatch.
func TestDocumentOfficeBlankSeedFormatsReplay(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "# seed\n")
	svc := f.service(nil)
	for _, c := range blankCreateCases {
		if c.viaEngine {
			continue
		}
		key := util.NewID()
		in := BlankFileInput{Format: string(c.format), Title: "Trống" + c.ext, IdempotencyKey: key}
		first, err := svc.CreateBlankFile(ctx, f.actor, f.ws, in)
		if err != nil {
			t.Fatalf("%s blank create without an engine: %v", c.format, err)
		}
		before := f.documentCount(t)
		again, err := svc.CreateBlankFile(ctx, f.actor, f.ws, in)
		if err != nil || again.Document.ID != first.Document.ID {
			t.Fatalf("%s replay: %+v %v", c.format, again.Document, err)
		}
		if after := f.documentCount(t); after != before {
			t.Fatalf("%s replay stored %d documents", c.format, after-before)
		}
		other := in
		other.Title = "Khác" + c.ext
		if _, err := svc.CreateBlankFile(ctx, f.actor, f.ws, other); err == nil {
			t.Fatalf("%s replay with another title was accepted", c.format)
		}
		other = in
		other.Format = string(office.FormatDOCX)
		if c.format == office.FormatDOCX {
			other.Format = string(office.FormatPPTX)
		}
		if _, err := svc.CreateBlankFile(ctx, f.actor, f.ws, other); err == nil {
			t.Fatalf("%s replay with another format was accepted", c.format)
		}
	}
}

// The create_blank capability row is supported for all six formats.
func TestBlankSupportedCoversTheSixFormats(t *testing.T) {
	eng := newScriptedEngine()
	for _, format := range []office.Format{office.FormatMD, office.FormatHTML, office.FormatXLSX, office.FormatDOCX, office.FormatPPTX, office.FormatPDF} {
		res, err := eng.Capability(context.Background(), format)
		if err != nil {
			t.Fatal(err)
		}
		if ok, reason := blankSupported(format, res); !ok || reason == "" {
			t.Fatalf("%s create_blank = %v %q", format, ok, reason)
		}
	}
	res, _ := eng.Capability(context.Background(), office.FormatXLS)
	for _, format := range []office.Format{office.FormatXLS, office.FormatODT} {
		if ok, reason := blankSupported(format, res); ok || reason == "" {
			t.Fatalf("%s create_blank = %v %q", format, ok, reason)
		}
	}
}
