package service

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/attachtext"
)

const planDocxMIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// planTextFile is a text/plain file of lines non-blank lines of runes runes
// each, so it reads as about lines*runes/3 tokens and one line is one part.
func planTextFile(name string, lines, runes int) askFileBytes {
	return planTextBody(name, strings.TrimSuffix(strings.Repeat(strings.Repeat("a", runes)+"\n", lines), "\n"))
}

func planTextBody(name, body string) askFileBytes {
	return askFileBytes{
		AskAttachment: AskAttachment{Name: name, MIME: "text/plain", Kind: "text", Size: int64(len(body))},
		Body:          []byte(body),
	}
}

func planPDFFile(name string, body []byte) askFileBytes {
	return askFileBytes{
		AskAttachment: AskAttachment{Name: name, MIME: "application/pdf", Kind: "pdf", Size: int64(len(body))},
		Body:          body,
	}
}

// pdfOfPages writes a valid PDF of n empty pages by hand, so a test needs no
// large fixture.
func pdfOfPages(n int) []byte { return paddedPDF(n, -1) }

// pdfOfSize is pdfOfPages padded by a comment line to exactly size bytes, or
// left at its own size when that is larger.
func pdfOfSize(n, size int) []byte {
	pad := 0
	b := paddedPDF(n, pad)
	// Later passes absorb a startxref that grew a digit with the padding.
	for range 3 {
		if d := size - len(b); d != 0 && pad+d >= 0 {
			pad += d
			b = paddedPDF(n, pad)
		}
	}
	if len(b) > size {
		return pdfOfPages(n)
	}
	return b
}

// paddedPDF writes the PDF with a comment line of pad bytes after its header
// (none for pad < 0); the offsets are taken as written, so it stays valid.
func paddedPDF(n, pad int) []byte {
	var b bytes.Buffer
	var offs []int
	obj := func(body string) {
		offs = append(offs, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", len(offs), body)
	}
	b.WriteString("%PDF-1.4\n")
	if pad >= 0 {
		b.WriteString("%" + strings.Repeat("x", pad) + "\n")
	}
	obj("<< /Type /Catalog /Pages 2 0 R >>")
	kids := make([]string, n)
	for i := range kids {
		kids[i] = fmt.Sprintf("%d 0 R", i+3)
	}
	obj(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	for range n {
		obj("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>")
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offs)+1)
	for _, o := range offs {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offs)+1, xref)
	return b.Bytes()
}

func planTokens(t *testing.T, p askFilePlan, i int) int {
	t.Helper()
	if i >= len(p.Texts) {
		t.Fatalf("plan has %d texts, want one at %d", len(p.Texts), i)
	}
	return attachtext.EstimateTokens(p.Texts[i].Text)
}

func mustPlan(t *testing.T, files []askFileBytes, budget int) askFilePlan {
	t.Helper()
	p, err := planAskFiles(files, budget)
	if err != nil {
		t.Fatalf("planAskFiles: %v", err)
	}
	return p
}

func TestPlanAskFilesSplitsTheShareInAttachOrder(t *testing.T) {
	// Three files of about 20,000 tokens each (200 lines of 100 tokens).
	files := []askFileBytes{planTextFile("a.txt", 200, 300), planTextFile("b.txt", 200, 300), planTextFile("c.txt", 200, 300)}
	p := mustPlan(t, files, askFileTokenShare)
	if len(p.Texts) != 3 || len(p.Notes) != 3 || len(p.Parts) != 0 {
		t.Fatalf("plan = %d texts, %d notes, %d parts; want 3, 3, 0", len(p.Texts), len(p.Notes), len(p.Parts))
	}
	total := 0
	for i, f := range files {
		if p.Texts[i].Name != f.Name || p.Notes[i].Name != f.Name {
			t.Errorf("file %d: text %q, note %q, want attach order", i, p.Texts[i].Name, p.Notes[i].Name)
		}
		n := p.Notes[i]
		if n.Unit != "line" || n.Total != 200 || n.Read < 90 || n.Read > 100 {
			t.Errorf("note %d = %+v, want about a third of the 200 lines", i, n)
		}
		tok := planTokens(t, p, i)
		if tok < 9_000 || tok > 10_100 {
			t.Errorf("file %d: %d tokens, want about 10,000", i, tok)
		}
		total += tok
	}
	if total > askFileTokenShare+100 {
		t.Errorf("files take %d tokens of a %d share", total, askFileTokenShare)
	}
}

