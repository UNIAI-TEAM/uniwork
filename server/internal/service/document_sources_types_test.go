package service

import (
	"errors"
	"reflect"
	"sort"
	"testing"
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
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("types %q: err = %v, want a validation error (400)", types, err)
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
		var ve ValidationError
		if !errors.As(err, &ve) {
			t.Errorf("types %q: err = %v, want a validation error (400)", types, err)
		}
	}
}
