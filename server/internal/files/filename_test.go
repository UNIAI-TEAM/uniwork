package files

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizeFilename(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain name", "note.png", "note.png"},
		{"traversal", "../../etc/passwd", "passwd"},
		{"windows separators", `C:\Users\minht\report.pdf`, "report.pdf"},
		{"trailing slash", "folder/", "folder"},
		{"control characters", "no\x00te.txt", "note.txt"},
		{"newline in the name", "line\nbreak.txt", "linebreak.txt"},
		{"dots only", "..", "file"},
		{"spaces only", "   ", "file"},
		{"empty", "", "file"},
		{"leading dot", ".hidden", "hidden"},
		{"trailing space and dot", "name.txt .", "name.txt"},
		{"vietnamese name", "báo cáo tháng 9.pdf", "báo cáo tháng 9.pdf"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SanitizeFilename(tc.in)
			if got != tc.want {
				t.Fatalf("SanitizeFilename(%q) = %q, want %q", tc.in, got, tc.want)
			}
			if strings.ContainsAny(got, `/\`+"\x00") || strings.Contains(got, "..") {
				t.Errorf("%q still carries a path or a control character", got)
			}
		})
	}
}

func TestSanitizeFilenameBoundsRunes(t *testing.T) {
	got := SanitizeFilename(strings.Repeat("あ", maxFilenameRunes+50) + ".png")
	if runes := utf8.RuneCountInString(got); runes != maxFilenameRunes {
		t.Errorf("name has %d runes, want %d", runes, maxFilenameRunes)
	}
}
