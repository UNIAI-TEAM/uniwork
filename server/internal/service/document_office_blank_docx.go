package service

import (
	"fmt"
	"strings"
)

const blankXMLDecl = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\r\n"

// blankDOCXSeed is the starting package of a blank DOCX: one empty paragraph on
// an A4 portrait page, with the style and numbering set the genoffice Docs
// editor's generate layer references (Normal, Heading1-6, ListParagraph,
// Hyperlink, TOC1-9; bullet numId 1 and decimal numId 2). It mirrors the
// editor's own blank template (packages/docx-engine/src/blank.ts) so a blank
// the server makes opens exactly like one the editor makes. No engine binds
// serialize:docx, so these bytes are the document's first version as they are.
// Entries carry a fixed time: the seed is deterministic.
func blankDOCXSeed() []byte {
	const wNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	docNS := `xmlns:w="` + wNS + `" ` +
		`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
		`xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
		`xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
		`xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ` +
		`xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`
	rel := func(id, kind, target string) string {
		return `<Relationship Id="` + id + `" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/` + kind + `" Target="` + target + `"/>`
	}
	sectPr := `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
		`<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
	return blankZip([]blankPart{
		{"[Content_Types].xml", blankXMLDecl + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
			`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
			`<Default Extension="xml" ContentType="application/xml"/>` +
			`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
			`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
			`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
			`</Types>`},
		{"_rels/.rels", blankXMLDecl + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			rel("rId1", "officeDocument", "word/document.xml") + `</Relationships>`},
		{"word/_rels/document.xml.rels", blankXMLDecl + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
			rel("rId1", "styles", "styles.xml") + rel("rId2", "numbering", "numbering.xml") + `</Relationships>`},
		{"word/styles.xml", blankDOCXStyles(wNS)},
		{"word/numbering.xml", blankDOCXNumbering(wNS)},
		{"word/document.xml", blankXMLDecl + `<w:document ` + docNS + `><w:body><w:p/>` + sectPr + `</w:body></w:document>`},
	})
}

func blankDOCXStyles(wNS string) string {
	var b strings.Builder
	b.WriteString(blankXMLDecl + `<w:styles xmlns:w="` + wNS + `">`)
	b.WriteString(`<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>` +
		`<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`)
	b.WriteString(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`)
	for i, size := range []int{32, 28, 26, 24, 22, 22} {
		level := i + 1
		before := 160
		if level <= 2 {
			before = 240
		}
		fmt.Fprintf(&b, `<w:style w:type="paragraph" w:styleId="Heading%d"><w:name w:val="heading %d"/>`+
			`<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`+
			`<w:pPr><w:keepNext/><w:spacing w:before="%d" w:after="120"/><w:outlineLvl w:val="%d"/></w:pPr>`+
			`<w:rPr><w:b/><w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr></w:style>`, level, level, before, level-1, size, size)
	}
	b.WriteString(`<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>` +
		`<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>` +
		`<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>` +
		`<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`)
	for level := 1; level <= 9; level++ {
		indent := ""
		if level > 1 {
			indent = fmt.Sprintf(`<w:ind w:left="%d"/>`, 220*(level-1))
		}
		fmt.Fprintf(&b, `<w:style w:type="paragraph" w:styleId="TOC%d"><w:name w:val="toc %d"/>`+
			`<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="100"/>%s</w:pPr></w:style>`, level, level, indent)
	}
	b.WriteString(`</w:styles>`)
	return b.String()
}

func blankDOCXNumbering(wNS string) string {
	levels := func(numFmt string, text func(ilvl int) string, rpr string) string {
		var b strings.Builder
		for ilvl := 0; ilvl < 5; ilvl++ {
			fmt.Fprintf(&b, `<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="%s"/><w:lvlText w:val="%s"/>`+
				`<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="%d" w:hanging="360"/></w:pPr>%s</w:lvl>`,
				ilvl, numFmt, text(ilvl), 720*(ilvl+1), rpr)
		}
		return b.String()
	}
	bullet := levels("bullet", func(int) string { return "&#61623;" },
		`<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>`)
	decimal := levels("decimal", func(ilvl int) string { return fmt.Sprintf("%%%d.", ilvl+1) }, "")
	return blankXMLDecl + `<w:numbering xmlns:w="` + wNS + `">` +
		`<w:abstractNum w:abstractNumId="0">` + bullet + `</w:abstractNum>` +
		`<w:abstractNum w:abstractNumId="1">` + decimal + `</w:abstractNum>` +
		`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
		`<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
}
