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

// zipDoc is an opened Office/ODF package. It hands out whole entries and
// counts every decompressed byte against one budget, so a zip bomb is stopped
// whether it is one huge entry or many mid-sized ones.
type zipDoc struct {
	files map[string]*zip.File
	left  int64  // decompressed bytes the package may still yield
	keep  budget // bytes the parsed text may still keep alive
}

func openZip(r io.ReaderAt, size int64) (*zipDoc, error) {
	zr, err := zip.NewReader(r, size)
	// ErrInsecurePath only warns about names we never extract to disk.
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		return nil, unreadable(err)
	}
	z := &zipDoc{files: make(map[string]*zip.File, len(zr.File)), left: maxReadBytes, keep: budget{maxRetained}}
	for _, f := range zr.File {
		if _, dup := z.files[f.Name]; !dup {
			z.files[f.Name] = f
		}
	}
	return z, nil
}

func (z *zipDoc) has(name string) bool { _, ok := z.files[name]; return ok }

// read returns the whole entry, or ErrUnreadable when it is absent, damaged or
// would push the package past its decompression budget. The buffer is exactly
// the declared size, which is checked against the budget first and against the
// real data after: an entry that lies about its size is refused, and memory
// never exceeds the budget (ReadAll would grow to twice the data).
func (z *zipDoc) read(name string) ([]byte, error) {
	f, ok := z.files[name]
	if !ok {
		return nil, unreadable(fmt.Errorf("missing %s", name))
	}
	if f.UncompressedSize64 > uint64(z.left) {
		return nil, unreadable(errOverLimit)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, unreadable(err)
	}
	defer rc.Close()
	b := make([]byte, f.UncompressedSize64)
	if _, err := io.ReadFull(rc, b); err != nil {
		return nil, unreadable(err)
	}
	var extra [1]byte
	if n, err := io.ReadFull(rc, extra[:]); n > 0 {
		return nil, unreadable(errors.New("entry is larger than it declares"))
	} else if err != io.EOF {
		return nil, unreadable(err)
	}
	z.left -= int64(len(b))
	return b, nil
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
	data, err := z.read("word/document.xml")
	if err != nil {
		return Doc{}, err
	}
	var (
		parts []Part
		para  strings.Builder
		cell  strings.Builder // paragraphs of the current cell, joined by a space
		row   []string
		inT   bool
		depth int // table nesting; only the outermost table splits into rows and cells
	)
	err = walkXML(data, altContentFallback, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "tbl":
				depth++
			case "tr":
				if depth == 1 {
					row = nil
				}
			case "tc":
				if depth == 1 {
					cell.Reset()
				}
			case "t":
				inT = true
			case "tab", "br", "cr":
				para.WriteByte(' ')
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inT = false
			case "p":
				text := strings.TrimSpace(para.String())
				para.Reset()
				switch {
				case text == "":
				case depth > 0:
					if cell.Len() > 0 {
						cell.WriteByte(' ')
					}
					cell.WriteString(text)
				default:
					return z.keep.add(&parts, Part{Text: text})
				}
			case "tc":
				if depth == 1 {
					if len(row) >= maxColumns {
						return unreadable(errTooWide)
					}
					row = append(row, cell.String())
				}
			case "tr":
				if depth == 1 && slices.ContainsFunc(row, func(c string) bool { return c != "" }) {
					return z.keep.add(&parts, Part{Text: strings.Join(row, " | ")})
				}
			case "tbl":
				depth--
			}
		case xml.CharData:
			if inT {
				para.Write(t)
			}
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	return Doc{Unit: "paragraph", Parts: parts}, nil
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
			if err := z.keep.spend(len(name) + 2*stringOverhead); err != nil {
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
		data, err := z.read(s.name)
		if err != nil {
			return Doc{}, err
		}
		var (
			text strings.Builder // the slide's lines, one per a:p
			para strings.Builder
			inT  bool
		)
		err = walkXML(data, altContentFallback, func(tok xml.Token) error {
			switch t := tok.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "t":
					inT = true
				case "br":
					para.WriteByte(' ')
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "t":
					inT = false
				case "p":
					if line := strings.TrimSpace(para.String()); line != "" {
						if text.Len() > 0 {
							text.WriteByte('\n')
						}
						text.WriteString(line)
					}
					para.Reset()
				}
			case xml.CharData:
				if inT {
					para.Write(t)
				}
			}
			return nil
		})
		if err != nil {
			return Doc{}, err
		}
		if text.Len() > 0 {
			if err := z.keep.add(&doc.Parts, Part{Label: "Slide " + strconv.Itoa(s.n), Text: text.String()}); err != nil {
				return Doc{}, err
			}
		}
	}
	return doc, nil
}

// odtSkip drops comments and tracked deletions: neither is body text.
var odtSkip = []string{"annotation", "tracked-changes"}

// odt reads content.xml: each non-empty text:p and text:h is a Part.
func (z *zipDoc) odt() (Doc, error) {
	data, err := z.read("content.xml")
	if err != nil {
		return Doc{}, err
	}
	var (
		parts []Part
		para  strings.Builder
		depth int // paragraphs nest when a text box sits inside one
	)
	err = walkXML(data, odtSkip, func(tok xml.Token) error {
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "p", "h":
				depth++
			case "s", "tab", "line-break": // runs of spaces collapse to one: fine for a reader
				if depth > 0 {
					para.WriteByte(' ')
				}
			}
		case xml.EndElement:
			if t.Name.Local == "p" || t.Name.Local == "h" {
				depth--
				text := strings.TrimSpace(para.String())
				para.Reset()
				if text != "" {
					return z.keep.add(&parts, Part{Text: text})
				}
			}
		case xml.CharData:
			if depth > 0 {
				para.Write(t)
			}
		}
		return nil
	})
	if err != nil {
		return Doc{}, err
	}
	return Doc{Unit: "paragraph", Parts: parts}, nil
}
