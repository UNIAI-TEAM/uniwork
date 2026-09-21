package imapclient

import (
	"testing"

	"github.com/emersion/go-imap"
)

func TestPickLargestMIMEPathBySize(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "mixed",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "html", Size: 120},
			{
				MIMEType: "multipart", MIMESubType: "alternative",
				Parts: []*imap.BodyStructure{
					{MIMEType: "text", MIMESubType: "plain", Size: 80},
					{MIMEType: "text", MIMESubType: "html", Size: 4800},
				},
			},
		},
	}
	path := pickLargestMIMEPathBySize(bs, "text", "html")
	if len(path) != 2 || path[0] != 2 || path[1] != 2 {
		t.Fatalf("expected largest nested html path [2 2], got %v", path)
	}
}

func TestFindAllMIMEPathsPicksMultipleHTML(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "mixed",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "html"},
			{
				MIMEType: "multipart", MIMESubType: "alternative",
				Parts: []*imap.BodyStructure{
					{MIMEType: "text", MIMESubType: "plain"},
					{MIMEType: "text", MIMESubType: "html"},
				},
			},
		},
	}
	all := findAllMIMEPaths(bs, nil, "text", "html")
	if len(all) != 2 {
		t.Fatalf("expected 2 html parts, got %d", len(all))
	}
}

func TestFindMIMEPathHTML(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "alternative",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "plain"},
			{MIMEType: "text", MIMESubType: "html"},
		},
	}
	path := findMIMEPath(bs, nil, "text", "html")
	if len(path) != 1 || path[0] != 2 {
		t.Fatalf("unexpected html path: %v", path)
	}
}

func TestEqualFoldASCII(t *testing.T) {
	t.Parallel()
	if !equalFoldASCII("Text", "text") || equalFoldASCII("Text", "html") {
		t.Fatal("equalFoldASCII mismatch")
	}
}

func TestSnippetPrefersHTMLText(t *testing.T) {
	t.Parallel()
	html := `<style>p{color:red}</style><p>Daily Summary for you</p>`
	got := SnippetFromBody("@font-face { font-family: x; }", html)
	if got == "" || got == "@font-face" {
		t.Fatalf("expected readable snippet, got %q", got)
	}
	if got != "Daily Summary for you" {
		t.Fatalf("unexpected snippet: %q", got)
	}
}
