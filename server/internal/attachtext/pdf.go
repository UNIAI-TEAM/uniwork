package attachtext

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

const (
	// maxPDFBytes is the largest PDF pdfcpu will open: a little over the 20 MiB
	// upload cap, enforced by pdfcpu before it parses anything.
	maxPDFBytes = 32 << 20
	// maxPDFObjects caps the objects a cross-reference table may declare. pdfcpu
	// allocates an entry for each, and a 20 MiB file of 60,000 small pages
	// (120,000 objects) already takes about 530 MiB to open, so a file that
	// claims millions must fail early. Real PDFs of this size stay below it.
	maxPDFObjects = 1 << 18
	// pdfTimeout bounds the CPU one call may spend on a hostile file.
	pdfTimeout = 30 * time.Second
)

// errNoPages: a PDF whose page tree is empty is valid but has nothing to read.
var errNoPages = errors.New("PDF has no pages")

// PDFPages counts the pages of a PDF. A PDF that is damaged, has no pages,
// needs a password to open, or is too large or complex to open safely returns
// ErrUnreadable. A PDF with only an owner password opens without one and is
// counted.
func PDFPages(r io.ReadSeeker) (int, error) {
	return pdfWork(func(ctx context.Context, conf *model.Configuration) (int, error) {
		n, err := api.PageCount(ctx, r, conf)
		if err == nil && n < 1 {
			return 0, errNoPages
		}
		return n, err
	})
}

// TrimPDF returns a PDF made of the first keep pages of r, or the bytes of r
// unchanged when it has no more than keep pages. keep below 1 is a caller bug
// and returns a plain error. Errors from the file itself are ErrUnreadable, as
// in PDFPages. The result of a trim is never encrypted, even when r had an
// owner password.
func TrimPDF(r io.ReadSeeker, keep int) ([]byte, error) {
	if keep < 1 {
		return nil, fmt.Errorf("attachtext: cannot keep %d PDF pages", keep)
	}
	return pdfWork(func(ctx context.Context, conf *model.Configuration) ([]byte, error) {
		conf.Cmd = model.TRIM
		src, err := api.ReadValidateAndOptimize(ctx, r, conf, nil)
		if err != nil {
			return nil, err
		}
		if src.PageCount < 1 {
			return nil, errNoPages
		}
		if src.PageCount <= keep {
			// pdfcpu has already refused anything over maxPDFBytes.
			if _, err := r.Seek(0, io.SeekStart); err != nil {
				return nil, err
			}
			return io.ReadAll(r)
		}
		pages := make([]int, keep)
		for i := range pages {
			pages[i] = i + 1
		}
		dst, err := pdfcpu.ExtractPages(ctx, src, pages, false)
		if err != nil {
			return nil, err
		}
		var out bytes.Buffer
		if err := api.WriteContext(ctx, dst, &out); err != nil {
			return nil, err
		}
		return out.Bytes(), nil
	})
}

// pdfWork runs one pdfcpu job on an untrusted file: with a configuration that
// reads and writes nothing on disk and logs nothing (pdfcpu's loggers are off
// until someone sets them), under a deadline and tight resource limits, and
// with every failure, a parser panic included, turned into ErrUnreadable.
func pdfWork[T any](job func(context.Context, *model.Configuration) (T, error)) (out T, err error) {
	defer func() {
		if p := recover(); p != nil {
			var zero T
			out, err = zero, unreadable(fmt.Errorf("PDF parser failed: %v", p))
		}
	}()
	// The stateless configuration never touches the user's config directory.
	conf := model.NewStatelessConfiguration()
	conf.Limits.MaxInputBytes = maxPDFBytes
	conf.Limits.MaxStreamBytes = maxPDFBytes
	conf.Limits.MaxDecodeBytes = maxReadBytes
	conf.Limits.MaxObjectCount = maxPDFObjects
	conf.Limits.MaxXRefEntries = maxPDFObjects
	ctx, cancel := context.WithTimeout(context.Background(), pdfTimeout)
	defer cancel()
	if out, err = job(ctx, conf); err != nil {
		var zero T
		return zero, unreadable(err)
	}
	return out, nil
}
