package smtpclient

import (
	"strings"
	"testing"
)

func TestBuildBodyPartPlainOnly(t *testing.T) {
	t.Parallel()
	ct, body := buildBodyPart("Hello", "", nil)
	if ct != "text/plain; charset=UTF-8" || body != "Hello" {
		t.Fatalf("plain body: %q %q", ct, body)
	}
}

func TestBuildBodyPartAlternative(t *testing.T) {
	t.Parallel()
	ct, body := buildBodyPart("Hello", "<p>Hello</p>", nil)
	if !strings.HasPrefix(ct, "multipart/alternative") {
		t.Fatalf("expected alternative, got %q", ct)
	}
	if !strings.Contains(body, "text/plain") || !strings.Contains(body, "text/html") {
		t.Fatalf("missing parts: %q", body)
	}
}

func TestEncodeBodyContentFoldsLongLines(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", maxLineLen+10)
	if !strings.Contains(encodeBodyContent(long+"\nline2"), "\r\n") {
		t.Fatal("expected CRLF folding for multiline body")
	}
}

func TestFoldBase64Wraps(t *testing.T) {
	t.Parallel()
	data := make([]byte, 120)
	for i := range data {
		data[i] = byte('A' + (i % 26))
	}
	folded := foldBase64(data)
	if !strings.Contains(folded, "\r\n") {
		t.Fatal("expected wrapped base64")
	}
}

func TestSanitizeFilename(t *testing.T) {
	t.Parallel()
	if sanitizeFilename("") != "attachment" {
		t.Fatal("empty name")
	}
	if sanitizeFilename("  report\r\n.pdf  ") != "report.pdf" {
		t.Fatalf("sanitize: %q", sanitizeFilename("  report\r\n.pdf  "))
	}
}

func TestAttachmentContentType(t *testing.T) {
	t.Parallel()
	if got := attachmentContentType("doc.pdf", ""); got != "application/pdf" {
		t.Fatalf("pdf ext: %q", got)
	}
	if got := attachmentContentType("x", "text/custom"); got != "text/custom" {
		t.Fatalf("explicit: %q", got)
	}
}

func TestBuildBodyPartHTMLOnly(t *testing.T) {
	t.Parallel()
	ct, body := buildBodyPart("", "<p>Only HTML</p>", nil)
	if ct != "text/html; charset=UTF-8" || !strings.Contains(body, "Only HTML") {
		t.Fatalf("html only: %q %q", ct, body)
	}
}

func TestEncodeBodyContentShortSingleLine(t *testing.T) {
	t.Parallel()
	const line = "short plain body"
	if got := encodeBodyContent(line); got != line {
		t.Fatalf("expected unchanged short line, got %q", got)
	}
}

func TestBuildBodyPartAlternativeWithAttachments(t *testing.T) {
	t.Parallel()
	ct, body := buildBodyPart("Plain", "<p>HTML</p>", []OutboundAttachment{{
		Filename: "a.txt", ContentType: "text/plain", Data: []byte("data"),
	}})
	if !strings.HasPrefix(ct, "multipart/mixed") {
		t.Fatalf("expected mixed, got %q", ct)
	}
	for _, want := range []string{"multipart/alternative", "text/plain", "text/html", "Content-Disposition: attachment", "a.txt"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q", want)
		}
	}
}

func TestNewBoundaryIsNonEmpty(t *testing.T) {
	t.Parallel()
	if b := newBoundary(); !strings.HasPrefix(b, "uniwork-") || len(b) < 16 {
		t.Fatalf("unexpected boundary: %q", b)
	}
}

func TestBuildRawWithAttachment(t *testing.T) {
	t.Parallel()
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		"Files",
		"See attached",
		"",
		[]OutboundAttachment{{Filename: "doc.txt", ContentType: "text/plain", Data: []byte("hello")}},
		"<id@example.com>",
		"",
		"",
	)
	for _, want := range []string{"multipart/mixed", "Content-Disposition: attachment", "doc.txt", "See attached"} {
		if !strings.Contains(raw, want) {
			t.Fatalf("raw missing %q:\n%s", want, raw)
		}
	}
}
