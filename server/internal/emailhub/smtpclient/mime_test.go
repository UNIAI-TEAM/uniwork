package smtpclient

import (
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
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
	if got := strings.Count(body, "Content-Transfer-Encoding: quoted-printable"); got != 2 {
		t.Fatalf("quoted-printable body part headers = %d, want 2", got)
	}
}

func TestBuildRawQuotedPrintableLongHTMLRoundTrip(t *testing.T) {
	t.Parallel()
	bodyHTML := "<div>" + strings.Repeat("Tiếng Việt có dấu — nội dung dài. ", 80) + "</div>"
	if len([]byte(bodyHTML)) < 2_000 {
		t.Fatalf("test fixture must exceed 2,000 bytes, got %d", len([]byte(bodyHTML)))
	}
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		"Long Vietnamese HTML",
		"",
		bodyHTML,
		nil,
		"<id@example.com>",
		"",
		"",
	)

	msg, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("parse message: %v", err)
	}
	if got := msg.Header.Get("Content-Transfer-Encoding"); got != "quoted-printable" {
		t.Fatalf("Content-Transfer-Encoding = %q, want quoted-printable", got)
	}
	encoded, err := io.ReadAll(msg.Body)
	if err != nil {
		t.Fatalf("read encoded body: %v", err)
	}
	for lineNumber, line := range strings.Split(strings.TrimSuffix(string(encoded), "\r\n"), "\r\n") {
		if len([]byte(line)) > maxLineLen {
			t.Fatalf("encoded line %d has %d octets, want <= %d: %q", lineNumber+1, len([]byte(line)), maxLineLen, line)
		}
	}
	decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(string(encoded))))
	if err != nil {
		t.Fatalf("decode quoted-printable body: %v", err)
	}
	if got := strings.TrimSuffix(string(decoded), "\r\n"); got != bodyHTML {
		t.Fatalf("decoded body does not round-trip:\ngot:  %q\nwant: %q", got, bodyHTML)
	}
}

func TestBuildRawAttachmentBodyUsesQuotedPrintable(t *testing.T) {
	t.Parallel()
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		"Files",
		"Nội dung thư",
		"",
		[]OutboundAttachment{{Filename: "doc.txt", ContentType: "text/plain", Data: []byte("hello")}},
		"<id@example.com>",
		"",
		"",
	)

	msg, err := mail.ReadMessage(strings.NewReader(raw))
	if err != nil {
		t.Fatalf("parse message: %v", err)
	}
	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("parse Content-Type: %v", err)
	}
	if mediaType != "multipart/mixed" {
		t.Fatalf("Content-Type = %q, want multipart/mixed", mediaType)
	}
	reader := multipart.NewReader(msg.Body, params["boundary"])
	bodyPart, err := reader.NextRawPart()
	if err != nil {
		t.Fatalf("read body part: %v", err)
	}
	if got := bodyPart.Header.Get("Content-Transfer-Encoding"); got != "quoted-printable" {
		t.Fatalf("body part Content-Transfer-Encoding = %q, want quoted-printable", got)
	}
	attachmentPart, err := reader.NextRawPart()
	if err != nil {
		t.Fatalf("read attachment part: %v", err)
	}
	if got := attachmentPart.Header.Get("Content-Transfer-Encoding"); got != "base64" {
		t.Fatalf("attachment Content-Transfer-Encoding = %q, want base64", got)
	}
}

func TestQuotedPrintableNormalizesCRLF(t *testing.T) {
	t.Parallel()
	const body = "Dòng một\r\nDòng hai"
	encoded := qp(body)
	if strings.Contains(encoded, "\r\r\n") {
		t.Fatalf("quoted-printable output contains duplicated carriage return: %q", encoded)
	}
	decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(encoded)))
	if err != nil {
		t.Fatalf("decode quoted-printable body: %v", err)
	}
	if got := string(decoded); got != body {
		t.Fatalf("decoded body = %q, want %q", got, body)
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

func TestQuotedPrintableShortSingleLine(t *testing.T) {
	t.Parallel()
	const line = "short plain body"
	if got := qp(line); got != line {
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
