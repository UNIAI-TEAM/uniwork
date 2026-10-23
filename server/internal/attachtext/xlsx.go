package attachtext

import (
	"encoding/xml"
	"errors"
	"path"
	"strconv"
	"strings"
	"unicode"
)

// xlsx reads every sheet in workbook order. A sheet with at least one row
// becomes a heading Part (Label = sheet name) followed by one Part per
// non-empty row, cells joined by " | " with empty cells kept so columns line
// up. Cell values are read as stored: numbers and dates are not formatted, so
// a date written as an Excel serial stays a number (the cell's number format
// lives in styles.xml, which is not read). Each sheet keeps its first rows
// within an equal share of the retention budget and counts the rest, so a
// large first sheet cannot crowd out the ones after it.
func (z *zipDoc) xlsx() (Doc, error) {
	type sheetRef struct{ name, rid string }
	var refs []sheetRef
	err := z.walk("xl/workbook.xml", nil, func(tok xml.Token) error {
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "sheet" {
			ref := sheetRef{attr(se, "name"), attr(se, "id")}
			if err := z.tables.spend(len(ref.name) + len(ref.rid) + 2*stringOverhead); err != nil {
				return err
			}
			refs = append(refs, ref)
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	if len(refs) == 0 {
		return Doc{}, unreadable(errors.New("workbook has no sheets"))
	}

	targets := map[string]string{}
	err = z.walk("xl/_rels/workbook.xml.rels", nil, func(tok xml.Token) error {
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "Relationship" && attr(se, "TargetMode") != "External" {
			id, t := attr(se, "Id"), attr(se, "Target")
			if err := z.tables.spend(len(id) + len(t) + 4*stringOverhead); err != nil {
				return err
			}
			if strings.HasPrefix(t, "/") {
				targets[id] = t[1:]
			} else {
				targets[id] = path.Join("xl", t)
			}
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}

	shared, err := z.sharedStrings()
	if err != nil {
		return Doc{}, err
	}
	doc := Doc{Unit: "row"}
	for _, ref := range refs {
		target, ok := targets[ref.rid]
		if !ok {
			return Doc{}, unreadable(errors.New("sheet without a relationship"))
		}
		k := keeper{left: maxRetained / len(refs)}
		var sheet Doc
		k.heading(&sheet, ref.name)
		if err := z.walk(target, nil, sheetRows(shared, &k, &sheet)); err != nil {
			return Doc{}, err
		}
		if len(sheet.Parts) > 1 { // the heading only goes with a row under it
			doc.Parts = append(doc.Parts, sheet.Parts...)
		}
		doc.Omitted += sheet.Omitted
	}
	return doc, nil
}

// sharedStrings returns xl/sharedStrings.xml's strings by index; the part is
// optional (a workbook may hold only inline strings and numbers). Each string
// has its whitespace collapsed here, once, so a cell that uses it costs nothing
// per use, and is charged to the file's tables budget, empty ones included.
func (z *zipDoc) sharedStrings() ([]string, error) {
	const name = "xl/sharedStrings.xml"
	if !z.has(name) {
		return nil, nil
	}
	var (
		out        []string
		cur        partText
		inT, inRPh bool // rPh is a phonetic guide (furigana), not part of the text
	)
	err := z.walk(name, nil, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				cur.reset()
			case "t":
				inT = true
			case "rPh":
				inRPh = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inT = false
			case "rPh":
				inRPh = false
			case "si":
				if cur.cut {
					return unreadable(errTablesTooBig)
				}
				s := collapseSpace(cur.String())
				if err := z.tables.spend(len(s) + stringOverhead); err != nil {
					return err
				}
				out = append(out, s)
			}
		case xml.CharData:
			if inT && !inRPh {
				cur.add(t, z.tables.left+1)
			}
		}
		return nil
	})
	return out, err
}

// sheetRows reads one sheet into d through k: one Part per row that has any
// text. A row may hold at most maxColumns cells. Once a row passes what k has
// left, it is no longer built, only counted: a shared string used by many
// cells would otherwise grow far past the size of the sheet. The work per
// cell is bounded by the cell's own bytes: shared strings arrive already
// collapsed, and empty cells are not placed, so a row whose only cell sits in
// column XFD costs a few steps, not 16384.
func sheetRows(shared []string, k *keeper, d *Doc) func(xml.Token) error {
	var (
		cells    []string
		val      partText
		typ      string
		next     int // column of the next cell when its reference is missing
		rowBytes int
		solid    bool // the row has text, kept or not
		cut      bool // the row passed what k has left
		inC      bool
		inV, inT bool
		inRPh    bool
	)
	// A value is never cut short of a shared-string index or a number.
	const minValue = 64
	return func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				cells, next, rowBytes, solid, cut = cells[:0], 0, 0, false, false
			case "c":
				inC, typ = true, attr(t, "t")
				val.reset()
				if col := colIndex(attr(t, "r")); col >= 0 {
					next = col
				}
			case "v":
				inV = inC
			case "t": // inline strings: <is><t>…</t></is>
				inT = inC
			case "rPh":
				inRPh = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v":
				inV = false
			case "t":
				inT = false
			case "rPh":
				inRPh = false
			case "c":
				inC = false
				if next >= maxColumns {
					return unreadable(errTooWide)
				}
				col := next
				next++
				if val.cut && typ != "s" {
					solid, cut = solid || val.solid, true
					return nil
				}
				v, err := cellValue(typ, strings.TrimSpace(val.String()), shared)
				if err != nil {
					return err
				}
				if typ != "s" { // shared strings were collapsed once, in sharedStrings
					v = collapseSpace(v)
				}
				solid = solid || v != ""
				if rowBytes += len(v) + stringOverhead; cut || rowBytes > k.room() {
					cut = true
					return nil
				}
				if v != "" {
					for len(cells) <= col {
						cells = append(cells, "")
					}
					cells[col] = v
				}
			case "row":
				if !solid {
					return nil
				}
				if cut {
					k.unit(d, Part{}, true)
					return nil
				}
				n := len(cells)
				for n > 0 && cells[n-1] == "" {
					n--
				}
				k.unit(d, Part{Text: strings.Join(cells[:n], " | ")}, false)
			}
		case xml.CharData:
			if (inV || inT) && !inRPh {
				val.add(t, max(k.room()-rowBytes, minValue))
			}
		}
		return nil
	}
}

// cellValue turns a cell's stored text into what a reader sees: a shared string
// by index, a boolean as TRUE/FALSE, anything else as written.
func cellValue(typ, v string, shared []string) (string, error) {
	switch typ {
	case "s":
		if v == "" {
			return "", nil
		}
		i, err := strconv.Atoi(v)
		if err != nil || i < 0 || i >= len(shared) {
			return "", unreadable(errors.New("shared string index out of range"))
		}
		return shared[i], nil
	case "b":
		if v == "1" {
			return "TRUE", nil
		}
		return "FALSE", nil
	}
	return v, nil
}

// colIndex is the zero-based column of a cell reference like "C5", or -1 when
// the reference is missing or past Excel's last column.
func colIndex(ref string) int {
	n := 0
	for _, c := range ref {
		if c < 'A' || c > 'Z' {
			break
		}
		if n = n*26 + int(c-'A') + 1; n > maxColumns {
			return -1
		}
	}
	return n - 1
}

// collapseSpace trims s and turns every run of white space into one space. It
// walks s once, so a cell of millions of one-letter words costs no slice of
// words (strings.Fields would build one) and a white-space-only string is
// scanned once and yields "".
func collapseSpace(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}
