package service

import (
	"strings"
	"unicode"

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
