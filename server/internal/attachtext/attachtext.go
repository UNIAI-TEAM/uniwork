// Package attachtext turns a file attached to an Ask UNI question into text
// the model can read: Word, PowerPoint, Excel, ODT and plain-text files. The
// server re-reads each file on every turn and never stores what it extracts.
//
// It is a leaf: standard library only, nothing from the rest of the repo.
package attachtext

import (
	"bufio"
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
func plainDoc(r io.ReaderAt, size int64) (Doc, error) {
	if size < 0 || size > maxReadBytes {
		return Doc{}, unreadable(errOverLimit)
	}
	keep := budget{maxRetained}
	br := bufio.NewReader(io.NewSectionReader(r, 0, size))
	d := Doc{Unit: "line"}
	for first := true; ; first = false {
		line, err := br.ReadString('\n')
		if err != nil && err != io.EOF {
			return Doc{}, unreadable(err)
		}
		if first {
			line = strings.TrimPrefix(line, "\uFEFF")
		}
		line = strings.TrimRight(line, "\r\n")
		if strings.TrimSpace(line) != "" {
			text := strings.ToValidUTF8(line, "\uFFFD")
			if err := keep.add(&d.Parts, Part{Text: text}); err != nil {
				return Doc{}, err
			}
		}
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
