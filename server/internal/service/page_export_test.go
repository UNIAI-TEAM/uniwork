package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ExportPage (UNI-2004) against the scripted engine and the test database:
// a UniNote page exports through an ordinary office job - operation export,
// format page - whose input is the page's sanitized JSON, title and images,
// and answers the staged DOCX or PDF the way ExportFramePDF does.

// pageExportEngine binds export and plays the engine: it keeps each job's
// input and target, and completes the job with a DOCX or a PDF fixture.
type pageExportEngine struct {
	*scriptedEngine
	mu      sync.Mutex
	inputs  map[string][]byte
	targets map[string]string
}

func newPageExportEngine(t *testing.T) *pageExportEngine {
	t.Helper()
	e := &pageExportEngine{scriptedEngine: newScriptedEngine(), inputs: map[string][]byte{}, targets: map[string]string{}}
	e.bound = map[office.Operation]bool{office.OperationExport: true}
	e.submitHook = func(env office.Envelope, in office.InputSource) error {
		rc, err := in.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		raw, err := io.ReadAll(rc)
		if err != nil {
			return err
		}
		var payload struct {
			TargetFormat string `json:"target_format"`
		}
		_ = json.Unmarshal(env.Payload, &payload)
		e.mu.Lock()
		e.inputs[env.RequestID], e.targets[env.RequestID] = raw, payload.TargetFormat
		e.mu.Unlock()
		return nil
	}
	docx, pdf := mustReadFixture(t, "docs/docx-kitchen-sink.docx"), exportedPDF(t)
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
			e.scriptedEngine.mu.Lock()
			var pending []string
			for id, j := range e.jobs {
				if j.state == office.JobRunning && !done[id] {
					pending = append(pending, id)
				}
			}
			e.scriptedEngine.mu.Unlock()
			for _, id := range pending {
				done[id] = true
				e.mu.Lock()
				target := e.targets[id]
				e.mu.Unlock()
				if target == "pdf" {
					e.finish(t, id, pdf, "application/pdf")
				} else {
					e.finish(t, id, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
				}
			}
		}
	}()
	t.Cleanup(func() { close(stop); wg.Wait() })
	return e
}

