package imapclient

import (
	"strings"
	"unicode/utf8"
)

// BodyIsSnippetPlaceholder reports metadata-only cache stored as body_text during sync.
func BodyIsSnippetPlaceholder(bodyHTML, bodyText, snippet string) bool {
	if strings.TrimSpace(bodyHTML) != "" {
		return false
	}
	text := strings.TrimSpace(bodyText)
	if text == "" {
		return false
	}
	snip := CleanSnippet(snippet)
	if snip != "" && text == snip {
		return true
	}
	return false
}

// BodyNeedsRefetch reports cached plain text that is CSS noise without HTML.
func BodyNeedsRefetch(bodyHTML, bodyText string) bool {
	if strings.TrimSpace(bodyHTML) != "" {
		return false
	}
	return looksLikeCSSOnly(bodyText)
}

// BodyWorthCaching reports body content safe to persist from sync or prefetch.
func BodyWorthCaching(bodyHTML, bodyText string) bool {
	html := strings.TrimSpace(bodyHTML)
	if html != "" {
		if strings.Contains(strings.ToLower(html), "<img") ||
			strings.Contains(strings.ToLower(html), "<table") ||
			strings.Contains(strings.ToLower(html), "<p") ||
			strings.Contains(strings.ToLower(html), "<div") {
			return true
		}
		if stripHTML(html) != "" {
			return true
		}
	}
	text := strings.TrimSpace(bodyText)
	if text == "" {
		return false
	}
	return !looksLikeCSSOnly(text)
}

const maxPlainBodyRunes = 12000

// PlainBodyForAI returns readable plain text for LLM context from cached body fields.
func PlainBodyForAI(html, text, snippet string) string {
	var body string
	if t := strings.TrimSpace(text); t != "" && !BodyIsSnippetPlaceholder(html, text, snippet) {
		body = t
	} else if h := strings.TrimSpace(html); h != "" {
		body = stripHTML(h)
	} else {
		body = CleanSnippet(snippet)
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	r := []rune(body)
	if len(r) > maxPlainBodyRunes {
		body = string(r[:maxPlainBodyRunes])
	}
	return body
}

// CleanSnippet hides CSS/code noise stored from older sync passes.
func CleanSnippet(snippet string) string {
	s := strings.TrimSpace(snippet)
	if s == "" || looksLikeCSSOnly(s) || strings.HasPrefix(s, "/**") {
		return ""
	}
	return s
}

func looksLikeCSSOnly(s string) bool {
	t := strings.TrimSpace(s)
	if t == "" {
		return false
	}
	if strings.Contains(t, "<html") || strings.Contains(t, "<body") || strings.Contains(t, "<div") {
		return false
	}
	return strings.Contains(t, "@font-face") || strings.HasPrefix(t, "@media") || strings.HasPrefix(t, "@import")
}

// SanitizeUTF8 strips invalid sequences and BOM so Postgres TEXT columns accept the value.
func SanitizeUTF8(s string) string {
	return sanitizeUTF8(s)
}

func sanitizeUTF8(s string) string {
	if s == "" {
		return s
	}
	s = strings.TrimPrefix(s, "\ufeff")
	if utf8.ValidString(s) {
		return s
	}
	return strings.ToValidUTF8(s, "")
}

func sanitizeAddrs(addrs []string) []string {
	if len(addrs) == 0 {
		// pgx encodes nil []string as SQL NULL; column is NOT NULL.
		return []string{}
	}
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		if a = sanitizeUTF8(a); a != "" {
			out = append(out, a)
		}
	}
	return out
}
