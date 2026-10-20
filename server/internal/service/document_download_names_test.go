package service

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
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

// UNI-2045 zip r1 F1: the inputs are already compressed (docx, xlsx, jpg, pdf),
// so the zip stores them; Deflate would spend the 120 s delivery lease on CPU.
func TestDocumentDownloadJobStoresEntriesUncompressed(t *testing.T) {
	z := newZipFixture(t)
	member := human(z.env.tn.member)
	doc := z.file(t, member, "Stored", "s.txt", []byte(strings.Repeat("compressible ", 200)))
	job := z.create(t, member, doc)
	if err := z.run(t, job); err != nil {
		t.Fatal(err)
	}
	dl, err := z.env.svc.OpenDocumentDownloadJob(context.Background(), member, z.env.tn.wsA, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer dl.Reader.Close()
	body, err := io.ReadAll(dl.Reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) != 1 || zr.File[0].Method != zip.Store {
		t.Fatalf("zip entries = %+v, want one stored entry", zr.File)
	}
}