// pageExportInputOf decodes the JSON the engine received.
type pageExportInputOf struct {
	Title   string          `json:"title"`
	Content json.RawMessage `json:"content"`
	Images  map[string]struct {
		Mime   string `json:"mime"`
		Data   string `json:"data"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	} `json:"images"`
}

func TestPageExport(t *testing.T) {
	ctx := context.Background()
	prev := officeExportPoll
	officeExportPoll = 10 * time.Millisecond
	t.Cleanup(func() { officeExportPoll = prev })

	// seedPage creates a workspace page with Vietnamese text and one image.
	seedPage := func(t *testing.T, f *officeFixture) (string, string, []byte) {
		t.Helper()
		page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Biên bản họp", Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatalf("create page: %v", err)
		}
		img := pngBody(t, 12, 7)
		asset, err := f.docs.UploadDocumentAsset(ctx, f.actor, page.Document.ID, DocumentUploadInput{Filename: "so-do.png", Body: bytes.NewReader(img)})
		if err != nil {
			t.Fatalf("asset: %v", err)
		}
		content := fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đã chốt ngân sách"},`+
			`{"type":"image","attrs":{"src":"asset://%s","alt":"Sơ đồ","onclick":"x"}}]}]}`, asset.ID)
		if _, err := f.docs.UpdateDocument(ctx, f.actor, page.Document.ID, UpdateDocumentInput{Revision: page.Document.Revision, Content: json.RawMessage(content)}); err != nil {
			t.Fatalf("update page: %v", err)
		}
		return page.Document.ID, asset.ID, img
	}

	t.Run("docx: an export job on the page's JSON, title and images, logged as an export", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		pageID, assetID, img := seedPage(t, f)
		eng := newPageExportEngine(t)
		reader := human(f.tn.member)
		out, err := f.service(eng).ExportPage(ctx, reader, pageID, "docx")
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		if got := readExport(t, out); !bytes.Equal(got, mustReadFixture(t, "docs/docx-kitchen-sink.docx")) {
			t.Fatalf("docx = %d bytes", len(got))
		}
		row := out.Job
		if row.Operation != "export" || row.Format != "page" || row.TargetFormat.String != "docx" || row.State != "completed" || row.DocumentID != pageID {
			t.Fatalf("job = %+v", row)
		}
		var in pageExportInputOf
		if err := json.Unmarshal(eng.inputs[row.ID], &in); err != nil {
			t.Fatalf("engine input: %v", err)
		}
		if in.Title != "Biên bản họp" || !bytes.Contains(in.Content, []byte("Đã chốt ngân sách")) || bytes.Contains(in.Content, []byte("onclick")) {
			t.Fatalf("input = %+v", in)
		}
		image, ok := in.Images[assetID]
		raw, _ := base64.StdEncoding.DecodeString(image.Data)
		if !ok || image.Mime != "image/png" || image.Width != 12 || image.Height != 7 || !bytes.Equal(raw, img) {
			t.Fatalf("image = %+v", image)
		}
		if g := eng.grants[0]; g.Operation != office.OperationExport || g.Format != office.FormatPage || g.DocumentID != pageID || g.Input == nil {
			t.Fatalf("grant = %+v", g)
		}
		logs, err := f.docs.ListDocumentAccessLogs(ctx, human(f.tn.owner), pageID, DocumentAccessLogQuery{Action: DocumentAccessExport})
		if err != nil || len(logs) != 1 || logs[0].ActorID.String != reader.ID {
			t.Fatalf("access log = %+v, %v", logs, err)
		}
	})

	t.Run("an image the DOCX cannot embed is left out of the input, however large", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Ảnh webp", Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		// A 200 MiB webp would spend the whole input budget (413) if it were
		// read; its file does not even exist, so reading it would fail too.
		webp := util.NewID()
		if _, err := f.q.InsertDocumentAsset(ctx, db.InsertDocumentAssetParams{
			ID: webp, OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: page.Document.ID, FileID: util.NewID(),
			MimeType: "image/webp", SizeBytes: 200 << 20, CreatedBy: f.actor.ID, CreatedByKind: string(f.actor.Kind),
		}); err != nil {
			t.Fatal(err)
		}
		content := fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://%s","alt":"webp"}}]}]}`, webp)
		if _, err := f.docs.UpdateDocument(ctx, f.actor, page.Document.ID, UpdateDocumentInput{Revision: page.Document.Revision, Content: json.RawMessage(content)}); err != nil {
			t.Fatal(err)
		}
		eng := newPageExportEngine(t)
		out, err := f.service(eng).ExportPage(ctx, f.actor, page.Document.ID, "docx")
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		_ = readExport(t, out)
		var in pageExportInputOf
		if err := json.Unmarshal(eng.inputs[out.Job.ID], &in); err != nil || len(in.Images) != 0 || !bytes.Contains(in.Content, []byte(webp)) {
			t.Fatalf("input = %+v, %v", in, err)
		}
	})

	t.Run("images whose base64 would pass the input cap are refused before any is read", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Ảnh lớn", Visibility: documentVisibilityWorkspace})
		if err != nil {
			t.Fatal(err)
		}
		// 60 MiB of PNG is 80 MiB of base64, past the 64 MiB input; its file
		// does not exist, so reading it would fail with another error.
		png := util.NewID()
		if _, err := f.q.InsertDocumentAsset(ctx, db.InsertDocumentAssetParams{
			ID: png, OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: page.Document.ID, FileID: util.NewID(),
			MimeType: "image/png", SizeBytes: 60 << 20, CreatedBy: f.actor.ID, CreatedByKind: string(f.actor.Kind),
		}); err != nil {
			t.Fatal(err)
		}
		content := fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://%s","alt":"png"}}]}]}`, png)
		if _, err := f.docs.UpdateDocument(ctx, f.actor, page.Document.ID, UpdateDocumentInput{Revision: page.Document.Revision, Content: json.RawMessage(content)}); err != nil {
			t.Fatal(err)
		}
		_, err = f.service(newPageExportEngine(t)).ExportPage(ctx, f.actor, page.Document.ID, "docx")
		var ee *office.EngineError
		if !errors.As(err, &ee) || ee.Reason != "input_too_large" {
			t.Fatalf("err = %v, want input_too_large", err)
		}
	})

	t.Run("pdf: the same job with a pdf target", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		pageID, _, _ := seedPage(t, f)
		out, err := f.service(newPageExportEngine(t)).ExportPage(ctx, f.actor, pageID, "pdf")
		if err != nil {
			t.Fatalf("export: %v", err)
		}
		if got := readExport(t, out); !bytes.Equal(got, exportedPDF(t)) || out.Job.TargetFormat.String != "pdf" {
			t.Fatalf("pdf = %d bytes, job %+v", len(got), out.Job)
		}
	})

	t.Run("a file document is refused before any job", func(t *testing.T) {
		f, _ := exportFixture(t)
		eng := newPageExportEngine(t)
		_, err := f.service(eng).ExportPage(ctx, f.actor, f.doc, "docx")
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "page_export_not_page" || ce.Status != http.StatusUnprocessableEntity {
			t.Fatalf("err = %v", err)
		}
		if n := f.officeJobCount(t, f.doc); n != 0 || len(eng.grants) != 0 {
			t.Fatalf("jobs = %d, grants = %d", n, len(eng.grants))
		}
	})

	t.Run("someone who cannot read the page gets not found, and nothing runs or is logged", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		pageID, _, _ := seedPage(t, f)
		eng := newPageExportEngine(t)
		_, err := f.service(eng).ExportPage(ctx, human(f.tn.bMember), pageID, "docx")
		if !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
			t.Fatalf("err = %v", err)
		}
		logs, _ := f.docs.ListDocumentAccessLogs(ctx, human(f.tn.owner), pageID, DocumentAccessLogQuery{Action: DocumentAccessExport})
		if len(eng.grants) != 0 || f.officeJobCount(t, pageID) != 0 || len(logs) != 0 {
			t.Fatalf("grants = %d, logs = %d", len(eng.grants), len(logs))
		}
	})

	t.Run("a format other than docx or pdf is invalid", func(t *testing.T) {
		f := newOfficeFixture(t, "unused\n")
		pageID, _, _ := seedPage(t, f)
		_, err := f.service(newPageExportEngine(t)).ExportPage(ctx, f.actor, pageID, "md")
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("err = %v", err)
		}
	})
}

