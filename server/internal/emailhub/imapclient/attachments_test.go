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
	if got := mimeType(nil); got != "application/octet-stream" {
		t.Fatalf("nil mime: %q", got)
	}
}

func TestCollectAttachmentsNested(t *testing.T) {
	t.Parallel()
	root := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "mixed",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "plain"},
			{
				MIMEType: "application", MIMESubType: "octet-stream",
				Disposition: "attachment", DispositionParams: map[string]string{"filename": "a.bin"},
				Size: 10,
			},
		},
	}
	var out []AttachmentMeta
	collectAttachments(root, nil, &out)
	if len(out) != 1 || out[0].Filename != "a.bin" || out[0].PartID != "2" {
		t.Fatalf("collectAttachments: %+v", out)
	}
}

func TestBodyPartAt(t *testing.T) {
	t.Parallel()
	root := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "mixed",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "plain"},
			{MIMEType: "text", MIMESubType: "html"},
		},
	}
	part := bodyPartAt(root, []int{2})
	if part == nil || part.MIMESubType != "html" {
		t.Fatalf("bodyPartAt: %+v", part)
	}
	if bodyPartAt(root, []int{9}) != nil {
		t.Fatal("expected nil for out-of-range path")
	}
}

func TestAttachmentFilenameFromParams(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{Params: map[string]string{"name": "inline.png"}}
	if got := attachmentFilename(bs); got != "inline.png" {
		t.Fatalf("filename from params: %q", got)
	}
}
