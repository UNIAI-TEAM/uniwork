package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// List rows carry the current file version's size and where the document
// came from: uploaded bytes, or something UniWork made (a blank Office file,
// a page, a folder). The list and recent routes answer the same facts.
func TestDocumentListRowsCarrySizeAndOrigin(t *testing.T) {
	const content = "# seed\n"
	f := newOfficeFixture(t, content)
	ctx := context.Background()
	eng := newScriptedEngine()
	eng.fake = f.files.Fake
	blank := createBlank(t, f, f.service(eng), eng, blankCreateCases[0], BlankFileInput{
		Format: string(office.FormatDOCX), Title: "Trống.docx", IdempotencyKey: util.NewID(),
	})
	page, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Title: "Trang"})
	if err != nil {
		t.Fatalf("create page: %v", err)
	}
	folder, err := f.docs.CreatePage(ctx, f.actor, f.ws, CreatePageInput{Kind: DocumentKindFolder, Title: "Thư mục"})
	if err != nil {
		t.Fatalf("create folder: %v", err)
	}
	// The uploaded seed is a Markdown file (note.md, text/markdown) and the
	// blank is a DOCX the engine wrote, so each row reports the library format
	// of its current version; a page and a folder report none (UNI-1868).
	want := map[string]DocumentListFacts{
		f.doc:              {SizeBytes: int64(len(content)), Origin: DocumentOriginUpload, Format: "md"},
		blank.Document.ID:  {SizeBytes: int64(len(blankDOCXSeed())), Origin: DocumentOriginCreated, Format: "docx"},
		page.Document.ID:   {Origin: DocumentOriginCreated},
		folder.Document.ID: {Origin: DocumentOriginCreated},
	}

	list, err := f.docs.ListDocuments(ctx, f.actor, f.ws, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	seen := 0
	for _, item := range list.Items {
		w, ok := want[item.Document.ID]
		if !ok {
			continue
		}
		seen++
		if item.Facts != w {
			t.Fatalf("%s (%s) facts = %+v, want %+v", item.Document.Title, item.Document.Kind, item.Facts, w)
		}
	}
	if seen != len(want) {
		t.Fatalf("list returned %d of the %d seeded documents", seen, len(want))
	}

	recent, err := f.docs.ListRecentDocuments(ctx, f.actor, f.ws, ListDocumentsInput{Limit: 100})
	if err != nil {
		t.Fatalf("recent: %v", err)
	}
	for _, item := range recent.Items {
		if w, ok := want[item.Document.ID]; ok && item.Facts != w {
			t.Fatalf("recent %s facts = %+v, want %+v", item.Document.Title, item.Facts, w)
		}
	}
}

// A page with no file document answers without touching the facts query.
func TestDocumentListFactsWithoutFiles(t *testing.T) {
	var s DocumentService
	got, err := s.listFacts(context.Background(), "org", nil)
	if err != nil || len(got) != 0 {
		t.Fatalf("empty page = %v, %v", got, err)
	}
	if err := s.attachListFacts(context.Background(), nil); err != nil {
		t.Fatalf("attach empty: %v", err)
	}
}
