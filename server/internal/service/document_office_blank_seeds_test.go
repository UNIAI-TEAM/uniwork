package service

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// readBlankZip opens a seed as a zip and returns its entries by name.
func readBlankZip(t *testing.T, seed []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(seed), int64(len(seed)))
	if err != nil {
		t.Fatalf("seed is not a zip: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		raw, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		if _, dup := out[f.Name]; dup {
			t.Fatalf("duplicate entry %s", f.Name)
		}
		out[f.Name] = string(raw)
	}
	return out
}

func wellFormedXML(t *testing.T, name, body string) {
	t.Helper()
	dec := xml.NewDecoder(strings.NewReader(body))
	for {
		_, err := dec.Token()
		if err == io.EOF {
			return
		}
		if err != nil {
			t.Fatalf("%s is not well-formed XML: %v", name, err)
		}
	}
}

var (
	overridePartRe = regexp.MustCompile(`PartName="([^"]+)"`)
	relTargetRe    = regexp.MustCompile(`<Relationship [^>]*Target="([^"]+)"`)
)

// assertOOXMLPackage checks the package the editors and the engine open: every
// part is well-formed XML, every Override names a part that exists, every
// relationship target resolves inside the package, and the root relationship
// points at the main part.
func assertOOXMLPackage(t *testing.T, seed []byte, mainPart, mainContentType string) {
	t.Helper()
	parts := readBlankZip(t, seed)
	for name, body := range parts {
		wellFormedXML(t, name, body)
	}
	ct, ok := parts["[Content_Types].xml"]
	if !ok {
		t.Fatal("no [Content_Types].xml")
	}
	if !strings.Contains(ct, `PartName="/`+mainPart+`" ContentType="`+mainContentType+`"`) {
		t.Fatalf("content types do not declare %s as %s", mainPart, mainContentType)
	}
	for _, m := range overridePartRe.FindAllStringSubmatch(ct, -1) {
		if _, ok := parts[strings.TrimPrefix(m[1], "/")]; !ok {
			t.Fatalf("content type override %s has no part", m[1])
		}
	}
	root := parts["_rels/.rels"]
	if !strings.Contains(root, `Target="`+mainPart+`"`) {
		t.Fatalf("root relationships do not point at %s: %s", mainPart, root)
	}
	for name, body := range parts {
		if !strings.HasSuffix(name, ".rels") {
			continue
		}
		// word/_rels/document.xml.rels resolves against word/, _rels/.rels
		// against the package root.
		base := path.Dir(path.Dir(name))
		if base == "." {
			base = ""
		}
		for _, m := range relTargetRe.FindAllStringSubmatch(body, -1) {
			if _, ok := parts[path.Join(base, m[1])]; !ok {
				t.Fatalf("%s: target %s does not exist", name, m[1])
			}
		}
	}
}

func TestBlankDOCXSeedIsAValidPackage(t *testing.T) {
	seed := blankDOCXSeed()
	if len(seed) == 0 {
		t.Fatal("docx seed is empty")
	}
	assertOOXMLPackage(t, seed, "word/document.xml",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
	parts := readBlankZip(t, seed)
	doc := parts["word/document.xml"]
	// One empty paragraph on an A4 portrait page.
	if strings.Count(doc, "<w:p/>") != 1 || strings.Contains(doc, "<w:t") {
		t.Fatalf("docx body is not one empty paragraph: %s", doc)
	}
	if !strings.Contains(doc, `<w:pgSz w:w="11906" w:h="16838"/>`) {
		t.Fatal("docx page is not A4 portrait")
	}
	// The style and numbering set the editor's generate layer references.
	styles := parts["word/styles.xml"]
	for _, id := range []string{"Normal", "Heading1", "Heading6", "ListParagraph", "Hyperlink", "TOC1", "TOC9"} {
		if !strings.Contains(styles, `w:styleId="`+id+`"`) {
			t.Fatalf("docx styles lack %s", id)
		}
	}
	numbering := parts["word/numbering.xml"]
	if !strings.Contains(numbering, `<w:num w:numId="1">`) || !strings.Contains(numbering, `<w:num w:numId="2">`) {
		t.Fatal("docx numbering lacks the bullet (1) or decimal (2) list")
	}
	if got := files.DetectContentType(seed, ""); got != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("docx seed sniffs as %q", got)
	}
	if !bytes.Equal(seed, blankDOCXSeed()) {
		t.Fatal("docx seed is not deterministic")
	}
}

