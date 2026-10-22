package attachtext

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"errors"
	"hash/crc32"
	"io"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

const wNS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`

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

func TestExtractPlainKeepsNonBlankLinesWithoutTheBOM(t *testing.T) {
	d := mustExtract(t, "text/markdown", []byte("\uFEFF# Một\r\n\r\n  hai\r\n"))
	wantParts(t, d, "line", "|# Một", "|  hai") // the blank line is dropped, indentation kept
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

// padded writes prefix, n MiB of spaces in 1 MiB runs, then suffix as one zip entry.
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
		_, _ = io.WriteString(f, "<x/>") // keeps every run of spaces under the text-run limit
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
	if !errors.Is(err, ErrUnreadable) || !strings.Contains(err.Error(), "decompressed") {
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

// wantRefused checks an Office zip is refused as unreadable for the reason the
// error text names.
func wantRefused(t *testing.T, mime string, data []byte, reason string) {
	t.Helper()
	_, err := extract(mime, data)
	if !errors.Is(err, ErrUnreadable) || !strings.Contains(err.Error(), reason) {
		t.Fatalf("err = %v, want ErrUnreadable mentioning %q", err, reason)
	}
}

func docxOf(t *testing.T, body string) []byte {
	t.Helper()
	return zipOf(t, map[string]string{"word/document.xml": `<w:document ` + wNS + `><w:body>` + body + `</w:body></w:document>`})
}

// The limits below stop a small file from blowing up in memory once parsed;
// each test feeds the refusal a payload that is small itself.

func TestExtractRefusesDeepXMLNesting(t *testing.T) {
	wantRefused(t, mimeDOCX, docxOf(t, strings.Repeat("<w:sdt>", 1_000_000)), "nested")
	// Real documents nest a few dozen levels at most.
	ok := strings.Repeat("<w:sdt>", 50) + `<w:p><w:r><w:t>sâu</w:t></w:r></w:p>` + strings.Repeat("</w:sdt>", 50)
	wantParts(t, mustExtract(t, mimeDOCX, docxOf(t, ok)), "paragraph", "|sâu")
}

func TestExtractRefusesAnOverLongTag(t *testing.T) {
	for _, attrs := range []string{
		strings.Repeat(` b=""`, 200_000),
		strings.Repeat(` b=">"`, 200_000), // a '>' in a value must not end the tag early
		` b='` + strings.Repeat("x", 100_000) + `'`,
	} {
		wantRefused(t, mimeDOCX, docxOf(t, `<w:p `+attrs+`/>`), "tag")
	}
	// '>' in a value and an odd quote in a comment or CDATA are fine in short tags.
	ok := `<!-- don't --><w:p w:x="a>b"><w:r><w:t><![CDATA[it's "ok"]]></w:t></w:r></w:p>` +
		`<w:p><w:r><w:t>sau</w:t></w:r></w:p>`
	wantParts(t, mustExtract(t, mimeDOCX, docxOf(t, ok)), "paragraph", `|it's "ok"`, "|sau")
}

func TestExtractRefusesAnOverLongRunOfText(t *testing.T) {
	long := strings.Repeat("a", 5<<20)
	wantRefused(t, mimeDOCX, docxOf(t, `<w:p><w:r><w:t>`+long+`</w:t></w:r></w:p>`), "text")
	wantRefused(t, mimeDOCX, docxOf(t, `<!--`+long+`--><w:p/>`), "text")
	wantRefused(t, mimeDOCX, docxOf(t, `<w:p><w:r><w:t><![CDATA[`+long+`]]></w:t></w:r></w:p>`), "text")
	wantRefused(t, mimeXLSX, sheetOf(t, `<row><c t="inlineStr"><is><t>`+long+`</t></is></c></row>`, nil), "text")
	// A paragraph of 1 MiB is long but real.
	one := strings.Repeat("a", 1<<20)
	d := mustExtract(t, mimeDOCX, docxOf(t, `<w:p><w:r><w:t>`+one+`</w:t></w:r></w:p>`))
	if len(d.Parts) != 1 || len(d.Parts[0].Text) != 1<<20 {
		t.Fatalf("1 MiB paragraph: %d parts", len(d.Parts))
	}
}

func TestExtractDocxRefusesWideTableRows(t *testing.T) {
	row := `<w:tbl><w:tr>` + strings.Repeat("<w:tc/>", 20_000) + `</w:tr></w:tbl>`
	wantRefused(t, mimeDOCX, docxOf(t, row), "wider")
}

func sheetOf(t *testing.T, sheetData string, files map[string]string) []byte {
	t.Helper()
	m := map[string]string{"xl/worksheets/sheet1.xml": `<worksheet><sheetData>` + sheetData + `</sheetData></worksheet>`}
	for k, v := range files {
		m[k] = v
	}
	return xlsxOf(t, m)
}

