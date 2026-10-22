package attachtext

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func zipOf(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(f, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func extract(mime string, data []byte) (Doc, error) {
	return Extract(mime, bytes.NewReader(data), int64(len(data)))
}

func mustExtract(t *testing.T, mime string, data []byte) Doc {
	t.Helper()
	d, err := extract(mime, data)
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	return d
}

func texts(d Doc) []string {
	var out []string
	for _, p := range d.Parts {
		out = append(out, p.Label+"|"+p.Text)
	}
	return out
}

func wantParts(t *testing.T, d Doc, unit string, want ...string) {
	t.Helper()
	if d.Unit != unit {
		t.Errorf("Unit = %q, want %q", d.Unit, unit)
	}
	got := texts(d)
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("Parts = %q, want %q", got, want)
	}
}

func TestExtractDocxKeepsParagraphsAndTables(t *testing.T) {
	const w = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`
	body := `<?xml version="1.0" encoding="UTF-8"?><w:document ` + w + `><w:body>` +
		`<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Mở</w:t></w:r><w:r><w:t xml:space="preserve"> đầu</w:t></w:r></w:p>` +
		`<w:p/>` +
		`<w:tbl><w:tr>` +
		`<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
		`<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
		`</w:tr></w:tbl>` +
		`<w:p><w:r><w:t>Kết luận</w:t></w:r><w:del><w:r><w:delText>đã xóa</w:delText></w:r></w:del></w:p>` +
		// A text box is written twice (DrawingML choice, VML fallback): read it once.
		`<w:p><mc:AlternateContent><mc:Choice><w:r><w:t>Hộp</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>Hộp</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>` +
		`</w:body></w:document>`
	d := mustExtract(t, mimeDOCX, zipOf(t, map[string]string{"word/document.xml": body}))
	wantParts(t, d, "paragraph", "|Mở đầu", "|A | B", "|Kết luận", "|Hộp")
}

func TestExtractDocxFoldsNestedTablesIntoTheirCell(t *testing.T) {
	const w = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	cell := func(s string) string { return `<w:tc><w:p><w:r><w:t>` + s + `</w:t></w:r></w:p></w:tc>` }
	body := `<w:document ` + w + `><w:body><w:tbl><w:tr>` +
		`<w:tc><w:p><w:r><w:t>Ngoài</w:t></w:r></w:p><w:tbl><w:tr>` + cell("x") + cell("y") + `</w:tr></w:tbl></w:tc>` +
		cell("Z") + `</w:tr></w:tbl></w:body></w:document>`
	d := mustExtract(t, mimeDOCX, zipOf(t, map[string]string{"word/document.xml": body}))
	wantParts(t, d, "paragraph", "|Ngoài x y | Z")
}

func TestExtractPptxOrdersSlidesByNumber(t *testing.T) {
	slide := func(lines ...string) string {
		s := `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>`
		for _, l := range lines {
			s += `<a:p><a:r><a:t>` + l + `</a:t></a:r></a:p>`
		}
		return s + `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
	}
	d := mustExtract(t, mimePPTX, zipOf(t, map[string]string{
		"ppt/slides/slide10.xml": slide("Mười"),
		"ppt/slides/slide2.xml":  slide("Hai"),
		"ppt/slides/slide1.xml":  slide("Tiêu đề", "Ý chính"),
		"ppt/slides/slide3.xml":  slide(), // a picture-only slide has nothing to read
	}))
	wantParts(t, d, "slide", "Slide 1|Tiêu đề\nÝ chính", "Slide 2|Hai", "Slide 10|Mười")
}

const (
	xlsxWorkbook = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Doanh thu" sheetId="1" r:id="rId1"/></sheets></workbook>`
	xlsxRels     = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
	xlsxStrings  = `<sst><si><t>Tên</t></si><si><r><t>Ghi </t></r><r><t>chú</t></r><rPh><t>furigana</t></rPh></si></sst>`
	xlsxSheet    = `<worksheet><sheetData>` +
		`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12</v></c><c r="C1" t="s"><v>1</v></c></row>` +
		`<row r="2"><c r="A2" t="inlineStr"><is><t>Nội tuyến</t></is></c><c r="C2" t="b"><v>1</v></c></row>` +
		`<row r="3"><c r="A3" s="1"/></row>` +
		`</sheetData></worksheet>`
)

func xlsxOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	m := map[string]string{
		"xl/workbook.xml":            xlsxWorkbook,
		"xl/_rels/workbook.xml.rels": xlsxRels,
		"xl/sharedStrings.xml":       xlsxStrings,
		"xl/worksheets/sheet1.xml":   xlsxSheet,
	}
	for k, v := range files {
		if v == "" {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	return zipOf(t, m)
}

func TestExtractXlsxReadsSharedAndInlineStrings(t *testing.T) {
	d := mustExtract(t, mimeXLSX, xlsxOf(t, nil))
	// The empty B2 keeps its column; the blank styled row 3 is dropped.
	wantParts(t, d, "row", "Doanh thu|", "|Tên | 12 | Ghi chú", "|Nội tuyến |  | TRUE")
}

func TestExtractOdtParagraphs(t *testing.T) {
	body := `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:body><office:text>` +
		`<text:h text:outline-level="1">Tiêu đề</text:h>` +
		`<text:p>Đoạn <text:span>một</text:span><text:s/>hai<office:annotation><dc:creator>Ai đó</dc:creator><text:p>ghi chú bên lề</text:p></office:annotation></text:p>` +
		`<text:p/>` +
		`</office:text></office:body></office:document-content>`
	d := mustExtract(t, mimeODT, zipOf(t, map[string]string{"content.xml": body}))
	wantParts(t, d, "paragraph", "|Tiêu đề", "|Đoạn một hai")
}

func TestExtractPlainReplacesInvalidUTF8(t *testing.T) {
	d := mustExtract(t, "text/csv", []byte("Gi\xe1 tr\xef"))
	if d.Unit != "line" || len(d.Parts) != 1 || !strings.Contains(d.Parts[0].Text, "\uFFFD") {
		t.Fatalf("got %+v", d)
	}
}

func TestExtractPlainKeepsLinesWithoutTheBOMOrTrailingNewline(t *testing.T) {
	d := mustExtract(t, "text/markdown", []byte("\uFEFF# Một\r\n\r\n  hai\r\n"))
	wantParts(t, d, "line", "|# Một", "|", "|  hai")
	if d := mustExtract(t, "text/plain", nil); len(d.Parts) != 0 {
		t.Errorf("empty file: %+v", d)
	}
}

func TestExtractCorruptZipIsUnreadable(t *testing.T) {
	junk := bytes.Repeat([]byte("không phải zip "), 40)
	for _, mime := range []string{mimeDOCX, mimePPTX, mimeXLSX, mimeODT} {
		if _, err := extract(mime, junk); !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: err = %v, want ErrUnreadable", mime, err)
		}
	}
}

func TestExtractMissingOrMalformedPartIsUnreadable(t *testing.T) {
	cases := []struct {
		name string
		mime string
		zip  []byte
	}{
		{"docx without document.xml", mimeDOCX, zipOf(t, map[string]string{"x": "y"})},
		{"docx truncated xml", mimeDOCX, zipOf(t, map[string]string{"word/document.xml": `<w:document xmlns:w="u"><w:body><w:p>`})},
		{"docx empty xml", mimeDOCX, zipOf(t, map[string]string{"word/document.xml": ""})},
		{"pptx without slides", mimePPTX, zipOf(t, map[string]string{"x": "y"})},
		{"odt without content.xml", mimeODT, zipOf(t, map[string]string{"x": "y"})},
		{"xlsx without workbook", mimeXLSX, xlsxOf(t, map[string]string{"xl/workbook.xml": ""})},
		{"xlsx sheet part missing", mimeXLSX, xlsxOf(t, map[string]string{"xl/worksheets/sheet1.xml": ""})},
		{"xlsx shared string out of range", mimeXLSX, xlsxOf(t, map[string]string{"xl/sharedStrings.xml": `<sst><si><t>a</t></si></sst>`})},
	}
	for _, c := range cases {
		if _, err := extract(c.mime, c.zip); !errors.Is(err, ErrUnreadable) {
			t.Errorf("%s: err = %v, want ErrUnreadable", c.name, err)
		}
	}
}

func TestExtractUnsupportedMIMEIsACallerError(t *testing.T) {
	_, err := extract("application/pdf", []byte("x"))
	if err == nil || errors.Is(err, ErrUnreadable) {
		t.Fatalf("err = %v, want a non-ErrUnreadable error", err)
	}
}