func TestBlankPPTXSeedIsAValidPackage(t *testing.T) {
	seed := blankPPTXSeed()
	if len(seed) == 0 {
		t.Fatal("pptx seed is empty")
	}
	assertOOXMLPackage(t, seed, "ppt/presentation.xml",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
	parts := readBlankZip(t, seed)
	pres := parts["ppt/presentation.xml"]
	// One slide, 16:9.
	if strings.Count(pres, "<p:sldId ") != 1 || !strings.Contains(pres, `<p:sldSz cx="12192000" cy="6858000"/>`) {
		t.Fatalf("pptx is not one 16:9 slide: %s", pres)
	}
	slide := parts["ppt/slides/slide1.xml"]
	if strings.Contains(slide, "<p:sp>") || strings.Contains(slide, "<a:t>") {
		t.Fatalf("pptx slide is not blank: %s", slide)
	}
	for _, part := range []string{"ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml"} {
		if _, ok := parts[part]; !ok {
			t.Fatalf("pptx lacks %s", part)
		}
	}
	if got := files.DetectContentType(seed, ""); got != "application/vnd.openxmlformats-officedocument.presentationml.presentation" {
		t.Fatalf("pptx seed sniffs as %q", got)
	}
	if !bytes.Equal(seed, blankPPTXSeed()) {
		t.Fatal("pptx seed is not deterministic")
	}
}

func TestBlankXLSXSeedIsAValidPackage(t *testing.T) {
	assertOOXMLPackage(t, blankXLSXSeed(), "xl/workbook.xml",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
}

func TestBlankPDFSeedIsAValidDocument(t *testing.T) {
	seed := blankPDFSeed()
	if !bytes.HasPrefix(seed, []byte("%PDF-1.4\n")) || !bytes.HasSuffix(seed, []byte("%%EOF\n")) {
		t.Fatalf("pdf header or trailer is wrong: %q ... %q", seed[:9], seed[len(seed)-6:])
	}
	if got := files.DetectContentType(seed, ""); got != "application/pdf" {
		t.Fatalf("pdf seed sniffs as %q", got)
	}
	// startxref points at the xref table, and every xref entry points at its
	// "N 0 obj" line.
	startRe := regexp.MustCompile(`startxref\n(\d+)\n%%EOF\n$`)
	m := startRe.FindSubmatch(seed)
	if m == nil {
		t.Fatal("no startxref")
	}
	xrefAt, _ := strconv.Atoi(string(m[1]))
	if !bytes.HasPrefix(seed[xrefAt:], []byte("xref\n0 5\n")) {
		t.Fatalf("startxref %d does not point at the xref table", xrefAt)
	}
	entries := regexp.MustCompile(`(?m)^(\d{10}) 00000 n $`).FindAllSubmatch(seed[xrefAt:], -1)
	if len(entries) != 4 {
		t.Fatalf("xref has %d in-use entries, want 4", len(entries))
	}
	for i, e := range entries {
		off, _ := strconv.Atoi(string(e[1]))
		if want := strconv.Itoa(i+1) + " 0 obj\n"; !bytes.HasPrefix(seed[off:], []byte(want)) {
			t.Fatalf("xref entry %d points at %q, want %q", i+1, seed[off:off+len(want)], want)
		}
	}
	trailer := string(seed[xrefAt:])
	if !strings.Contains(trailer, "/Size 5") || !strings.Contains(trailer, "/Root 1 0 R") {
		t.Fatalf("trailer is wrong: %s", trailer)
	}
	// One page, A4, empty content stream.
	text := string(seed)
	if !strings.Contains(text, "/Count 1") || !strings.Contains(text, "/MediaBox [0 0 595 842]") {
		t.Fatal("pdf is not one A4 page")
	}
	if !bytes.Equal(seed, blankPDFSeed()) {
		t.Fatal("pdf seed is not deterministic")
	}
}
