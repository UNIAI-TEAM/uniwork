package imapclient

import (
	"strings"
	"testing"
)

func TestSanitizeUTF8(t *testing.T) {
	t.Parallel()
	if got := sanitizeUTF8("\ufeffHello"); got != "Hello" {
		t.Fatalf("expected BOM stripped, got %q", got)
	}
	invalid := string([]byte{0xef, 0xbb, 'a'})
	if got := sanitizeUTF8(invalid); got != "a" {
		t.Fatalf("expected invalid bytes dropped, got %q", got)
	}
}

func TestSanitizeAddrsEmptyIsNonNil(t *testing.T) {
	t.Parallel()
	got := sanitizeAddrs(nil)
	if got == nil {
		t.Fatal("expected non-nil empty slice for pgx TEXT[] insert")
	}
	if len(got) != 0 {
		t.Fatalf("expected empty slice, got %v", got)
	}
}

func TestStripHTMLRemovesStyleBlock(t *testing.T) {
	t.Parallel()
	raw := `<style>@font-face { font-family: 'Gotham'; }</style><p>Hello</p>`
	got := stripHTML(raw)
	if strings.Contains(got, "@font-face") {
		t.Fatalf("expected style stripped, got %q", got)
	}
	if got != "Hello" {
		t.Fatalf("expected Hello, got %q", got)
	}
}

func TestBodyWorthCaching(t *testing.T) {
	t.Parallel()
	if !BodyWorthCaching("<p>Hi</p>", "") {
		t.Fatal("expected html body to be worth caching")
	}
	if BodyWorthCaching("", "@font-face { font-family: x; }") {
		t.Fatal("expected css-only plain text to be rejected")
	}
	if !BodyWorthCaching("", "Hello team") {
		t.Fatal("expected plain text to be worth caching")
	}
}

func TestBodyIsSnippetPlaceholder(t *testing.T) {
	t.Parallel()
	if !BodyIsSnippetPlaceholder("", "Hello team", "Hello team") {
		t.Fatal("expected matching snippet text to be a placeholder")
	}
	if BodyIsSnippetPlaceholder("<p>Hello</p>", "", "Hello") {
		t.Fatal("expected html body not to be a placeholder")
	}
}

func TestBodyNeedsRefetchCSSNoise(t *testing.T) {
	t.Parallel()
	if !BodyNeedsRefetch("", "@font-face { font-family: x; }") {
		t.Fatal("expected css-only body to need refetch")
	}
	if BodyNeedsRefetch("<p>Hi</p>", "") {
		t.Fatal("html body should not refetch")
	}
}
