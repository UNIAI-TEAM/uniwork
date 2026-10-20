package service

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// UNI-2045 zip r1 F3: entry names must extract to distinct, honest files on
// Windows, macOS and ext4.

func TestZipEntryNameAvoidsWindowsReservedNames(t *testing.T) {
	cases := []struct{ title, filename, want string }{
		{"CON", "a.txt", "_CON.txt"},
		{"nul", "a.docx", "_nul.docx"},
		{"Aux", "a.pdf", "_Aux.pdf"},
		{"COM1", "a.pdf", "_COM1.pdf"},
		{"lpt9", "a.xlsx", "_lpt9.xlsx"},
		{"CON.backup", "a.txt", "_CON.backup.txt"},
		{"Console", "a.txt", "Console.txt"},
		{"COM10", "a.txt", "COM10.txt"},
		{"CON", "", "_CON"},
	}
	for _, c := range cases {
		if got := zipEntryName(c.title, c.filename); got != c.want {
			t.Errorf("zipEntryName(%q, %q) = %q, want %q", c.title, c.filename, got, c.want)
		}
	}
}

func TestZipEntryNameCapsBytesOnARuneBoundary(t *testing.T) {
	title := strings.Repeat("Điều khoản ", 40) // multi-byte Vietnamese, well past 200 bytes
	got := zipEntryName(title, "a.docx")
	if !utf8.ValidString(got) {
		t.Fatalf("name cut inside a rune: %q", got)
	}
	if len(got) > 200+len(".docx") {
		t.Fatalf("name is %d bytes, want at most %d", len(got), 200+len(".docx"))
	}
	if !strings.HasSuffix(got, ".docx") {
		t.Fatalf("name lost its extension: %q", got)
	}
}

func TestZipEntryNameStripsInvisibleAndBidiControls(t *testing.T) {
	title := "a‮txt.exe​‏⁦x⁩b‪"
	if got, want := zipEntryName(title, "a.txt"), "atxt.exexb.txt"; got != want {
		t.Fatalf("zipEntryName = %q, want %q", got, want)
	}
}

func TestUniqueZipEntryNameTreatsNormalisationFormsAsOneName(t *testing.T) {
	used := map[string]struct{}{}
	nfc := "Café.txt"
	nfd := "Café.txt"
	if got := uniqueZipEntryName(nfc, used); got != nfc {
		t.Fatalf("first = %q", got)
	}
	got := uniqueZipEntryName(nfd, used)
	if got == nfd || !strings.Contains(got, " (2)") {
		t.Fatalf("NFD twin was not renamed: %q", got)
	}
}
