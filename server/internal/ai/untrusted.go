package ai

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// untrustedTag matches the start of an <untrusted> or </untrusted> tag however
// it is spelled: any case; any whitespace (Unicode spaces and the vertical tab
// included) or invisible format character (zero-width space/joiners, word
// joiner, BOM: \p{Cf}) after the bracket and around the slash; format
// characters between the letters; the '<' look-alikes, slash look-alikes and
// full-width letters. Content a person typed must never open or close the tag
// a prompt wraps it in, or it could step outside the data block and speak with
// the prompt's own voice. Matching happens on the original text, so only the
// bracket of a match is rewritten and every other byte is kept.
var untrustedTag = regexp.MustCompile(untrustedTagPattern())

const (
	// tagBrackets: '<' and the characters a model may read as one —
	// full-width, small form, single guillemet, CJK and math angle brackets,
	// the deprecated left-pointing angle, the modifier arrowhead and the
	// heavy ornament brackets.
	tagBrackets = `<\x{FF1C}\x{FE64}\x{2039}\x{3008}\x{27E8}\x{2329}\x{02C2}\x{276C}\x{276E}\x{29FC}`
	// tagSlashes: '/' and its full-width, division, fraction and big-solidus
	// look-alikes.
	tagSlashes = `/\x{FF0F}\x{2215}\x{2044}\x{29F8}`
	// tagGap is whatever may sit invisibly between the bracket, the slash and
	// the word: RE2's \s is only [\t\n\f\r ], so the vertical tab, NEL, the
	// \p{Z} spaces and the \p{Cf} format characters are named too.
	tagGap = `[\s\x{0B}\x{85}\p{Z}\p{Cf}]*`
)

func untrustedTagPattern() string {
	var b strings.Builder
	b.WriteString(`(?i)[` + tagBrackets + `]` + tagGap + `[` + tagSlashes + `]?` + tagGap)
	for i, r := range "untrusted" {
		if i > 0 {
			b.WriteString(`\p{Cf}*`)
		}
		// The ASCII letter or its full-width form (U+FF41 is 'a'); (?i)
		// folds the upper-case forms of both.
		b.WriteString(`[` + string(r) + string(r-'a'+0xFF41) + `]`)
	}
	return b.String()
}

// reservedHeaders are the plain-text headers of blocks only the system writes
// (the recorded attendance and votes of meeting_summary@2+). A line of user
// content that opens like one is marked as quoted text, so a transcript or
// chat line cannot pose as a system record even inside its untrusted tag.
var reservedHeaders = []string{"recorded attendance", "recorded votes"}

// quotedMarker prefixes a user line that imitates a reserved header.
const quotedMarker = "[user text] "

// EscapeUntrusted neutralizes user content before it is placed inside an
// <untrusted> block: every tag-like "<untrusted" / "</untrusted" loses its
// bracket to "&lt;", and any line that starts like a system record header is
// marked as user text. A line here is whatever any Unicode line break opens,
// not only "\n". Ordinary content comes back byte for byte, so the snapshot of
// a prompt only changes for input that tried to break out.
func EscapeUntrusted(s string) string {
	if s == "" {
		return s
	}
	s = untrustedTag.ReplaceAllStringFunc(s, func(m string) string {
		_, n := utf8.DecodeRuneInString(m)
		return "&lt;" + m[n:]
	})
	if !mentionsReservedHeader(s) {
		return s
	}
	var b strings.Builder
	for {
		end := strings.IndexFunc(s, isLineBreak)
		line := s
		if end >= 0 {
			line = s[:end]
		}
		if startsWithReservedHeader(line) {
			b.WriteString(quotedMarker)
		}
		b.WriteString(line)
		if end < 0 {
			return b.String()
		}
		_, n := utf8.DecodeRuneInString(s[end:])
		b.WriteString(s[end : end+n])
		s = s[end+n:]
	}
}

// EscapeUntrustedLine is EscapeUntrusted for a value rendered on one line
// (a title, a name, a subject): every line break — \r, \n, \v, \f, NEL and
// the Unicode line and paragraph separators — becomes a space as well, so the
// value cannot start a new line of the prompt that reads like a header.
func EscapeUntrustedLine(s string) string {
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.Map(func(r rune) rune {
		if isLineBreak(r) {
			return ' '
		}
		return r
	}, s)
	return EscapeUntrusted(s)
}

// isLineBreak reports the characters a reader (or a model) may take as the
// start of a new line.
func isLineBreak(r rune) bool {
	switch r {
	case '\n', '\r', '\v', '\f', 0x85, 0x2028, 0x2029:
		return true
	}
	return false
}

// Untrusted wraps content in a block tag on its own lines, escaped:
//
//	<untrusted source="notes">
//	…
//	</untrusted>
//
// source is a constant chosen by the prompt author, never user input.
func Untrusted(source, text string) string {
	return "<untrusted source=\"" + source + "\">\n" + EscapeUntrusted(text) + "\n</untrusted>"
}

// UntrustedInline wraps a one-line value in an inline tag, escaped:
// <untrusted source="title">…</untrusted>.
func UntrustedInline(source, text string) string {
	return "<untrusted source=\"" + source + "\">" + EscapeUntrustedLine(text) + "</untrusted>"
}

// foldForMatch is the form header matching compares: format characters
// dropped, every run of Unicode whitespace one ASCII space, lower case. It is
// only ever compared, never written back into the prompt.
func foldForMatch(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Cf, r):
			continue
		case unicode.IsSpace(r):
			space = true
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(unicode.ToLower(r))
	}
	if space {
		b.WriteByte(' ')
	}
	return b.String()
}

func mentionsReservedHeader(s string) bool {
	folded := foldForMatch(s)
	for _, h := range reservedHeaders {
		if strings.Contains(folded, h) {
			return true
		}
	}
	return false
}

// startsWithReservedHeader looks past list and quote punctuation, so "- ",
// "## " or "> Recorded votes" are caught as well as the bare header, and past
// invisible format characters and Unicode spaces anywhere in the header.
func startsWithReservedHeader(line string) bool {
	trimmed := strings.TrimLeftFunc(foldForMatch(line), func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
	})
	for _, h := range reservedHeaders {
		if strings.HasPrefix(trimmed, h) {
			return true
		}
	}
	return false
}
