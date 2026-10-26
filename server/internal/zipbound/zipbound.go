// Package zipbound opens zip archives with a bounded read budget on the
// end-of-central-directory search and central directory, so a hostile archive
// cannot force archive/zip to read and materialize a huge directory before a
// caller's entry-count or name-length limits run.
package zipbound

import (
	"archive/zip"
	"errors"
	"io"
)

const (
	// MaxDirectoryBytes bounds a zip's central directory (1 MiB): archive/zip
	// allocates a File (~300 bytes) plus name and extra slices for every entry
	// it parses, while real Office/ODF packages list a few hundred entries (a
	// large deck a few thousand) and upload session probes already cap
	// central_dir_b64 at 1 MiB.
	MaxDirectoryBytes int64 = 1 << 20

	// EndRecordWindowBytes (70 KiB) covers the read window archive/zip uses to
	// find the end-of-central-directory record (up to 64 KiB + 22 B in 1 KiB
	// steps, then 65 KiB) plus the 20-byte ZIP64 locator and 56-byte ZIP64 end
	// record before reading the central directory itself.
	EndRecordWindowBytes int64 = 70 << 10
)

// ErrDirectoryTooLarge means zip.NewReader needed to read past the directory
// budget plus EndRecordWindowBytes while opening the archive.
var ErrDirectoryTooLarge = errors.New("zip directory over the 1 MiB limit")

// dirReader caps what zip.NewReader may read: the end records and the central
// directory are all it reads during NewReader, so past left bytes the directory
// is too large. Setting left below zero lifts the cap so callers can read
// entries from the returned *zip.Reader afterwards.
type dirReader struct {
	io.ReaderAt
	left int64
}

func (d *dirReader) ReadAt(p []byte, off int64) (int, error) {
	if d.left >= 0 {
		if d.left -= int64(len(p)); d.left < 0 {
			return 0, ErrDirectoryTooLarge
		}
	}
	return d.ReaderAt.ReadAt(p, off)
}

// NewReader opens a zip.Reader from r while bounding the total bytes read
// during central-directory parsing to MaxDirectoryBytes + EndRecordWindowBytes.
// Once NewReader returns, the read cap is lifted so reading individual entries
// from the returned *zip.Reader is unrestricted by the directory budget.
func NewReader(r io.ReaderAt, size int64) (*zip.Reader, error) {
	return NewReaderMax(r, size, MaxDirectoryBytes)
}

// NewReaderMax is NewReader with an explicit central-directory byte cap (a
// non-positive maxDirectory uses MaxDirectoryBytes).
func NewReaderMax(r io.ReaderAt, size, maxDirectory int64) (*zip.Reader, error) {
	if maxDirectory <= 0 {
		maxDirectory = MaxDirectoryBytes
	}
	dr := &dirReader{ReaderAt: r, left: maxDirectory + EndRecordWindowBytes}
	zr, err := zip.NewReader(dr, size)
	dr.left = -1
	return zr, err
}
