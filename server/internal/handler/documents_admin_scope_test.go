package handler

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DOC-05 (UNI-1628): a DocumentDTO built for an AdminScope caller with no
// read level (visibility, archive and restore results) carries no body; one
// built for a reader still does.
func TestDocumentDTOOmitsContentBelowView(t *testing.T) {
	doc := db.Document{
		ID: "d", Kind: service.DocumentKindPage, Title: "Kế hoạch", Visibility: "restricted",
		Content: []byte(`{"type":"doc"}`), ContentText: "secret body",
	}
	locked := documentDTO(service.DocumentView{Document: doc, Access: service.DocumentAccess{AdminScope: true}})
	if locked.Content != nil || locked.ContentText != "" {
		t.Fatalf("admin-only DTO carries content: %+v %q", locked.Content, locked.ContentText)
	}
	if locked.Title != "Kế hoạch" {
		t.Fatalf("admin-only DTO lost the title: %q", locked.Title)
	}
	read := documentDTO(service.DocumentView{Document: doc, Access: service.DocumentAccess{Level: service.DocumentLevelView}})
	if read.Content == nil || read.ContentText != "secret body" {
		t.Fatalf("reader DTO lost content: %+v %q", read.Content, read.ContentText)
	}
}
