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

// pagesOf counts the pages of a PDF ReadPDF made, through pdfcpu itself.
func pagesOf(t *testing.T, data []byte) int {
	t.Helper()
	n, err := api.PageCount(context.Background(), bytes.NewReader(data), model.NewStatelessConfiguration())
	if err != nil {
		t.Fatalf("PageCount: %v", err)
	}
	return n
}

func TestReadPDFCountsThePages(t *testing.T) {
	n, _, err := ReadPDF(pdfFixture(t, "three-pages.pdf"), 10)
	if err != nil || n != 3 {
		t.Fatalf("ReadPDF = %d pages, %v, want 3", n, err)
	}
}

func TestReadPDFKeepsTheFirstPages(t *testing.T) {
	three := pdfFixture(t, "three-pages.pdf")
	for _, tc := range []struct{ keep, want int }{{1, 1}, {2, 2}, {3, 3}, {10, 3}} {
		n, out, err := ReadPDF(three, tc.keep)
		if err != nil || n != 3 {
			t.Fatalf("ReadPDF(%d) = %d pages, %v", tc.keep, n, err)
		}
		if got := pagesOf(t, out); got != tc.want {
			t.Fatalf("ReadPDF(%d) sends %d pages, want %d", tc.keep, got, tc.want)
		}
		// With nothing to cut the file goes as it was.
		if tc.keep >= 3 && !bytes.Equal(out, three) {
			t.Fatalf("ReadPDF(%d) rewrote a PDF that needed no trimming", tc.keep)
		}
	}
}

func TestReadPDFKeepsPagesFromTheFront(t *testing.T) {
	// Each page of the fixture shows its own number; page 3 must be the one dropped.
	_, out, err := ReadPDF(pdfFixture(t, "three-pages.pdf"), 2)
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

func TestReadPDFRejectsKeepBelowOne(t *testing.T) {
	for _, keep := range []int{0, -1} {
		_, _, err := ReadPDF(pdfFixture(t, "three-pages.pdf"), keep)
		if err == nil {
			t.Fatalf("ReadPDF(%d) succeeded", keep)
		}
		if errors.Is(err, ErrUnreadable) {
			t.Fatalf("ReadPDF(%d) = %v, a caller bug is not ErrUnreadable", keep, err)
		}
	}
}

func TestEncryptedPDFIsUnreadable(t *testing.T) {
	if _, _, err := ReadPDF(pdfFixture(t, "encrypted.pdf"), 1); !errors.Is(err, ErrUnreadable) {
		t.Errorf("ReadPDF(encrypted) = %v, want ErrUnreadable", err)
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
		if _, _, err := ReadPDF(data, 1); !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: ReadPDF = %v, want ErrUnreadable", name, err)
		}
	}
}

// ownerOnlyPDF encrypts three-pages.pdf with an owner password and no user
// password: every viewer opens it without being asked for anything.
func ownerOnlyPDF(t *testing.T) []byte {
	t.Helper()
	return withOwnerPassword(t, pdfFixture(t, "three-pages.pdf"))
}

// withOwnerPassword encrypts plain with an owner password and no user
// password, object for object: nothing is merged or dropped on the way.
func withOwnerPassword(t *testing.T, plain []byte) []byte {
	t.Helper()
	conf := model.NewStatelessConfiguration()
	conf.OwnerPW = "owner"
	conf.Optimize = false
	var out bytes.Buffer
	if err := api.Encrypt(context.Background(), bytes.NewReader(plain), &out, conf); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out.Bytes(), []byte("/Encrypt")) {
		t.Fatal("fixture is not encrypted")
	}
	return out.Bytes()
}

