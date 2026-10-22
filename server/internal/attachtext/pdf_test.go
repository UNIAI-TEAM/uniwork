package attachtext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func pdfFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestPDFPagesCountsThePages(t *testing.T) {
	n, err := PDFPages(bytes.NewReader(pdfFixture(t, "three-pages.pdf")))
	if err != nil {
		t.Fatalf("PDFPages: %v", err)
	}
	if n != 3 {
		t.Fatalf("PDFPages = %d, want 3", n)
	}
}

func TestTrimPDFKeepsTheFirstPages(t *testing.T) {
	three := pdfFixture(t, "three-pages.pdf")
	for _, tc := range []struct{ keep, want int }{{1, 1}, {2, 2}, {3, 3}, {10, 3}} {
		out, err := TrimPDF(bytes.NewReader(three), tc.keep)
		if err != nil {
			t.Fatalf("TrimPDF(%d): %v", tc.keep, err)
		}
		n, err := PDFPages(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("PDFPages(TrimPDF(%d)): %v", tc.keep, err)
		}
		if n != tc.want {
			t.Fatalf("TrimPDF(%d) has %d pages, want %d", tc.keep, n, tc.want)
		}
		// With nothing to cut the file comes back as it was.
		if tc.keep >= 3 && !bytes.Equal(out, three) {
			t.Fatalf("TrimPDF(%d) rewrote a PDF that needed no trimming", tc.keep)
		}
	}
}

func TestTrimPDFKeepsPagesFromTheFront(t *testing.T) {
	// Each page of the fixture shows its own number; page 3 must be the one dropped.
	out, err := TrimPDF(bytes.NewReader(pdfFixture(t, "three-pages.pdf")), 2)
	if err != nil {
		t.Fatal(err)
	}
	// The content streams are uncompressed, so the page text is findable in the bytes.
	for _, want := range []string{"Page one", "Page two"} {
		if !bytes.Contains(out, []byte(want)) {
			t.Errorf("trimmed PDF lost %q", want)
		}
	}
	if bytes.Contains(out, []byte("Page three")) {
		t.Error("trimmed PDF still carries page three")
	}
}

func TestTrimPDFRejectsKeepBelowOne(t *testing.T) {
	for _, keep := range []int{0, -1} {
		_, err := TrimPDF(bytes.NewReader(pdfFixture(t, "three-pages.pdf")), keep)
		if err == nil {
			t.Fatalf("TrimPDF(%d) succeeded", keep)
		}
		if errors.Is(err, ErrUnreadable) {
			t.Fatalf("TrimPDF(%d) = %v, a caller bug is not ErrUnreadable", keep, err)
		}
	}
}

func TestEncryptedPDFIsUnreadable(t *testing.T) {
	enc := pdfFixture(t, "encrypted.pdf")
	if _, err := PDFPages(bytes.NewReader(enc)); !errors.Is(err, ErrUnreadable) {
		t.Errorf("PDFPages(encrypted) = %v, want ErrUnreadable", err)
	}
	if _, err := TrimPDF(bytes.NewReader(enc), 1); !errors.Is(err, ErrUnreadable) {
		t.Errorf("TrimPDF(encrypted) = %v, want ErrUnreadable", err)
	}
}

func TestBrokenPDFIsUnreadable(t *testing.T) {
	three := pdfFixture(t, "three-pages.pdf")
	for name, data := range map[string][]byte{
		"empty":     nil,
		"not a pdf": []byte("this is not a pdf at all"),
		"truncated": three[:len(three)/2],
		"header":    []byte("%PDF-1.7\n"),
	} {
		if _, err := PDFPages(bytes.NewReader(data)); !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: PDFPages = %v, want ErrUnreadable", name, err)
		}
		if _, err := TrimPDF(bytes.NewReader(data), 1); !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: TrimPDF = %v, want ErrUnreadable", name, err)
		}
	}
}

// ownerOnlyPDF encrypts three-pages.pdf with an owner password and no user
// password: every viewer opens it without being asked for anything.
func ownerOnlyPDF(t *testing.T) []byte {
	t.Helper()
	conf := model.NewStatelessConfiguration()
	conf.OwnerPW = "owner"
	var out bytes.Buffer
	if err := api.Encrypt(context.Background(), bytes.NewReader(pdfFixture(t, "three-pages.pdf")), &out, conf); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte("/Encrypt")) {
		t.Fatal("fixture is not encrypted")
	}
	return out.Bytes()
}

func TestOwnerPasswordPDFOpensWithoutAPassword(t *testing.T) {
	enc := ownerOnlyPDF(t)
	n, err := PDFPages(bytes.NewReader(enc))
	if err != nil || n != 3 {
		t.Fatalf("PDFPages = %d, %v, want 3", n, err)
	}
	out, err := TrimPDF(bytes.NewReader(enc), 2)
	if err != nil {
		t.Fatalf("TrimPDF: %v", err)
	}
	if bytes.Contains(out, []byte("/Encrypt")) {
		t.Error("trimmed PDF is still encrypted")
	}
	if n, err := PDFPages(bytes.NewReader(out)); err != nil || n != 2 {
		t.Fatalf("PDFPages(trimmed) = %d, %v, want 2", n, err)
	}
}

