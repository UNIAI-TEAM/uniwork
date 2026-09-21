package imapclient

import (
	"testing"

	"github.com/emersion/go-imap"
)

func TestDecodeBodyContentQuotedPrintable(t *testing.T) {
	t.Parallel()
	raw := []byte("G=E1=BB=ADi sinh vi=C3=AAn")
	got, err := decodeBodyContent(raw, "quoted-printable")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "Gửi sinh viên" {
		t.Fatalf("unexpected decode: %q", got)
	}
}

func TestDecodeBodyContentDetectsQuotedPrintableWithoutEncoding(t *testing.T) {
	t.Parallel()
	raw := []byte("TR=C6=AF=E1=BB=9CNG TRUNG C=E1=BA=A4P")
	got, err := decodeBodyContent(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "TRƯỜNG TRUNG CẤP" {
		t.Fatalf("unexpected decode: %q", got)
	}
}

func TestRepairThreadBodyContent(t *testing.T) {
	t.Parallel()
	raw := "TR=C6=AF=E1=BB=9CNG"
	repaired := RepairThreadBodyContent(raw, "")
	if repaired.Text != "TRƯỜNG" {
		t.Fatalf("repaired text: %q", repaired.Text)
	}
}

func TestDecodeBodyContentBase64(t *testing.T) {
	t.Parallel()
	got, err := decodeBodyContent([]byte("aGVsbG8="), "base64")
	if err != nil || string(got) != "hello" {
		t.Fatalf("base64 decode: %q err=%v", got, err)
	}
}

func TestBodyStructureAtHTMLPart(t *testing.T) {
	t.Parallel()
	bs := &imap.BodyStructure{
		MIMEType: "multipart", MIMESubType: "alternative",
		Parts: []*imap.BodyStructure{
			{MIMEType: "text", MIMESubType: "plain", Encoding: "7bit"},
			{MIMEType: "text", MIMESubType: "html", Encoding: "quoted-printable"},
		},
	}
	part := bodyStructureAt(bs, []int{2})
	if part == nil || part.Encoding != "quoted-printable" {
		t.Fatalf("unexpected part: %+v", part)
	}
}
