package imapclient

import (
	"strings"
	"testing"
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
