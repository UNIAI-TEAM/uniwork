package imapclient

import (
	"testing"

	"github.com/emersion/go-imap"
)

func TestParsePartID(t *testing.T) {
	t.Parallel()
	got, err := parsePartID("1.2")
	if err != nil || len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("parsePartID(1.2) = %v, %v", got, err)
	}
	if _, err := parsePartID(""); err == nil {
		t.Fatal("expected error for empty part id")
	}
}

func TestJoinPartID(t *testing.T) {
	t.Parallel()
	if joinPartID([]int{1, 2}) != "1.2" {
		t.Fatal("unexpected join")
	}
}

func TestAttachmentHelpers(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{
		MIMEType: "application", MIMESubType: "pdf",
		Disposition:       "attachment",
		DispositionParams: map[string]string{"filename": "doc.pdf"},
		Size:              42,
	}
	if !isAttachmentPart(bs) {
		t.Fatal("expected attachment part")
	}
	if got := attachmentFilename(bs); got != "doc.pdf" {
		t.Fatalf("filename: %q", got)
	}
	if got := mimeType(bs); got != "application/pdf" {
		t.Fatalf("mime: %q", got)
	}
}
