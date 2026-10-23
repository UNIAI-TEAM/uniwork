package imapclient

import (
	"strings"
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

func TestDecodeBodyContentWithoutEncodingIsVerbatim(t *testing.T) {
	t.Parallel()
	// No declared encoding means 7bit: "=XX" in a URL or attribute is content.
	raw := []byte(`<a href="?id=12345">`)
	got, err := decodeBodyContent(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(raw) {
		t.Fatalf("unexpected decode: %q", got)
	}
}

func TestParseBodyDecodesQuotedPrintableOnce(t *testing.T) {
	t.Parallel()
	raw := "Content-Type: text/html; charset=utf-8\r\n" +
		"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
		`<a href=3D"https://shop.vn/o?id=3D12345">Xin ch=C3=A0o</a>` +
		`<td width=3D600 bgcolor=3D000000>?utm_campaign=3D2026</td>`
	got, err := parseBody(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	want := `<a href="https://shop.vn/o?id=12345">Xin chào</a><td width=600 bgcolor=000000>?utm_campaign=2026</td>`
	if got.HTML != want {
		t.Fatalf("unexpected html:\n got %q\nwant %q", got.HTML, want)
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
