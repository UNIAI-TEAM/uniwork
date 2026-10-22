package attachtext

import (
	"encoding/xml"
	"errors"
	"path"
	"strconv"
	"strings"
)

// xlsx reads every sheet in workbook order. A sheet with at least one row
// becomes a heading Part (Label = sheet name) followed by one Part per
// non-empty row, cells joined by " | " with empty cells kept so columns line
// up. Cell values are read as stored: numbers and dates are not formatted, so
// a date written as an Excel serial stays a number (the cell's number format
// lives in styles.xml, which is not read).
func (z *zipDoc) xlsx() (Doc, error) {
	type sheetRef struct{ name, rid string }
	var refs []sheetRef
	wb, err := z.read("xl/workbook.xml")
	if err != nil {
		return Doc{}, err
	}
	err = walkXML(wb, nil, func(tok xml.Token) error {
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "sheet" {
			refs = append(refs, sheetRef{attr(se, "name"), attr(se, "id")})
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	if len(refs) == 0 {
		return Doc{}, unreadable(errors.New("workbook has no sheets"))
	}

	relData, err := z.read("xl/_rels/workbook.xml.rels")
	if err != nil {
		return Doc{}, err
	}
	targets := map[string]string{}
	err = walkXML(relData, nil, func(tok xml.Token) error {
		if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "Relationship" && attr(se, "TargetMode") != "External" {
			t := attr(se, "Target")
			if strings.HasPrefix(t, "/") {
				targets[attr(se, "Id")] = t[1:]
			} else {
				targets[attr(se, "Id")] = path.Join("xl", t)
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
		data, err := z.read(target)
		if err != nil {
			return Doc{}, err
		}
		rows, err := sheetRows(data, shared, &z.keep)
		if err != nil {
			return Doc{}, err
		}
		if len(rows) == 0 {
			continue
		}
		if err := z.keep.add(&doc.Parts, Part{Label: ref.name}); err != nil {
			return Doc{}, err
		}
		for _, r := range rows {
			doc.Parts = append(doc.Parts, Part{Text: r})
		}
	}
	return doc, nil
}

// sharedStrings returns xl/sharedStrings.xml's strings by index; the part is
// optional (a workbook may hold only inline strings and numbers). Every string
// is charged to the file's retained-bytes budget, empty ones included.
func (z *zipDoc) sharedStrings() ([]string, error) {
	const name = "xl/sharedStrings.xml"
	if !z.has(name) {
		return nil, nil
	}
	data, err := z.read(name)
	if err != nil {
		return nil, err
	}
	var (
		out        []string
		cur        strings.Builder
		inT, inRPh bool // rPh is a phonetic guide (furigana), not part of the text
	)
	err = walkXML(data, nil, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				cur.Reset()
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
				if err := z.keep.spend(cur.Len() + stringOverhead); err != nil {
					return err
				}
				out = append(out, cur.String())
			}
		case xml.CharData:
			if inT && !inRPh {
				cur.Write(t)
			}
		}
		return nil
	})
	return out, err
}

// sheetRows returns one string per row that has any text. A row may hold at
// most maxColumns cells and no more text than the file's budget has left: a
// shared string used by many cells would otherwise grow far past the size of
// the sheet.
func sheetRows(data []byte, shared []string, keep *budget) ([]string, error) {
	var (
		rows     []string
		cells    []string
		val      strings.Builder
		typ      string
		next     int // column of the next cell when its reference is missing
		rowBytes int
		inC      bool
		inV, inT bool
		inRPh    bool
	)
	err := walkXML(data, nil, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				cells, next, rowBytes = cells[:0], 0, 0
			case "c":
				inC, typ = true, attr(t, "t")
				val.Reset()
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
				v, err := cellValue(typ, strings.TrimSpace(val.String()), shared)
				if err != nil {
					return err
				}
				if next >= maxColumns {
					return unreadable(errTooWide)
				}
				if rowBytes += len(v); rowBytes > keep.left {
					return unreadable(errTooMuchText)
				}
				for len(cells) <= next {
					cells = append(cells, "")
				}
				cells[next] = strings.Join(strings.Fields(v), " ")
				next++
			case "row":
				n := len(cells)
				for n > 0 && cells[n-1] == "" {
					n--
				}
				if n > 0 {
					row := strings.Join(cells[:n], " | ")
					if err := keep.spend(len(row) + partOverhead); err != nil {
						return err
					}
					rows = append(rows, row)
				}
			}
		case xml.CharData:
			if (inV || inT) && !inRPh {
				val.Write(t)
			}
		}
		return nil
	})
	return rows, err
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
