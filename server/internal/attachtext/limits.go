package attachtext

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"slices"
)

// A parsed file takes far more memory than the bytes it came from: XML nests
// and repeats tiny elements, and every Part costs a header besides its text.
// These limits keep the parsed form bounded; real files stay far below them.
const (
	// maxReadBytes bounds what one file may decompress to, all zip entries
	// together, and how large a plain-text file may be.
	maxReadBytes = 64 << 20
	// maxRetained bounds the estimated bytes a file may keep alive while it is
	// read: its Parts, the shared strings of a workbook, and a sheet row.
	maxRetained = 64 << 20
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
	errOverLimit   = errors.New("decompressed data over the 64 MiB limit")
	errTooMuchText = errors.New("text kept from the file over the 64 MiB limit")
	errTooDeep     = errors.New("XML nested deeper than 100 elements")
	errTagTooLong  = errors.New("XML tag longer than 64 KiB")
	errTextTooLong = errors.New("XML text or comment longer than 4 MiB")
	errTooWide     = errors.New("row wider than 16384 cells")
)

// budget counts the bytes a file may still keep alive.
type budget struct{ left int }

func (b *budget) spend(n int) error {
	if b.left -= n; b.left < 0 {
		return unreadable(errTooMuchText)
	}
	return nil
}

// add keeps p, charging its text and header.
func (b *budget) add(parts *[]Part, p Part) error {
	if err := b.spend(len(p.Label) + len(p.Text) + partOverhead); err != nil {
		return err
	}
	*parts = append(*parts, p)
	return nil
}

// tagReader hands the XML decoder its bytes and refuses what it would have to
// build whole before this package sees it: a markup tag longer than
// maxTagBytes, or character data, a comment, CDATA or a processing instruction
// (<! and <?) longer than maxTextRun. Quotes are tracked inside a tag so a '>'
// in an attribute value cannot hide a long one.
type tagReader struct {
	*bytes.Reader
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

// walkXML feeds every token of data to fn, which may stop the walk with an
// error. It fails on malformed or empty XML, on nesting past maxXMLDepth and
// on an over-long tag or text run. Elements are matched by local name only, so transitional
// and strict OOXML (different namespace URIs, same names) both read. Subtrees
// whose root is named in skip are dropped whole.
func walkXML(data []byte, skip []string, fn func(xml.Token) error) error {
	d := xml.NewDecoder(&tagReader{Reader: bytes.NewReader(data)})
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
