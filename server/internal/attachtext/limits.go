package attachtext

import (
	"bufio"
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"slices"
	"strings"
	"unicode"
)

// A parsed file takes far more memory than the bytes it came from: XML nests
// and repeats tiny elements, and every Part costs a header besides its text.
// These limits keep the parsed form bounded; real files stay far below them.
const (
	// maxReadBytes bounds what one file may decompress to, all zip entries
	// together, and how large a plain-text file may be. Zip entries and text
	// are streamed, never held whole, so it bounds the work, not the memory.
	maxReadBytes = 64 << 20
	// maxRetained bounds the text a file keeps in Parts. One turn reads at most
	// 30,000 tokens of a file: about 90,000 characters, or 30,000 Parts of one
	// character; 4 MiB is that with room to spare. Parts past it are counted,
	// not kept, so a large file is read in part rather than refused.
	maxRetained = 4 << 20
	// maxTables bounds what a file needs whole to be read at all: a workbook's
	// shared strings, sheet list and relationships, a deck's slide names. Past
	// it the file is refused.
	maxTables = 16 << 20
	// maxZipDirectory bounds a zip's central directory: archive/zip builds a
	// File of about 300 bytes for every entry listed, so 20 MiB of empty
	// entries would take several times that. Real Office files list a few
	// hundred entries, a large deck a few thousand.
	maxZipDirectory = 1 << 20
	// maxLine bounds one line of a plain-text file. A line this long is past
	// what one turn reads of a file, so the rest of it is skipped, not kept.
	maxLine = 1 << 20
	// Per-item charges: the 32-byte Part or 16-byte string header, counted twice
	// because a slice that grows holds the old array beside the new one.
	partOverhead   = 64
	stringOverhead = 32
	// maxXMLDepth: real OOXML and ODF nest a few dozen levels; the decoder
	// keeps a stack entry per open element.
	maxXMLDepth = 100
	// maxTagBytes: one start tag. Real ones are a few KB (a root with every
	// namespace declared); a tag of millions of attributes becomes a slice of
	// 48-byte entries.
	maxTagBytes = 64 << 10
	// maxTextRun: character data between two tags, or one comment, CDATA section
	// or processing instruction. The decoder holds a run whole and a reader
	// copies it several times, so a 60 MiB run takes several times its size.
	// Excel cells stop at 32,767 characters; Word and ODF start a new run at
	// every formatting change.
	maxTextRun = 4 << 20
	// maxColumns is Excel's last column (XFD); a row wider than that is not real.
	// Word tables stop at 63 columns.
	maxColumns = 16384
)

var (
	errOverLimit    = errors.New("decompressed data over the 64 MiB limit")
	errTablesTooBig = errors.New("shared strings, sheets, relationships or slides over the 16 MiB limit")
	errTooDeep      = errors.New("XML nested deeper than 100 elements")
	errTagTooLong   = errors.New("XML tag longer than 64 KiB")
	errTextTooLong  = errors.New("XML text or comment longer than 4 MiB")
	errTooWide      = errors.New("row wider than 16384 cells")
)

// budget counts the bytes of a file's tables still allowed; spending past it
// refuses the file.
type budget struct{ left int }

func (b *budget) spend(n int) error {
	if b.left -= n; b.left < 0 {
		return unreadable(errTablesTooBig)
	}
	return nil
}

// keeper keeps the first Parts of a file that fit in left bytes and counts the
// rest in Doc.Omitted. Once one Part does not fit, none after it is kept, so
// the kept Parts stay a prefix.
type keeper struct {
	left int
	full bool
}

// unit keeps p, a unit of the document, or counts it in Omitted: a Part that
// was cut while it was built, has no text left, does not fit, or comes after
// one that did not fit.
func (k *keeper) unit(d *Doc, p Part, cut bool) {
	if n := len(p.Label) + len(p.Text) + partOverhead; !cut && !k.full && p.Text != "" && n <= k.left {
		k.left -= n
		d.Parts = append(d.Parts, p)
		return
	}
	k.full = true
	d.Omitted++
}