func TestExtractXlsxRefusesWideRows(t *testing.T) {
	// Cells without a reference are placed one after another; no row is wider than Excel's.
	wantRefused(t, mimeXLSX, sheetOf(t, `<row>`+strings.Repeat("<c/>", 20_000)+`</row>`, nil), "wider")
}

func TestExtractXlsxRefusesATooLargeSharedStringTable(t *testing.T) {
	files := map[string]string{"xl/sharedStrings.xml": `<sst>` + strings.Repeat("<si/>", 5_000_000) + `</sst>`}
	wantRefused(t, mimeXLSX, sheetOf(t, `<row><c><v>1</v></c></row>`, files), "limit")
}

func TestExtractXlsxCutsOffASharedStringRepeatedIntoAHugeRow(t *testing.T) {
	files := map[string]string{"xl/sharedStrings.xml": `<sst><si><t>` + strings.Repeat("x", 100<<10) + `</t></si></sst>`}
	const cell = `<c t="s"><v>0</v></c>`
	data := sheetOf(t, `<row>`+strings.Repeat(cell, 1500)+`</row>`, files) // 150 MiB once expanded

	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	wantRefused(t, mimeXLSX, data, "limit")
	runtime.ReadMemStats(&after)
	// The row is refused when it passes the budget, not after it is built.
	if got := after.TotalAlloc - before.TotalAlloc; got > 100<<20 {
		t.Errorf("allocated %d MiB before refusing the row", got>>20)
	}
	// One use of the same string is an ordinary cell.
	d := mustExtract(t, mimeXLSX, sheetOf(t, `<row>`+cell+`</row>`, files))
	if len(d.Parts) != 2 || len(d.Parts[1].Text) != 100<<10 {
		t.Fatalf("one use: %+v", d.Parts)
	}
}

func TestExtractPlainDropsBlankLinesInsteadOfKeepingThem(t *testing.T) {
	blank := mustExtract(t, "text/plain", bytes.Repeat([]byte("\n"), 20<<20))
	if len(blank.Parts) != 0 {
		t.Fatalf("%d parts from a file of newlines", len(blank.Parts))
	}
	// A real CSV of 100k rows still reads whole.
	var csv strings.Builder
	for i := 0; i < 100_000; i++ {
		csv.WriteString("2026-10-22,Khách hàng số 12345,1250000,đã thanh toán\n\n")
	}
	if d := mustExtract(t, "text/csv", []byte(csv.String())); len(d.Parts) != 100_000 {
		t.Fatalf("%d parts, want 100000", len(d.Parts))
	}
}

// A valid file is never refused for its line count: the first lines are kept
// and the rest only counted, so the user can be told how much was read.
func TestExtractPlainReadsAPrefixOfAFileWithManyShortLines(t *testing.T) {
	const rows = 2_000_000
	d := mustExtract(t, "text/csv", bytes.Repeat([]byte("12,34,x\n\n"), rows)) // 18 MiB, a blank line after each row
	if len(d.Parts) == 0 || len(d.Parts) >= rows || d.Omitted == 0 || len(d.Parts)+d.Omitted != rows {
		t.Fatalf("kept %d, omitted %d, want them to add up to %d with some omitted", len(d.Parts), d.Omitted, rows)
	}
	if d.Parts[0].Text != "12,34,x" || d.Parts[len(d.Parts)-1].Text != "12,34,x" {
		t.Fatalf("kept parts are not the lines of the file: %+v ... %+v", d.Parts[0], d.Parts[len(d.Parts)-1])
	}
	text, read, total := Fit(d, 1000) // 3 tokens a line
	if read != 333 || total != rows || strings.Count(text, "\n") != 332 {
		t.Fatalf("read, total = %d, %d, want 333, %d", read, total, rows)
	}
}

func TestFitCountsOmittedPartsInTotal(t *testing.T) {
	text, read, total := Fit(Doc{Unit: "line", Parts: []Part{{Text: "a"}}, Omitted: 41}, 100)
	if text != "a" || read != 1 || total != 42 {
		t.Fatalf("text, read, total = %q, %d, %d", text, read, total)
	}
}

