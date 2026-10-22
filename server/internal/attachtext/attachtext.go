// Package attachtext turns a file attached to an Ask UNI question into text
// the model can read: Word, PowerPoint, Excel, ODT and plain-text files. The
// server re-reads each file on every turn and never stores what it extracts.
//
// It is a leaf: standard library only, nothing from the rest of the repo.
package attachtext

import (
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

// maxReadBytes bounds what one file may decompress to (all zip entries
// together) or, for a plain-text file, how large it may be.
const maxReadBytes = 64 << 20

// Part is one paragraph, slide, row or line. Label names a sheet ("Doanh thu")
// or a slide ("Slide 3"). A Part without Text is a heading (Label set) or a
// blank line; only Parts with Text count as units of the document.
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

var errOverLimit = errors.New("decompressed data over the 64 MiB limit")

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

// plainDoc splits text into lines, one Part each. Blank lines stay (as Parts
// without Text) so Markdown and CSV keep their shape; invalid UTF-8 becomes U+FFFD.
func plainDoc(r io.ReaderAt, size int64) (Doc, error) {
	if size < 0 || size > maxReadBytes {
		return Doc{}, unreadable(errOverLimit)
	}
	b, err := io.ReadAll(io.NewSectionReader(r, 0, size))
	if err != nil {
		return Doc{}, unreadable(err)
	}
	s := strings.ToValidUTF8(string(b), "\uFFFD")
	s = strings.TrimPrefix(s, "\uFEFF")
	lines := strings.Split(s, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	d := Doc{Unit: "line", Parts: make([]Part, len(lines))}
	for i, l := range lines {
		if l = strings.TrimRight(l, "\r"); strings.TrimSpace(l) != "" {
			d.Parts[i].Text = l
		}
	}
	return d, nil
}

// EstimateTokens is a cheap upper-ish bound on the model tokens of s: one per
// three characters, which holds for Vietnamese as well as English.
func EstimateTokens(s string) int {
	return (utf8.RuneCountInString(s) + 2) / 3
}