// A PDF with only an owner password opens without one, and what is sent is
// never encrypted: trimmed or not, it is rewritten.
func TestOwnerPasswordPDFIsSentUnencrypted(t *testing.T) {
	enc := ownerOnlyPDF(t)
	for _, tc := range []struct{ keep, want int }{{2, 2}, {3, 3}, {10, 3}} {
		n, out, err := ReadPDF(enc, tc.keep)
		if err != nil || n != 3 {
			t.Fatalf("ReadPDF(%d) = %d pages, %v, want 3", tc.keep, n, err)
		}
		if bytes.Contains(out, []byte("/Encrypt")) {
			t.Errorf("ReadPDF(%d) sends an encrypted PDF", tc.keep)
		}
		if got := pagesOf(t, out); got != tc.want {
			t.Errorf("ReadPDF(%d) sends %d pages, want %d", tc.keep, got, tc.want)
		}
	}
}

func TestPDFOverTheSizeLimitIsUnreadable(t *testing.T) {
	data := make([]byte, maxPDFBytes+1)
	copy(data, pdfFixture(t, "three-pages.pdf"))
	_, _, err := ReadPDF(data, 1)
	if !errors.Is(err, ErrUnreadable) || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("ReadPDF(over the limit) = %v, want ErrUnreadable from the size limit", err)
	}
}

// pdfBuilder writes a PDF by hand, object by object, with a classic xref.
type pdfBuilder struct {
	b    bytes.Buffer
	offs map[int]int
}

func newPDFBuilder() *pdfBuilder {
	p := &pdfBuilder{offs: map[int]int{}}
	p.b.WriteString("%PDF-1.4\n")
	return p
}

func (p *pdfBuilder) obj(n int, body string) {
	p.offs[n] = p.b.Len()
	fmt.Fprintf(&p.b, "%d 0 obj\n%s\nendobj\n", n, body)
}

// finish lists entries objects in the xref (those never written are free).
func (p *pdfBuilder) finish(entries int) []byte {
	xref := p.b.Len()
	fmt.Fprintf(&p.b, "xref\n0 %d\n0000000000 65535 f \n", entries)
	for n := 1; n < entries; n++ {
		if off, ok := p.offs[n]; ok {
			fmt.Fprintf(&p.b, "%010d 00000 n \n", off)
		} else {
			p.b.WriteString("0000000000 00000 f \n")
		}
	}
	fmt.Fprintf(&p.b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", entries, xref)
	return p.b.Bytes()
}

// pdfWithXref is a valid one-page PDF whose xref lists the given number of
// entries, all but the first four free: small to write, but pdfcpu builds an
// entry for each.
func pdfWithXref(entries int) []byte {
	p := newPDFBuilder()
	p.obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	p.obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	p.obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>")
	return p.finish(entries)
}

func TestPDFClaimingTooManyObjectsIsUnreadable(t *testing.T) {
	if n, _, err := ReadPDF(pdfWithXref(maxPDFObjects), 1); err != nil || n != 1 {
		t.Fatalf("ReadPDF(at the cap) = %d, %v, want 1", n, err)
	}
	if _, _, err := ReadPDF(pdfWithXref(maxPDFObjects+1), 1); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("ReadPDF(over the cap) = %v, want ErrUnreadable", err)
	}
}

func TestPDFWorkTurnsAParserPanicIntoUnreadable(t *testing.T) {
	_, err := pdfWork(0, func(context.Context, *model.Configuration) (int, error) {
		panic("index out of range")
	})
	if !errors.Is(err, ErrUnreadable) {
		t.Fatalf("pdfWork after a panic = %v, want ErrUnreadable", err)
	}
}

func TestPDFWorkRunsUnderADeadlineOffline(t *testing.T) {
	_, err := pdfWork(0, func(ctx context.Context, conf *model.Configuration) (int, error) {
		if _, ok := ctx.Deadline(); !ok {
			t.Error("the pdfcpu context has no deadline")
		}
		if !conf.Offline {
			t.Error("pdfcpu may go online")
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
		_, _, _ = ReadPDF(data, 1)
		_, _, _ = ReadPDF(data, 5)
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
	p := newPDFBuilder()
	p.obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	p.obj(2, "<< /Type /Pages /Kids [] /Count 0 >>")
	n, _, err := ReadPDF(p.finish(3), 1)
	if !errors.Is(err, ErrUnreadable) {
		t.Errorf("ReadPDF = %d, %v, want ErrUnreadable", n, err)
	}
}