func TestCollapseSpace(t *testing.T) {
	for in, want := range map[string]string{"": "", "  \t\n ": "", "a": "a", " a \t\n b  c\u00a0d ": "a b c d"} {
		if got := collapseSpace(in); got != want {
			t.Errorf("collapseSpace(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExtractXlsxCollapsesWhiteSpaceInCells(t *testing.T) {
	files := map[string]string{"xl/sharedStrings.xml": "<sst><si><t> Ghi \n  chú </t></si></sst>"}
	row := `<row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>a  b</t></is></c></row>`
	wantParts(t, mustExtract(t, mimeXLSX, sheetOf(t, row, files)), "row", "Doanh thu|", "|Ghi chú | a b")
}

// Work per cell is bounded by the cell's own bytes. Without it these two files
// take several seconds each (a shared string of white space was rescanned for
// every cell that used it; a cell in column XFD made its row build 16384 slots).
func TestExtractXlsxDoesNotRepeatWorkPerCell(t *testing.T) {
	// 4 MiB of white space in runs of 1 MiB, each under the text-run limit.
	spaces := map[string]string{"xl/sharedStrings.xml": `<sst><si>` + strings.Repeat(`<r><t>`+strings.Repeat(" ", 1<<20)+`</t></r>`, 4) + `</si></sst>`}
	cases := map[string][]byte{
		"white-space shared string": sheetOf(t, strings.Repeat(`<row><c t="s"><v>0</v></c></row>`, 2000), spaces),
		"empty cell in column XFD":  sheetOf(t, strings.Repeat(`<row><c r="XFD1"/></row>`, 100_000), nil),
	}
	for name, data := range cases {
		start := time.Now()
		d, err := extract(mimeXLSX, data)
		if err != nil || len(d.Parts) != 0 {
			t.Errorf("%s: %d parts, err %v", name, len(d.Parts), err)
		}
		if took := time.Since(start); took > 1500*time.Millisecond {
			t.Errorf("%s took %v", name, took)
		}
	}
}

func TestExtractXlsxRefusesAHugeSheetList(t *testing.T) {
	wb := `<workbook xmlns="x"><sheets>` + strings.Repeat("<sheet/>", 1_200_000) + `</sheets></workbook>`
	wantRefused(t, mimeXLSX, xlsxOf(t, map[string]string{"xl/workbook.xml": wb}), "limit")
}

func TestExtractXlsxRefusesAHugeRelationshipTable(t *testing.T) {
	rels := `<Relationships xmlns="x">` + strings.Repeat("<Relationship/>", 600_000) + `</Relationships>`
	wantRefused(t, mimeXLSX, xlsxOf(t, map[string]string{"xl/_rels/workbook.xml.rels": rels}), "limit")
}

// A workbook with a few hundred sheets is ordinary and is not caught by those limits.
func TestExtractXlsxReadsManySheets(t *testing.T) {
	var sheets, rels strings.Builder
	for i := 0; i < 200; i++ {
		id := "rId" + strconv.Itoa(i)
		sheets.WriteString(`<sheet name="S` + strconv.Itoa(i) + `" sheetId="1" r:id="` + id + `"/>`)
		rels.WriteString(`<Relationship Id="` + id + `" Type="x/worksheet" Target="worksheets/sheet1.xml"/>`)
	}
	files := map[string]string{
		"xl/workbook.xml":            `<workbook xmlns:r="x"><sheets>` + sheets.String() + `</sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships>` + rels.String() + `</Relationships>`,
	}
	if d := mustExtract(t, mimeXLSX, xlsxOf(t, files)); len(d.Parts) != 200*3 {
		t.Fatalf("%d parts, want 600", len(d.Parts))
	}
}

func TestFitIgnoresPartsWithNothingToSay(t *testing.T) {
	text, read, total := Fit(Doc{Parts: []Part{{}, {Text: "a"}, {}, {}, {Text: "b"}}}, 100)
	if text != "a\nb" || read != 2 || total != 2 {
		t.Fatalf("text, read, total = %q, %d, %d", text, read, total)
	}
}

// An entry whose header understates or overstates its size is refused, not read
// at a size the budget never saw; one that tells the truth is read.
func TestExtractRefusesAnEntryThatLiesAboutItsSize(t *testing.T) {
	body := []byte(`<w:document ` + wNS + `><w:body>` + strings.Repeat(" ", 5000) + `</w:body></w:document>`)
	for name, declared := range map[string]uint64{"smaller": 10, "larger": uint64(len(body)) + 10, "exact": uint64(len(body))} {
		var raw bytes.Buffer
		fw, _ := flate.NewWriter(&raw, flate.BestSpeed)
		_, _ = fw.Write(body)
		_ = fw.Close()
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		f, err := w.CreateRaw(&zip.FileHeader{
			Name: "word/document.xml", Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(body),
			CompressedSize64: uint64(raw.Len()), UncompressedSize64: declared,
		})
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write(raw.Bytes())
		_ = w.Close()
		_, err = extract(mimeDOCX, buf.Bytes())
		if refused := errors.Is(err, ErrUnreadable); refused != (name != "exact") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}
