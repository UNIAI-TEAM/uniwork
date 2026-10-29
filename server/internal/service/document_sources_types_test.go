package service

import (
	"reflect"
	"sort"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2113: GET .../documents/sources takes the repeated ?type= of the
// document lists. The pure vocabulary is held here without a database; the
// listing itself is held by TestDocumentSourceListsRepeatedTypes.

func TestDocumentSourceTypeFilter(t *testing.T) {
	for _, c := range []struct {
		name  string
		types []string
		want  []string
	}{
		{"none is the whole source set", nil, documentSourceAllExts},
		{"one type", []string{"pdf"}, []string{"pdf"}},
		{"a type with two extensions", []string{"docx"}, []string{"docx", "doc"}},
		{"types add up", []string{"pdf", "docx"}, []string{"docx", "doc", "pdf"}},
		{"txt is a source type", []string{"txt"}, []string{"txt"}},
		{"page adds no extension", []string{"page", "pdf"}, []string{"pdf"}},
		{"a repeat counts once", []string{"pdf", "pdf"}, []string{"pdf"}},
		// A list type sources cannot hold narrows to nothing, never to all.
		{"page alone is empty", []string{"page"}, []string{}},
	} {
		t.Run(c.name, func(t *testing.T) {
			mode, got, err := documentSourceTypeFilter(c.types)
			if err != nil {
				t.Fatal(err)
			}
			if mode != "ext" {
				t.Errorf("mode = %q, want ext", mode)
			}
			g, w := append([]string{}, got...), append([]string{}, c.want...)
			sort.Strings(g)
			sort.Strings(w)
			if !reflect.DeepEqual(g, w) {
				t.Errorf("exts = %v, want %v", got, c.want)
			}
		})
	}
}

func TestDocumentSourceTypeFilterRefusesWhatNoListAccepts(t *testing.T) {
	for _, types := range [][]string{
		{"image"}, {"other"}, {"PDF"}, {""}, {"pdf", "bogus"}, {"page", ""},
	} {
		_, _, err := documentSourceTypeFilter(types)
		if !codedIs(err, "invalid_type") {
			t.Errorf("types %q: err = %v, want 400 invalid_type", types, err)
		}
	}
}

// Every value the list routes accept is accepted here too, so one picker can
// send the same repeated type to every route.
func TestDocumentSourceTypeFilterAcceptsTheListVocabulary(t *testing.T) {
	for _, typ := range []string{"page", "docx", "xlsx", "pptx", "pdf", "md", "html", "txt"} {
		if _, _, err := documentSourceTypeFilter([]string{typ}); err != nil {
			t.Errorf("type=%s: %v", typ, err)
		}
	}
}

// UNI-2288: documentSourceIncludesPages is true when no ?type= filter is passed
// or when "page" is among the values, and documentSourceMeetingItem maps both
// file and page rows without running file extension/policy logic on pages.
func TestDocumentSourceIncludesPagesAndMeetingItemMapper(t *testing.T) {
	for _, c := range []struct {
		types []string
		want  bool
	}{
		{nil, true},
		{[]string{}, true},
		{[]string{"page"}, true},
		{[]string{"pdf", "page"}, true},
		{[]string{"pdf"}, false},
		{[]string{"docx", "xlsx"}, false},
	} {
		if got := documentSourceIncludesPages(c.types); got != c.want {
			t.Errorf("documentSourceIncludesPages(%v) = %v, want %v", c.types, got, c.want)
		}
	}

	policy := documentFilePolicyFor(nil)
	pageItem := documentSourceMeetingItem(db.ListDocumentSourceMeetingFilesRow{
		RowID:       "01MTG",
		SourceID:    "meeting:minutes:01MTG",
		Kind:        DocumentKindPage,
		DocumentID:  "01DOC",
		ParentKind:  "meeting",
		ParentID:    "01MTG",
		ParentTitle: "Giao ban.pdf",
		Name:        "Giao ban.pdf",
	}, policy)
	if pageItem.Kind != DocumentKindPage || pageItem.DocumentID != "01DOC" || pageItem.Name != "Giao ban.pdf" ||
		pageItem.Extension != "" || pageItem.MimeType != "" || pageItem.SizeBytes != 0 ||
		pageItem.CanOpenInApp || pageItem.CanSave || pageItem.Owner != nil {
		t.Fatalf("pageItem = %+v", pageItem)
	}

	fileItem := documentSourceMeetingItem(db.ListDocumentSourceMeetingFilesRow{
		RowID:       "01REC",
		SourceID:    "meeting:01REC",
		Kind:        DocumentKindFile,
		ParentKind:  "meeting",
		ParentID:    "01MTG",
		ParentTitle: "Giao ban",
		Name:        "recording.pdf",
		MimeType:    "application/pdf",
		SizeBytes:   2048,
		OwnerID:     "01USR",
		OwnerKind:   "member",
		OwnerName:   "An",
	}, policy)
	if fileItem.Kind != DocumentKindFile || fileItem.DocumentID != "" || fileItem.Extension != "pdf" ||
		!fileItem.CanSave || fileItem.Owner == nil || fileItem.Owner.Kind != "human" {
		t.Fatalf("fileItem = %+v", fileItem)
	}
}

// Repeated types are OR-ed over the source rows, a type sources cannot hold
// (page) adds nothing, and a page-only pick is an empty page rather than the
// whole set. The cursor of a multi-type page walks the same union.
func TestDocumentSourceListsRepeatedTypes(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := newSourceSceneOn(t, env)
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	docx := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "plan.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5, "")
	doc := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "old.doc", "application/msword", 5, "")
	pdf := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "spec.pdf", "application/pdf", 5, "")
	txt := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "notes.txt", "text/plain", 5, "")
	xlsx := "task:" + s.attachmentWith(tn, tn.wsA, taskA, "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 5, "")

	ids := func(types []string, limit int) map[string]bool {
		t.Helper()
		got := map[string]bool{}
		cursor := ""
		for pages := 0; pages < 10; pages++ {
			page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Types: types, Cursor: cursor, Limit: limit})
			if err != nil {
				t.Fatalf("types %v: %v", types, err)
			}
			for _, it := range page.Items {
				if got[it.ID] {
					t.Fatalf("types %v: %s listed twice", types, it.ID)
				}
				got[it.ID] = true
			}
			if page.NextCursor == "" {
				return got
			}
			cursor = page.NextCursor
		}
		t.Fatalf("types %v: paging never ended", types)
		return nil
	}
	same := func(types []string, limit int, want ...string) {
		t.Helper()
		got := ids(types, limit)
		if len(got) != len(want) {
			t.Errorf("types %v: got %v, want %v", types, got, want)
			return
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("types %v: %s missing from %v", types, id, got)
			}
		}
	}

	same(nil, 0, docx, doc, pdf, txt, xlsx)
	same([]string{"pdf"}, 0, pdf)
	same([]string{"docx", "pdf"}, 0, docx, doc, pdf)
	same([]string{"docx", "pdf", "txt"}, 2, docx, doc, pdf, txt)
	same([]string{"page", "xlsx"}, 0, xlsx)
	same([]string{"pdf", "pdf"}, 0, pdf)
	same([]string{"page"}, 0)

	for _, types := range [][]string{{"pdf", "bogus"}, {""}, {"image"}} {
		_, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Types: types})
		if !codedIs(err, "invalid_type") {
			t.Errorf("types %q: err = %v, want 400 invalid_type", types, err)
		}
	}
}