// padded writes prefix, n MiB of spaces, then suffix as one zip entry.
func padded(t *testing.T, w *zip.Writer, name, prefix string, mib int, suffix string) {
	t.Helper()
	f, err := w.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	chunk := bytes.Repeat([]byte(" "), 1<<20)
	_, _ = io.WriteString(f, prefix)
	for i := 0; i < mib; i++ {
		_, _ = f.Write(chunk)
	}
	_, _ = io.WriteString(f, suffix)
}

func TestExtractRefusesAZipBomb(t *testing.T) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	padded(t, w, "word/document.xml", `<w:document xmlns:w="u"><w:body>`, 70, `</w:body></w:document>`)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := extract(mimeDOCX, buf.Bytes()); !errors.Is(err, ErrUnreadable) {
		t.Fatalf("err = %v, want ErrUnreadable", err)
	}
}

// The cap bounds everything one file may decompress to, not each entry on its
// own: two 40 MiB entries are refused, two 1 MiB entries are read.
func TestExtractCountsDecompressedBytesAcrossEntries(t *testing.T) {
	build := func(mib int) []byte {
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		for name, body := range map[string]string{"xl/workbook.xml": xlsxWorkbook, "xl/_rels/workbook.xml.rels": xlsxRels} {
			f, _ := w.Create(name)
			_, _ = io.WriteString(f, body)
		}
		padded(t, w, "xl/sharedStrings.xml", `<sst>`, mib, `</sst>`)
		padded(t, w, "xl/worksheets/sheet1.xml", `<worksheet><sheetData>`, mib, `</sheetData></worksheet>`)
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	if _, err := extract(mimeXLSX, build(1)); err != nil {
		t.Fatalf("small pair: %v", err)
	}
	_, err := extract(mimeXLSX, build(40))
	if !errors.Is(err, ErrUnreadable) || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("err = %v, want ErrUnreadable over the limit", err)
	}
}

func partsOf(n, runes int) []Part {
	ps := make([]Part, n)
	for i := range ps {
		ps[i] = Part{Text: string(rune('a'+i)) + strings.Repeat("x", runes-1)}
	}
	return ps
}

func TestFitStopsAtWholeParts(t *testing.T) {
	d := Doc{Unit: "paragraph", Parts: partsOf(10, 300)} // ~100 tokens each
	text, read, total := Fit(d, 350)
	if read != 3 || total != 10 {
		t.Fatalf("read, total = %d, %d, want 3, 10", read, total)
	}
	if !strings.HasPrefix(text, d.Parts[0].Text+"\n"+d.Parts[1].Text) || !strings.Contains(text, d.Parts[2].Text) || strings.Contains(text, d.Parts[3].Text) {
		t.Errorf("text is not the first three whole parts: %q", text)
	}
}

func TestFitReadsAllWhenItFits(t *testing.T) {
	d := Doc{Unit: "line", Parts: partsOf(4, 30)}
	text, read, total := Fit(d, 1000)
	if read != 4 || total != 4 || strings.Count(text, "\n") != 3 {
		t.Fatalf("read, total = %d, %d, text %q", read, total, text)
	}
}

func TestFitHeadingsAreFreeAndDanglingOnesAreDropped(t *testing.T) {
	d := Doc{Unit: "row", Parts: []Part{
		{Label: "Một"}, {Text: "a1"}, {Text: "a2"},
		{Label: "Hai"}, {Text: strings.Repeat("b", 3000)},
	}}
	text, read, total := Fit(d, 50)
	if read != 2 || total != 3 {
		t.Fatalf("read, total = %d, %d, want 2, 3", read, total)
	}
	if text != "## Một\na1\na2" {
		t.Errorf("text = %q", text)
	}
	d = Doc{Unit: "slide", Parts: []Part{{Label: "Slide 1", Text: "Tiêu đề"}}}
	if text, _, _ := Fit(d, 50); text != "Slide 1\nTiêu đề" {
		t.Errorf("slide text = %q", text)
	}
}

func TestEstimateTokens(t *testing.T) {
	for s, want := range map[string]int{"": 0, "a": 1, "abc": 1, "abcd": 2, "ắắắắắắ": 2} {
		if got := EstimateTokens(s); got != want {
			t.Errorf("EstimateTokens(%q) = %d, want %d", s, got, want)
		}
	}
}