// follow-6: the export menu offers pdf only where the engine reports the Docs
// renderer staged; an engine without export offers nothing, one that predates
// the export_pdf row docx only, and a file document is refused as on export.
func TestPageExportFormats(t *testing.T) {
	ctx := context.Background()
	// Each fixture holds the test database's lock until its (sub)test ends.
	t.Run("a file document is refused as on export", func(t *testing.T) {
		file, _ := exportFixture(t)
		var ce CodedError
		if _, err := file.service(newScriptedEngine()).PageExportFormats(ctx, file.actor, file.doc); !errors.As(err, &ce) || ce.Code != "page_export_not_page" {
			t.Fatalf("file document: %v", err)
		}
	})
	f := newOfficeFixture(t, "unused\n")
	page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Biên bản", Visibility: documentVisibilityWorkspace})
	if err != nil {
		t.Fatal(err)
	}
	reader := human(f.tn.member)
	for _, tc := range []struct {
		name  string
		bound map[office.Operation]bool
		want  []string
	}{
		{"no export bound", map[office.Operation]bool{}, []string{}},
		{"export without the renderer", map[office.Operation]bool{office.OperationExport: true}, []string{"docx"}},
		{"export with the renderer", map[office.Operation]bool{office.OperationExport: true, office.CapabilityExportPDF: true}, []string{"docx", "pdf"}},
	} {
		eng := newScriptedEngine()
		eng.bound = tc.bound
		got, err := f.service(eng).PageExportFormats(ctx, reader, page.Document.ID)
		if err != nil || fmt.Sprint(got) != fmt.Sprint(tc.want) {
			t.Fatalf("%s: formats = %v, %v; want %v", tc.name, got, err, tc.want)
		}
	}

	if _, err := f.service(nil).PageExportFormats(ctx, reader, page.Document.ID); !errors.Is(err, office.ErrNotConfigured) {
		t.Fatalf("no engine: %v", err)
	}
	outsider := human(f.tn.outsider)
	if _, err := f.service(newScriptedEngine()).PageExportFormats(ctx, outsider, page.Document.ID); !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider: %v", err)
	}
}
