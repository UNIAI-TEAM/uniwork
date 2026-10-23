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

func TestSanitizeUTF8DropsNUL(t *testing.T) {
	t.Parallel()
	// Postgres TEXT rejects 0x00 (SQLSTATE 22021); a decoded subject may carry it.
	if got := sanitizeUTF8("Hi\x00there"); got != "Hithere" {
		t.Fatalf("expected NUL dropped, got %q", got)
	}
	if got := sanitizeUTF8("\ufeffA\x00B"); got != "AB" {
		t.Fatalf("expected BOM and NUL dropped, got %q", got)
	}
}

func TestStripHTMLSurvivesCaseFoldingThatChangesByteLength(t *testing.T) {
	t.Parallel()
	// strings.ToLower turns 'Ⱥ' (2 bytes) into 'ⱥ' (3 bytes); indexes must stay aligned.
	hostile := strings.Repeat("Ⱥ", 20) + "<style"
	_ = normalizeThreadBody(ThreadBody{HTML: hostile})
	_ = SnippetFromBody("", hostile)
	_ = BodyWorthCaching(hostile, "")
	if got := stripHTML("Ⱥ<STYLE>x</style>y"); got != "Ⱥy" {
		t.Fatalf("expected style block removed case-insensitively, got %q", got)
	}
	if got := stripHTML("K<script>x</SCRIPT>ok"); got != "Kok" {
		t.Fatalf("expected script block removed after Kelvin sign, got %q", got)
	}
}