func TestPDFOverTheSizeLimitIsUnreadable(t *testing.T) {
	data := make([]byte, maxPDFBytes+1)
	copy(data, pdfFixture(t, "three-pages.pdf"))
	_, err := PDFPages(bytes.NewReader(data))
	if !errors.Is(err, ErrUnreadable) || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("PDFPages(over the limit) = %v, want ErrUnreadable from the size limit", err)
	}
}

// pdfWithXref is a valid one-page PDF whose xref lists the given number of
// entries, all but the first four free: small to write, but pdfcpu builds an
// entry for each.
func pdfWithXref(entries int) []byte {
	var b bytes.Buffer
	offs := map[int]int{}
	obj := func(n int, body string) {
		offs[n] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", n, body)
	}
	b.WriteString("%PDF-1.4\n")
	obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>")
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", entries)
	for n := 1; n < entries; n++ {
		if n <= 3 {
			fmt.Fprintf(&b, "%010d 00000 n \n", offs[n])
		} else {
			b.WriteString("0000000000 00000 f \n")
		}
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", entries, xref)
	return b.Bytes()
}

func TestPDFClaimingTooManyObjectsIsUnreadable(t *testing.T) {
	if n, err := PDFPages(bytes.NewReader(pdfWithXref(maxPDFObjects))); err != nil || n != 1 {
		t.Fatalf("PDFPages(at the cap) = %d, %v, want 1", n, err)
	}
	if _, err := PDFPages(bytes.NewReader(pdfWithXref(maxPDFObjects + 1))); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("PDFPages(over the cap) = %v, want ErrUnreadable", err)
	}
}

func TestPDFWorkTurnsAParserPanicIntoUnreadable(t *testing.T) {
	_, err := pdfWork(func(context.Context, *model.Configuration) (int, error) {
		panic("index out of range")
	})
	if !errors.Is(err, ErrUnreadable) {
		t.Fatalf("pdfWork after a panic = %v, want ErrUnreadable", err)
	}
}

func TestPDFWorkRunsUnderADeadline(t *testing.T) {
	_, err := pdfWork(func(ctx context.Context, _ *model.Configuration) (int, error) {
		if _, ok := ctx.Deadline(); !ok {
			t.Error("the pdfcpu context has no deadline")
		}
		return 0, nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// pdfcpu keeps a config directory under the user's config dir and can log; a
// server must get neither from reading an upload.
func TestPDFWorkWritesNoFilesAndPrintsNothing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("PDFCPU_CONFIG_ROOT", "")

	printed, err := os.Create(home + "/printed.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer printed.Close()
	oldOut, oldErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = printed, printed
	defer func() { os.Stdout, os.Stderr = oldOut, oldErr }()

	three := pdfFixture(t, "three-pages.pdf")
	for _, data := range [][]byte{three, pdfFixture(t, "encrypted.pdf"), three[:100]} {
		_, _ = PDFPages(bytes.NewReader(data))
		_, _ = TrimPDF(bytes.NewReader(data), 1)
	}

	os.Stdout, os.Stderr = oldOut, oldErr
	if info, err := printed.Stat(); err != nil || info.Size() != 0 {
		t.Errorf("pdfcpu printed %v bytes (%v)", info.Size(), err)
	}
	entries, err := os.ReadDir(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "printed.txt" {
		t.Errorf("pdfcpu left files in the home directory: %v", entries)
	}
}

func TestPDFWithNoPagesIsUnreadable(t *testing.T) {
	// A valid file whose page tree is empty: nothing for the model to read.
	var b bytes.Buffer
	offs := map[int]int{}
	obj := func(n int, body string) {
		offs[n] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", n, body)
	}
	b.WriteString("%PDF-1.4\n")
	obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	obj(2, "<< /Type /Pages /Kids [] /Count 0 >>")
	xref := b.Len()
	b.WriteString("xref\n0 3\n0000000000 65535 f \n")
	for n := 1; n <= 2; n++ {
		fmt.Fprintf(&b, "%010d 00000 n \n", offs[n])
	}
	fmt.Fprintf(&b, "trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)

	n, err := PDFPages(bytes.NewReader(b.Bytes()))
	if !errors.Is(err, ErrUnreadable) {
		t.Errorf("PDFPages = %d, %v, want ErrUnreadable", n, err)
	}
	out, err := TrimPDF(bytes.NewReader(b.Bytes()), 1)
	if !errors.Is(err, ErrUnreadable) {
		t.Errorf("TrimPDF = %d bytes, %v, want ErrUnreadable", len(out), err)
	}
}