func TestPlanAskFilesGivesUnusedShareToLaterFiles(t *testing.T) {
	small := planTextFile("nhỏ.txt", 10, 300) // about 1,000 tokens
	big := planTextFile("lớn.txt", 400, 300)  // about 40,000 tokens
	p := mustPlan(t, []askFileBytes{small, big}, askFileTokenShare)
	if len(p.Notes) != 1 || p.Notes[0].Name != "lớn.txt" {
		t.Fatalf("notes = %+v, want one, for the big file", p.Notes)
	}
	if tok := planTokens(t, p, 1); tok < 28_000 {
		t.Errorf("the second file read %d tokens; a plain half share would be 15,000, want about 29,000", tok)
	}
}

func TestPlanAskFilesTrimsALongPDF(t *testing.T) {
	p := mustPlan(t, []askFileBytes{planPDFFile("bao-cao.pdf", pdfOfPages(80))}, askFileTokenShare)
	if len(p.Parts) != 1 || p.Parts[0].MIME != "application/pdf" || len(p.Texts) != 0 {
		t.Fatalf("plan = %+v, want one PDF part", p)
	}
	if n, err := attachtext.PDFPages(bytes.NewReader(p.Parts[0].Data)); err != nil || n != 15 {
		t.Fatalf("the PDF sent has %d pages (%v), want 15", n, err)
	}
	want := askFileNote{Name: "bao-cao.pdf", Unit: "page", Read: 15, Total: 80}
	if len(p.Notes) != 1 || p.Notes[0] != want {
		t.Fatalf("notes = %+v, want %+v", p.Notes, want)
	}
}

func TestPlanAskFilesNoNoteWhenEverythingFits(t *testing.T) {
	three, err := os.ReadFile("../attachtext/testdata/three-pages.pdf")
	if err != nil {
		t.Fatal(err)
	}
	p := mustPlan(t, []askFileBytes{planTextFile("a.txt", 5, 90), planPDFFile("ba-trang.pdf", three)}, askFileTokenShare)
	if len(p.Notes) != 0 {
		t.Fatalf("notes = %+v, want none: everything was read", p.Notes)
	}
	if len(p.Texts) != 1 || !strings.HasPrefix(p.Texts[0].Text, "aaa") {
		t.Fatalf("texts = %+v", p.Texts)
	}
	if len(p.Parts) != 1 || !bytes.Equal(p.Parts[0].Data, three) {
		t.Fatalf("a PDF that fits must go to the model as it came")
	}
}

func TestPlanAskFilesSendsImagesAsParts(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nnot really a picture")
	img := askFileBytes{AskAttachment: AskAttachment{Name: "ảnh.png", MIME: "image/png", Kind: "image", Size: int64(len(png))}, Body: png}
	p := mustPlan(t, []askFileBytes{img}, askFileTokenShare)
	if len(p.Parts) != 1 || p.Parts[0].MIME != "image/png" || !bytes.Equal(p.Parts[0].Data, png) {
		t.Fatalf("parts = %+v, want the picture as image/png", p.Parts)
	}
	if len(p.Texts) != 0 || len(p.Notes) != 0 {
		t.Fatalf("an image has no text and is never partly read: %+v", p)
	}
}

func TestPlanAskFilesChargesAnImageItsFixedCost(t *testing.T) {
	img := askFileBytes{AskAttachment: AskAttachment{Name: "a.png", MIME: "image/png", Kind: "image"}, Body: []byte("png")}
	p := mustPlan(t, []askFileBytes{img, planTextFile("b.txt", 400, 300)}, askFileTokenShare)
	if tok := planTokens(t, p, 0); tok > askFileTokenShare-askImageTokens+100 || tok < askFileTokenShare-askImageTokens-1_000 {
		t.Errorf("text read %d tokens beside one image, want about %d", tok, askFileTokenShare-askImageTokens)
	}
	// An image cannot be read in part: with nothing left it is still sent.
	p = mustPlan(t, []askFileBytes{img, img, planTextFile("b.txt", 400, 300)}, askImageTokens/2)
	if len(p.Parts) != 2 || len(p.Texts) != 1 || p.Texts[0].Text != "" {
		t.Fatalf("plan = %d parts, texts %+v; want both images sent and no room for text", len(p.Parts), p.Texts)
	}
}

