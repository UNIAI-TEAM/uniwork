package service

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// foldForSearch normalises a string the way the directory searches it: lower
// case, diacritics removed. Vietnamese users type "nguyen van an" and expect
// "Nguyễn Văn Ân"; Postgres cannot do this in an index expression without a
// non-immutable unaccent(), so the folding happens here and both the stored
// search_text and the query term go through the same function.
func foldForSearch(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		switch {
		case unicode.Is(unicode.Mn, r):
			// A combining mark: NFD split it off the base letter, drop it.
		case r == 'đ':
			// đ is a letter of its own, not a decorated d, so NFD leaves it
			// whole and it needs its own case.
			b.WriteRune('d')
		default:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// buildSearchText is the one definition of what the directory searches over.
// Department name is in it so "kỹ thuật" finds the engineering team without
// the caller reaching for the filter first.
func buildSearchText(displayName, email, title, departmentName string) string {
	return foldForSearch(strings.Join([]string{displayName, email, title, departmentName}, " "))
}

// documentSnippetRunes caps a search hit's excerpt, the SQL left(content_text, N) included.
const documentSnippetRunes = 160

// snippetLeadRunes is how much text a snippet shows before the match.
const snippetLeadRunes = 40

// matchSnippet shows the part of a file's text a search matched. sqlSnippet is
// the excerpt SQL already chose: empty means the caller may not read the body
// (DOC-05) or there is none, and it stays empty. When the folded query is not in
// the text (a title match) the SQL excerpt stands.
func matchSnippet(contentText, query, sqlSnippet string) string {
	q := foldForSearch(query)
	if q == "" || sqlSnippet == "" {
		return sqlSnippet
	}
	orig := []rune(contentText)
	// Fold rune by rune the way foldForSearch does, remembering which original
	// rune each folded rune came from.
	var folded strings.Builder
	var from []int
	space := false
	for i, r := range orig {
		if unicode.IsSpace(r) {
			space = folded.Len() > 0
			continue
		}
		for _, f := range norm.NFD.String(strings.ToLower(string(r))) {
			switch {
			case unicode.Is(unicode.Mn, f):
				continue
			case f == 'đ':
				f = 'd'
			}
			if space {
				folded.WriteRune(' ')
				from = append(from, i)
				space = false
			}
			folded.WriteRune(f)
			from = append(from, i)
		}
	}
	at := strings.Index(folded.String(), q)
	if at < 0 {
		return sqlSnippet
	}
	first := from[utf8.RuneCountInString(folded.String()[:at])]
	start := max(first-snippetLeadRunes, 0)
	room, lead, tail := documentSnippetRunes, "", ""
	if start > 0 {
		lead, room = "…", room-1
	}
	end := start + room
	if end < len(orig) {
		tail, end = "…", end-1
	}
	return lead + string(orig[start:min(end, len(orig))]) + tail
}
