package service

import (
	"bytes"
	"encoding/xml"
	"strconv"
	"strings"
)

// xlsxSheet is one worksheet of a generated workbook: a bold, frozen header
// row and plain text cells.
type xlsxSheet struct {
	Name   string
	Header []string
	Rows   [][]string
}

// buildXLSX packs sheets into a SpreadsheetML workbook with inline strings,
// on the same deterministic zip writer as the blank seeds (blankZip). It is
// the server's one XLSX writer: an export that needs a workbook reuses it
// rather than adding a dependency. nil means the archive could not be
// written.
func buildXLSX(sheets []xlsxSheet) []byte {
	const xmlHead = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
	var types, wbSheets, wbRels strings.Builder
	parts := make([]blankPart, 0, len(sheets)+5)
	for i, sh := range sheets {
		n := strconv.Itoa(i + 1)
		types.WriteString(`<Override PartName="/xl/worksheets/sheet` + n + `.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
		wbSheets.WriteString(`<sheet name="` + xlsxEscape(sh.Name) + `" sheetId="` + n + `" r:id="rId` + n + `"/>`)
		wbRels.WriteString(`<Relationship Id="rId` + n + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet` + n + `.xml"/>`)
		parts = append(parts, blankPart{"xl/worksheets/sheet" + n + ".xml", xmlHead + xlsxWorksheetXML(sh)})
	}
	stylesID := strconv.Itoa(len(sheets) + 1)
	wbRels.WriteString(`<Relationship Id="rId` + stylesID + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`)
	head := []blankPart{
		{"[Content_Types].xml", xmlHead +
			`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
			`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
			types.String() + `</Types>`},
		{"_rels/.rels", xmlHead +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
			`</Relationships>`},
		{"xl/workbook.xml", xmlHead +
			`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
			`<sheets>` + wbSheets.String() + `</sheets></workbook>`},
		{"xl/_rels/workbook.xml.rels", xmlHead +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + wbRels.String() + `</Relationships>`},
		// Style 1 is the bold header font; style 0 the default.
		{"xl/styles.xml", xmlHead +
			`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
			`<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
			`<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
			`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
			`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
			`<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
			`</styleSheet>`},
	}
	return blankZip(append(head, parts...))
}

func xlsxWorksheetXML(sh xlsxSheet) string {
	var b strings.Builder
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	b.WriteString(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`)
	b.WriteString(`<sheetData>`)
	xlsxWriteRow(&b, 1, sh.Header, ` s="1"`)
	for i, row := range sh.Rows {
		xlsxWriteRow(&b, i+2, row, "")
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

func xlsxWriteRow(b *strings.Builder, n int, cells []string, style string) {
	r := strconv.Itoa(n)
	b.WriteString(`<row r="` + r + `">`)
	for i, v := range cells {
		b.WriteString(`<c r="` + xlsxColumnName(i) + r + `" t="inlineStr"` + style + `><is><t xml:space="preserve">` + xlsxEscape(v) + `</t></is></c>`)
	}
	b.WriteString(`</row>`)
}

// xlsxColumn is the column letters of a zero-based index (0 -> A, 26 -> AA).
func xlsxColumnName(i int) string {
	s := ""
	for i++; i > 0; i = (i - 1) / 26 {
		s = string(rune('A'+(i-1)%26)) + s
	}
	return s
}

// xlsxEscape escapes text for an XML node; characters XML cannot hold become
// U+FFFD instead of breaking the workbook.
func xlsxEscape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