func TestPlanAskFilesUnreadableNamesTheFile(t *testing.T) {
	junk := bytes.Repeat([]byte("không phải zip "), 40)
	encrypted, err := os.ReadFile("../attachtext/testdata/encrypted.pdf")
	if err != nil {
		t.Fatal(err)
	}
	for name, f := range map[string]askFileBytes{
		"hong.docx":    {AskAttachment: AskAttachment{Name: "hong.docx", MIME: planDocxMIME, Kind: "text"}, Body: junk},
		"mat-khau.pdf": planPDFFile("mat-khau.pdf", encrypted),
	} {
		_, err := planAskFiles([]askFileBytes{planTextFile("ok.txt", 1, 10), f}, askFileTokenShare)
		if !errors.Is(err, ai.ErrAttachmentUnreadable) {
			t.Fatalf("%s: err = %v, want ai_attachment_unreadable", name, err)
		}
		var ae *ai.Error
		if !errors.As(err, &ae) || ae.Status != 422 || !strings.Contains(ae.Msg, name) {
			t.Errorf("%s: %+v, want a 422 whose message names the file", name, ae)
		}
		if !errors.Is(err, attachtext.ErrUnreadable) {
			t.Errorf("%s: the cause was lost: %v", name, err)
		}
	}
}

func TestPlanAskFilesUnsupportedMIMEIsACallerError(t *testing.T) {
	f := askFileBytes{AskAttachment: AskAttachment{Name: "x.doc", MIME: "application/msword", Kind: "text"}, Body: []byte("x")}
	_, err := planAskFiles([]askFileBytes{f}, askFileTokenShare)
	if err == nil || errors.Is(err, ai.ErrAttachmentUnreadable) {
		t.Fatalf("err = %v, want a plain error, not ai_attachment_unreadable", err)
	}
}

// A text file whose first part alone is bigger than its share still gives the
// model its opening, cut to the share, and the note says nothing was read whole.
func TestPlanAskFilesCutsAFirstPartThatIsBiggerThanTheShare(t *testing.T) {
	body := strings.Repeat("ế", 100_000) + "\nđoạn sau"
	p := mustPlan(t, []askFileBytes{planTextBody("dài.txt", body)}, 1_000)
	want := askFileNote{Name: "dài.txt", Unit: "line", Read: 0, Total: 2}
	if len(p.Notes) != 1 || p.Notes[0] != want {
		t.Fatalf("notes = %+v, want %+v", p.Notes, want)
	}
	if got := utf8.RuneCountInString(p.Texts[0].Text); got != 3_000 {
		t.Fatalf("text has %d runes, want 3,000 (a 1,000-token share)", got)
	}
}

func TestPlanAskFilesTrimsAPDFToAtLeastOnePage(t *testing.T) {
	// Two files share 3,000 tokens: 1,500 each is under one page, but a PDF is never sent with none.
	p := mustPlan(t, []askFileBytes{planPDFFile("a.pdf", pdfOfPages(5)), planPDFFile("b.pdf", pdfOfPages(5))}, 3_000)
	if len(p.Parts) != 2 {
		t.Fatalf("parts = %d, want 2", len(p.Parts))
	}
	for i, part := range p.Parts {
		if n, err := attachtext.PDFPages(bytes.NewReader(part.Data)); err != nil || n != 1 {
			t.Errorf("part %d has %d pages (%v), want 1", i, n, err)
		}
	}
	if len(p.Notes) != 2 || p.Notes[1] != (askFileNote{Name: "b.pdf", Unit: "page", Read: 1, Total: 5}) {
		t.Errorf("notes = %+v", p.Notes)
	}
}
