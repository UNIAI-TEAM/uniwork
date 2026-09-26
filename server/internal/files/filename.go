package files

import (
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

// maxFilenameRunes bounds the stored display name. It matches the cap the chat
// pipeline already publishes, so the shared name is never longer than the one
// users see today.
const maxFilenameRunes = 200

// SanitizeFilename is the one name every module shows and downloads (T1-Q4).
// The upload stores it once and nothing renames a file afterwards, so this has
// to be safe for every consumer:
//
//   - only the base name survives, for both separators;
//   - control characters - including NUL - are dropped, so a name cannot break
//     a header or a log line;
//   - leading and trailing dots and spaces go, so the name cannot be "." or
//     ".." or end in a space;
//   - an unusable or empty name becomes "file" rather than an empty column.
//
// The extension is not trusted for anything; it rides along only because a
// person needs to recognise the download.
func SanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.Trim(name, ". ")
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	if utf8.RuneCountInString(name) > maxFilenameRunes {
		name = string([]rune(name)[:maxFilenameRunes])
	}
	return name
}
