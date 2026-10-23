package attachtext

import (
	"archive/zip"
	"cmp"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// zipDoc is an opened Office/ODF package. It streams entries and counts every
// decompressed byte against one budget, so a zip bomb is stopped whether it is
// one huge entry or many mid-sized ones.
type zipDoc struct {
	files  map[string]*zip.File
	left   int64  // decompressed bytes the package may still yield
	tables budget // bytes of the tables the file needs whole
	keep   keeper // bytes of text the file may keep in Parts
}

// dirReader caps what zip.NewReader may read: the end record and the central
// directory are all it reads, so past left bytes the directory is too large.
// A left below zero lifts the cap, for reading the entries afterwards.
type dirReader struct {
	io.ReaderAt
	left int64
}

func (d *dirReader) ReadAt(p []byte, off int64) (int, error) {
	if d.left >= 0 {
		if d.left -= int64(len(p)); d.left < 0 {
			return 0, errBigDirectory
		}
	}
	return d.ReaderAt.ReadAt(p, off)
}

func openZip(r io.ReaderAt, size int64) (*zipDoc, error) {
	// The end record sits in the last 64 KiB; archive/zip reads it in 1 KiB steps.
	dr := &dirReader{ReaderAt: r, left: maxZipDirectory + 70<<10}
	zr, err := zip.NewReader(dr, size)
	// ErrInsecurePath only warns about names we never extract to disk.
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		return nil, unreadable(err)
	}
	dr.left = -1
	z := &zipDoc{files: make(map[string]*zip.File, len(zr.File)), left: maxReadBytes,
		tables: budget{maxTables}, keep: keeper{left: maxRetained}}
	for _, f := range zr.File {
		if _, dup := z.files[f.Name]; !dup {
			z.files[f.Name] = f
		}
	}
	return z, nil
}

func (z *zipDoc) has(name string) bool { _, ok := z.files[name]; return ok }

// walk streams the entry to walkXML, or returns ErrUnreadable when it is
// absent, damaged or would push the package past its decompression budget. The
// declared size is charged up front; archive/zip refuses an entry that yields
// more or fewer bytes than it declares, so a lying header is caught too.
func (z *zipDoc) walk(name string, skip []string, fn func(xml.Token) error) error {
	f, ok := z.files[name]
	if !ok {
		return unreadable(fmt.Errorf("missing %s", name))
	}
	if f.UncompressedSize64 > uint64(z.left) {
		return unreadable(errOverLimit)
	}
	z.left -= int64(f.UncompressedSize64)
	rc, err := f.Open()
	if err != nil {
		return unreadable(err)
	}
	defer rc.Close()
	if err := walkXML(rc, skip, fn); err != nil {
		return err
	}
	// A walk ends at the root's close; what follows must still check out.
	if _, err := io.Copy(io.Discard, rc); err != nil {
		return unreadable(err)
	}
	return nil
}

