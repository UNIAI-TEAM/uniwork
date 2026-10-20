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