// heading keeps a Part without Text (a sheet's name) when it fits. It is not a
// unit of the document, so one that does not fit is dropped uncounted.
func (k *keeper) heading(d *Doc, label string) {
	if n := len(label) + partOverhead; !k.full && n <= k.left {
		k.left -= n
		d.Parts = append(d.Parts, Part{Label: label})
		return
	}
	k.full = true
}

// room is how many bytes of one Part are worth building: one past what is
// left to keep, so a Part cut there is still too long to be kept.
func (k *keeper) room() int {
	if k.full {
		return 0
	}
	return k.left + 1
}

// partText builds the text of one Part up to a limit: the rest of a Part that
// cannot be kept is scanned, never piled up. It remembers whether any of the
// text, kept or not, was more than white space (the Part then counts as a unit
// of the document) and whether it was cut.
type partText struct {
	strings.Builder
	solid, cut bool
}

func (p *partText) add(b []byte, limit int) {
	if !p.solid && bytes.ContainsFunc(b, func(r rune) bool { return !unicode.IsSpace(r) }) {
		p.solid = true
	}
	if room := max(limit-p.Len(), 0); len(b) > room {
		b, p.cut = b[:room], true
	}
	p.Write(b)
}

func (p *partText) reset() { p.Reset(); p.solid, p.cut = false, false }

// tagReader hands the XML decoder its bytes and refuses what it would have to
// build whole before this package sees it: a markup tag longer than
// maxTagBytes, or character data, a comment, CDATA or a processing instruction
// (<! and <?) longer than maxTextRun. Quotes are tracked inside a tag so a '>'
// in an attribute value cannot hide a long one.
type tagReader struct {
	*bufio.Reader
	inTag, plain bool // plain: a <! or <? construct, whose quotes are not attribute quotes
	quote        byte
	n            int // bytes of the current tag or text run so far
}

func (t *tagReader) ReadByte() (byte, error) {
	b, err := t.Reader.ReadByte()
	if err != nil {
		return 0, err
	}
	t.n++
	if !t.inTag {
		switch {
		case b == '<':
			t.inTag, t.plain, t.quote, t.n = true, false, 0, 1
		case t.n > maxTextRun:
			return 0, errTextTooLong
		}
		return b, nil
	}
	if t.n == 2 && (b == '!' || b == '?') {
		t.plain = true
	}
	switch {
	case t.plain && t.n > maxTextRun:
		return 0, errTextTooLong
	case !t.plain && t.n > maxTagBytes:
		return 0, errTagTooLong
	case t.plain:
		if b == '>' {
			t.inTag, t.n = false, 0
		}
	case t.quote != 0:
		if b == t.quote {
			t.quote = 0
		}
	case b == '>':
		t.inTag, t.n = false, 0
	case b == '"' || b == '\'':
		t.quote = b
	}
	return b, nil
}

// walkXML feeds every token read from r to fn, which may stop the walk with an
// error. It fails on malformed or empty XML, on nesting past maxXMLDepth and
// on an over-long tag or text run. Elements are matched by local name only, so transitional
// and strict OOXML (different namespace URIs, same names) both read. Subtrees
// whose root is named in skip are dropped whole.
func walkXML(r io.Reader, skip []string, fn func(xml.Token) error) error {
	d := xml.NewDecoder(&tagReader{Reader: bufio.NewReader(r)})
	sawRoot := false
	depth, skipping := 0, 0 // skipping: depth of the dropped element, 0 for none
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
		_, isEnd := tok.(xml.EndElement)
		if se, ok := tok.(xml.StartElement); ok {
			if depth++; depth > maxXMLDepth {
				return unreadable(errTooDeep)
			}
			sawRoot = true
			if skipping == 0 && slices.Contains(skip, se.Name.Local) {
				skipping = depth
			}
		}
		drop := skipping > 0
		if isEnd {
			if depth == skipping {
				skipping = 0
			}
			depth--
		}
		if drop {
			continue
		}
		if err := fn(tok); err != nil {
			return err
		}
	}
}
