package attachtext

import (
	"archive/zip"
	"bytes"
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
	left  int64
}

func openZip(r io.ReaderAt, size int64) (*zipDoc, error) {
	zr, err := zip.NewReader(r, size)
	// ErrInsecurePath only warns about names we never extract to disk.
	if err != nil && !errors.Is(err, zip.ErrInsecurePath) {
		return nil, unreadable(err)
	}
	z := &zipDoc{files: make(map[string]*zip.File, len(zr.File)), left: maxReadBytes}
	for _, f := range zr.File {
		if _, dup := z.files[f.Name]; !dup {
			z.files[f.Name] = f
		}
	}
	return z, nil
}

func (z *zipDoc) has(name string) bool { _, ok := z.files[name]; return ok }

// read returns the whole entry, or ErrUnreadable when it is absent, damaged or
// would push the package past its decompression budget.
func (z *zipDoc) read(name string) ([]byte, error) {
	f, ok := z.files[name]
	if !ok {
		return nil, unreadable(fmt.Errorf("missing %s", name))
	}
	// The declared size can lie, so the read below is capped too.
	if f.UncompressedSize64 > uint64(z.left) {
		return nil, unreadable(errOverLimit)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, unreadable(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, z.left+1))
	if err != nil {
		return nil, unreadable(err)
	}
	if int64(len(b)) > z.left {
		return nil, unreadable(errOverLimit)
	}
	z.left -= int64(len(b))
	return b, nil
}

// walkXML feeds every token of data to fn and fails on malformed or empty XML.
// Elements are matched by local name only, so transitional and strict OOXML
// (different namespace URIs, same names) both read. Subtrees named in skip are
// dropped whole.
func walkXML(data []byte, skip []string, fn func(xml.Token)) error {
	d := xml.NewDecoder(bytes.NewReader(data))
	sawRoot := false
	for {
		tok, err := d.Token()
		if err == io.EOF {
			if !sawRoot {
				return unreadable(errors.New("empty XML part"))
			}
			return nil
		}
		if err != nil {
			return unreadable(err)
		}
		if se, ok := tok.(xml.StartElement); ok {
			sawRoot = true
			if slices.Contains(skip, se.Name.Local) {
				if err := d.Skip(); err != nil {
					return unreadable(err)
				}
				continue
			}
		}
		fn(tok)
	}
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
		parts    []Part
		para     strings.Builder
		inT      bool
		depth    int      // table nesting; only the outermost table splits into rows and cells
		row, par []string // cells of the current row; paragraphs of the current cell
	)
	err = walkXML(data, altContentFallback, func(tok xml.Token) {
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
					par = nil
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
					par = append(par, text)
				default:
					parts = append(parts, Part{Text: text})
				}
			case "tc":
				if depth == 1 {
					row = append(row, strings.Join(par, " "))
				}
			case "tr":
				if depth == 1 && slices.ContainsFunc(row, func(c string) bool { return c != "" }) {
					parts = append(parts, Part{Text: strings.Join(row, " | ")})
				}
			case "tbl":
				depth--
			}
		case xml.CharData:
			if inT {
				para.Write(t)
			}
		}
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
			lines []string
			para  strings.Builder
			inT   bool
		)
		err = walkXML(data, altContentFallback, func(tok xml.Token) {
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
						lines = append(lines, line)
					}
					para.Reset()
				}
			case xml.CharData:
				if inT {
					para.Write(t)
				}
			}
		})
		if err != nil {
			return Doc{}, err
		}
		if len(lines) > 0 {
			doc.Parts = append(doc.Parts, Part{Label: "Slide " + strconv.Itoa(s.n), Text: strings.Join(lines, "\n")})
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
	err = walkXML(data, odtSkip, func(tok xml.Token) {
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
				if text := strings.TrimSpace(para.String()); text != "" {
					parts = append(parts, Part{Text: text})
				}
				para.Reset()
			}
		case xml.CharData:
			if depth > 0 {
				para.Write(t)
			}
		}
	})
	if err != nil {
		return Doc{}, err
	}
	return Doc{Unit: "paragraph", Parts: parts}, nil
}
