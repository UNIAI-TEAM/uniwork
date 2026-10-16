package ai

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// untrustedTag matches the start of an <untrusted> or </untrusted> tag however
// it is spelled: any case, whitespace after '<' or around '/', and the
// full-width and small-form '<' look-alikes. Content a person
// typed must never open or close the tag a prompt wraps it in, or it could
// step outside the data block and speak with the prompt's own voice.
var untrustedTag = regexp.MustCompile(`(?i)[<\x{FF1C}\x{FE64}]\s*(/?)\s*untrusted`)

// reservedHeaders are the plain-text headers of blocks only the system writes
// (the recorded attendance and votes of meeting_summary@2+). A line of user
// content that opens like one is marked as quoted text, so a transcript or
// chat line cannot pose as a system record even inside its untrusted tag.
var reservedHeaders = []string{"recorded attendance", "recorded votes"}

// quotedMarker prefixes a user line that imitates a reserved header.
const quotedMarker = "[user text] "

// EscapeUntrusted neutralizes user content before it is placed inside an
// <untrusted> block: every tag-like "<untrusted" / "</untrusted" loses its
// '<' to "&lt;", and any line that starts like a system record header is
// marked as user text. Ordinary content comes back byte for byte, so the
// snapshot of a prompt only changes for input that tried to break out.
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
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if startsWithReservedHeader(l) {
			lines[i] = quotedMarker + l
		}
	}
	return strings.Join(lines, "\n")
}

// EscapeUntrustedLine is EscapeUntrusted for a value rendered on one line
// (a title, a name, a subject): line breaks become spaces as well, so the
// value cannot start a new line of the prompt that reads like a header.
func EscapeUntrustedLine(s string) string {
	s = strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ").Replace(s)
	return EscapeUntrusted(s)
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

func mentionsReservedHeader(s string) bool {
	lower := strings.ToLower(s)
	for _, h := range reservedHeaders {
		if strings.Contains(lower, h) {
			return true
		}
	}
	return false
}

// startsWithReservedHeader looks past list and quote punctuation, so "- ",
// "## " or "> Recorded votes" are caught as well as the bare header.
func startsWithReservedHeader(line string) bool {
	trimmed := strings.ToLower(strings.TrimLeftFunc(line, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
	}))
	for _, h := range reservedHeaders {
		if strings.HasPrefix(trimmed, h) {
			return true
		}
	}
	return false
}
