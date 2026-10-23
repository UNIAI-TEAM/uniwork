package imapclient

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/emersion/go-imap"
)

func TestThreadBodyHasContent(t *testing.T) {
	t.Parallel()
	if threadBodyHasContent(ThreadBody{}) {
		t.Fatal("expected empty body")
	}
	if !threadBodyHasContent(ThreadBody{Text: "hello"}) {
		t.Fatal("expected text body")
	}
	if !threadBodyHasContent(ThreadBody{HTML: "<p>hi</p>"}) {
		t.Fatal("expected html body")
	}
}

func TestNormalizeThreadBody(t *testing.T) {
	t.Parallel()
	got := normalizeThreadBody(ThreadBody{
		Text: "<html><body>Hello</body></html>",
	})
	if got.HTML == "" || got.Text == "" {
		t.Fatalf("expected html promoted: %+v", got)
	}

	got = normalizeThreadBody(ThreadBody{
		Text: "@font-face { font-family: x; }",
		HTML: "<p>Readable</p>",
	})
	if got.Text != "Readable" {
		t.Fatalf("expected css-only text replaced: %q", got.Text)
	}
}

func TestSnippetFromSubject(t *testing.T) {
	t.Parallel()
	if got := snippetFromSubject("  Hello   world  "); got != "Hello world" {
		t.Fatalf("unexpected snippet: %q", got)
	}
	if got := snippetFromSubject(strings.Repeat("x", 250)); len(got) != 200 {
		t.Fatalf("expected truncated subject snippet, len=%d", len(got))
	}
}

func TestSnippetPrefersPlainText(t *testing.T) {
	t.Parallel()
	got := snippet("Plain body wins", "<style>.x{}</style>")
	if got != "Plain body wins" {
		t.Fatalf("unexpected snippet: %q", got)
	}
}

func TestSnippetCutsOnRuneBoundary(t *testing.T) {
	t.Parallel()
	if got := SnippetFromBody("a\x00b", ""); got != "ab" {
		t.Fatalf("expected NUL dropped from snippet, got %q", got)
	}
	vi := strings.Repeat("Trường học ghi nhận kết quả ", 20)
	for shift := 0; shift < 4; shift++ {
		s := strings.Repeat("a", shift) + vi
		if got := snippet(s, ""); !utf8.ValidString(got) || len(got) > 200 {
			t.Fatalf("shift %d: invalid snippet %q", shift, got)
		}
		if got := snippetFromSubject(s); !utf8.ValidString(got) || len(got) > 200 {
			t.Fatalf("shift %d: invalid subject snippet %q", shift, got)
		}
	}
}

func TestCollectBodyPartsDecodesLegacyCharset(t *testing.T) {
	t.Parallel()
	raw := "Content-Type: text/plain; charset=iso-8859-1\r\n" +
		"Content-Transfer-Encoding: quoted-printable\r\n\r\n" +
		"Caf=E9 r=E9sum=E9"
	got, err := collectBodyParts(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if got.Text != "Café résumé" {
		t.Fatalf("unexpected text: %q", got.Text)
	}
}

func TestCollectBodyPartsKeepsPartsBesideUnknownCharset(t *testing.T) {
	t.Parallel()
	raw := "Content-Type: multipart/alternative; boundary=b\r\n\r\n" +
		"--b\r\nContent-Type: text/plain; charset=x-unknown\r\n\r\nodd\r\n" +
		"--b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Xin chào</p>\r\n" +
		"--b--\r\n"
	got, err := collectBodyParts(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if got.HTML != "<p>Xin chào</p>" {
		t.Fatalf("unexpected html: %q", got.HTML)
	}
}

func TestMessageMetaDecodesLegacyCharsetSubject(t *testing.T) {
	t.Parallel()
	var env imap.Envelope
	fields := []interface{}{"", "=?GB2312?B?xOO6ww==?=", nil, nil, nil, nil, nil, nil, nil, nil}
	if err := env.Parse(fields); err != nil {
		t.Fatal(err)
	}
	meta := messageMeta(nil, &imap.Message{Envelope: &env}, nil)
	if meta.Subject != "你好" {
		t.Fatalf("unexpected subject: %q", meta.Subject)
	}
}
