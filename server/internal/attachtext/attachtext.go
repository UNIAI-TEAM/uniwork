// Package attachtext turns a file attached to an Ask UNI question into text
// the model can read: Word, PowerPoint, Excel, ODT and plain-text files. Ask
// UNI re-reads each file on every turn and never stores what it extracts. The
// document search index is the one place that stores extracted text: at most
// 20,000 characters per file document, in documents.content_text.
//
// It is a leaf: nothing from the rest of the repo, and outside the standard
// library only pdfcpu (pure Go, for counting and trimming PDF pages).
package attachtext

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// MIME types Extract understands; the values are what files.DetectBodyContentType emits.
const (
	mimeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	mimeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	mimePPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	mimeODT  = "application/vnd.oasis.opendocument.text"
)

// Part is one paragraph, slide, row or line. Label names a sheet ("Doanh thu")
// or a slide ("Slide 3"). A Part without Text is a heading; only Parts with
// Text count as units of the document.
type Part struct {
	Label string
	Text  string
}

// Doc is the text of one file. Unit is what a Part is called in a message to
// the user: "paragraph", "slide", "row" or "line".
type Doc struct {
	Unit  string
	Parts []Part
	// Omitted counts the Parts that were counted but not kept, because the file
	// has more text than one read keeps alive (maxRetained). They are never
	// read, only reported. In a workbook each sheet keeps its own first rows, so
	// omitted rows of one sheet sit before the kept rows of the next.
	Omitted int
}

// ErrUnreadable means the file is damaged, encrypted, empty of the part that
// carries its text, or too large to open safely. The caller should tell the
// user and carry on without the file.
var ErrUnreadable = errors.New("attachtext: unreadable file")

func unreadable(err error) error { return fmt.Errorf("%w: %v", ErrUnreadable, err) }

// Extract reads the text of a file of the given MIME type. A MIME type this
// package does not handle is a caller bug and returns a plain error, not
// ErrUnreadable.
func Extract(mime string, r io.ReaderAt, size int64) (Doc, error) {
	var read func(*zipDoc) (Doc, error)
	switch mime {
	case mimeDOCX:
		read = (*zipDoc).docx
	case mimePPTX:
		read = (*zipDoc).pptx
	case mimeXLSX:
		read = (*zipDoc).xlsx
	case mimeODT:
		read = (*zipDoc).odt
	case "text/plain", "text/csv", "text/markdown":
		return plainDoc(r, size)
	default:
		return Doc{}, fmt.Errorf("attachtext: unsupported MIME type %q", mime)
	}
	z, err := openZip(r, size)
	if err != nil {
		return Doc{}, err
	}
	return read(z)
}

// plainDoc reads text line by line, one Part per non-blank line (a blank line
// carries nothing a reader needs, and a file of newlines must not become
// millions of Parts). Invalid UTF-8 becomes U+FFFD; a leading BOM is dropped.
// A valid file is never refused for its line count: the first lines that fit
// the retention budget are kept and the rest are only counted in Omitted. A
// line is read in pieces, never whole: past maxLine its rest is skipped.
func plainDoc(r io.ReaderAt, size int64) (Doc, error) {
	if size < 0 || size > maxReadBytes {
		return Doc{}, unreadable(errOverLimit)
	}
	k := keeper{left: maxRetained}
	br := bufio.NewReaderSize(io.NewSectionReader(r, 0, size), 64<<10)
	d := Doc{Unit: "line"}
	var line partText
	for first := true; ; first = false {
		piece, err := br.ReadSlice('\n')
		if first {
			piece = bytes.TrimPrefix(piece, []byte("\uFEFF"))
		}
		// A line cut at maxLine keeps its opening; one cut at the budget is
		// only counted.
		limit := min(k.room(), maxLine)
		line.add(piece, limit)
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil && err != io.EOF {
			return Doc{}, unreadable(err)
		}
		if line.solid {
			text := strings.ToValidUTF8(strings.TrimRight(line.String(), "\r\n"), "\uFFFD")
			if line.cut { // the cut may have split the last character
				text = strings.TrimRight(text, "\uFFFD")
			}
			k.unit(&d, Part{Text: text}, line.cut && limit < maxLine)
		}
		line.reset()
		if err == io.EOF {
			return d, nil
		}
	}
}

// EstimateTokens is a cheap upper-ish bound on the model tokens of s: one per
// three characters, which holds for Vietnamese as well as English.
func EstimateTokens(s string) int {
	return (utf8.RuneCountInString(s) + 2) / 3
}