func attr(se xml.StartElement, local string) string {
	for _, a := range se.Attr {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// altContentFallback is the VML twin Word writes beside every DrawingML text
// box; reading both would say everything in a text box twice.
var altContentFallback = []string{"Fallback"}

// docx reads word/document.xml: each non-empty w:p is a Part, each row of a
// table is one Part with its cells joined by " | ". A table nested in a cell is
// flattened into that cell. Headers, footers, notes and comments are not read.
func (z *zipDoc) docx() (Doc, error) {
	var (
		doc        = Doc{Unit: "paragraph"}
		para, cell partText // cell: the paragraphs of the current cell, joined by a space
		row        []string
		rowSize    int // bytes of the row's cells so far
		rowSolid   bool
		rowCut     bool
		inT        bool
		depth      int // table nesting; only the outermost table splits into rows and cells
	)
	err := z.walk("word/document.xml", altContentFallback, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tbl":
				depth++
			case "tr":
				if depth == 1 {
					row, rowSize, rowSolid, rowCut = nil, 0, false, false
				}
			case "tc":
				if depth == 1 {
					cell.reset()
				}
			case "t":
				inT = true
			case "tab", "br", "cr":
				para.add([]byte{' '}, z.keep.room())
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inT = false
			case "p":
				text := strings.TrimSpace(para.String())
				switch {
				case !para.solid:
				case depth > 0:
					if cell.Len() > 0 {
						cell.add([]byte{' '}, z.keep.room()-rowSize)
					}
					cell.add([]byte(text), z.keep.room()-rowSize)
					cell.cut = cell.cut || para.cut
				default:
					z.keep.unit(&doc, Part{Text: text}, para.cut)
				}
				para.reset()
			case "tc":
				if depth == 1 {
					if len(row) >= maxColumns {
						return unreadable(errTooWide)
					}
					row = append(row, cell.String())
					rowSize += cell.Len() + len(" | ")
					rowSolid, rowCut = rowSolid || cell.solid, rowCut || cell.cut
				}
			case "tr":
				if depth == 1 && rowSolid {
					z.keep.unit(&doc, Part{Text: strings.Join(row, " | ")}, rowCut)
				}
			case "tbl":
				depth--
			}
		case xml.CharData:
			if inT {
				para.add(t, z.keep.room())
			}
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	return doc, nil
}

var slideName = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)

// pptx reads ppt/slides/slideN.xml in order of N, which is the file's number,
// not necessarily the slide's place in the show. Each a:p is a line of the
// slide's Part. A slide with no text (pictures only) is left out.
func (z *zipDoc) pptx() (Doc, error) {
	type slide struct {
		n    int
		name string
	}
	var slides []slide
	for name := range z.files {
		if m := slideName.FindStringSubmatch(name); m != nil {
			n, err := strconv.Atoi(m[1])
			if err != nil {
				return Doc{}, unreadable(err)
			}
			if err := z.tables.spend(len(name) + 2*stringOverhead); err != nil {
				return Doc{}, err
			}
			slides = append(slides, slide{n, name})
		}
	}
	if len(slides) == 0 {
		return Doc{}, unreadable(errors.New("no slides"))
	}
	slices.SortFunc(slides, func(a, b slide) int {
		return cmp.Or(cmp.Compare(a.n, b.n), cmp.Compare(a.name, b.name))
	})
	doc := Doc{Unit: "slide"}
	for _, s := range slides {
		var (
			text, para partText // text: the slide's lines, one per a:p
			inT        bool
		)
		err := z.walk(s.name, altContentFallback, func(tok xml.Token) error {
			switch t := tok.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "t":
					inT = true
				case "br":
					para.add([]byte{' '}, z.keep.room())
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "t":
					inT = false
				case "p":
					if para.solid {
						if text.Len() > 0 {
							text.add([]byte{'\n'}, z.keep.room())
						}
						text.add([]byte(strings.TrimSpace(para.String())), z.keep.room())
						text.cut = text.cut || para.cut
					}
					para.reset()
				}
			case xml.CharData:
				if inT {
					para.add(t, z.keep.room())
				}
			}
			return nil
		})
		if err != nil {
			return Doc{}, err
		}
		if text.solid {
			z.keep.unit(&doc, Part{Label: "Slide " + strconv.Itoa(s.n), Text: text.String()}, text.cut)
		}
	}
	return doc, nil
}

// odtSkip drops comments and tracked deletions: neither is body text.
var odtSkip = []string{"annotation", "tracked-changes"}

// odt reads content.xml: each non-empty text:p and text:h is a Part.
func (z *zipDoc) odt() (Doc, error) {
	var (
		doc   = Doc{Unit: "paragraph"}
		para  partText
		depth int // paragraphs nest when a text box sits inside one
	)
	err := z.walk("content.xml", odtSkip, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "p", "h":
				depth++
			case "s", "tab", "line-break": // runs of spaces collapse to one: fine for a reader
				if depth > 0 {
					para.add([]byte{' '}, z.keep.room())
				}
			}
		case xml.EndElement:
			if t.Name.Local == "p" || t.Name.Local == "h" {
				depth--
				if para.solid {
					z.keep.unit(&doc, Part{Text: strings.TrimSpace(para.String())}, para.cut)
				}
				para.reset()
			}
		case xml.CharData:
			if depth > 0 {
				para.add(t, z.keep.room())
			}
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	return doc, nil
}
