// Package zipbound opens zip archives with a bounded read budget on the
// end-of-central-directory search and central directory, so a hostile archive
// cannot force archive/zip to read and materialize a huge directory before a
// caller's entry-count or name-length limits run.
package zipbound

import (
	"archive/zip"
	"encoding/binary"
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

	// EndRecordWindowBytes (76 KiB) covers archive/zip's non-directory reads
	// during NewReader: the 1 KiB + 65 KiB end-of-central-directory tail search,
	// the 76-byte ZIP64 locator + end record (20 B + 56 B), and one 4 KiB
	// bufio.NewReader lookahead past the end of the central directory.
	EndRecordWindowBytes int64 = 76 << 10

	eocdLen                  = 22
	zip64LocatorLen          = 20
	zip64EOCDLen             = 56
	maxEOCDSearchBytes       = eocdLen + 0xffff // 65,557 bytes
	minCentralDirHeaderBytes = 46
)

// ErrDirectoryTooLarge means zip.NewReader needed to read past the directory
// budget plus EndRecordWindowBytes while opening the archive.
var ErrDirectoryTooLarge = errors.New("zip directory over the 1 MiB limit")

// dirReader caps what zip.NewReader may read: the end records and the central
// directory are all it reads during NewReader, so past left bytes the directory
// is too large. Once exhausted (left < 0 while !lifted), every subsequent
// ReadAt continues to fail with ErrDirectoryTooLarge; setting lifted = true
// after NewReader returns allows callers to read entries afterwards.
type dirReader struct {
	io.ReaderAt
	left   int64
	lifted bool
}

func (d *dirReader) ReadAt(p []byte, off int64) (int, error) {
	if !d.lifted {
		if int64(len(p)) > d.left {
			d.left = -1
			return 0, ErrDirectoryTooLarge
		}
		d.left -= int64(len(p))
	}
	return d.ReaderAt.ReadAt(p, off)
}

// NewReader opens a zip.Reader from r while rejecting declared central
// directories larger than MaxDirectoryBytes (or more than MaxDirectoryBytes/46
// records) before archive/zip preallocates its File slice, and bounding total
// bytes read during central-directory parsing to MaxDirectoryBytes +
// EndRecordWindowBytes. Once NewReader succeeds, the read cap is lifted so
// reading individual entries from the returned *zip.Reader is unrestricted by
// the directory budget.
func NewReader(r io.ReaderAt, size int64) (*zip.Reader, error) {
	if err := checkDirectoryEnd(r, size); err != nil {
		return nil, err
	}
	dr := &dirReader{ReaderAt: r, left: MaxDirectoryBytes + EndRecordWindowBytes}
	zr, err := zip.NewReader(dr, size)
	if err != nil {
		return nil, err
	}
	dr.lifted = true
	return zr, nil
}

// checkDirectoryEnd inspects the end-of-central-directory record (and the ZIP64
// locator/record when the 32-bit fields are saturated) using the same tail
// search window as archive/zip, and returns ErrDirectoryTooLarge when the
// declared directory size exceeds MaxDirectoryBytes or the declared entry count
// exceeds MaxDirectoryBytes/46. Any I/O or format error returns nil so
// zip.NewReader decides under dirReader's byte budget.
func checkDirectoryEnd(r io.ReaderAt, size int64) error {
	if size < eocdLen {
		return nil
	}
	var eocd [eocdLen]byte
	var eocdOffset int64 = -1
	for _, bLen := range []int64{1024, maxEOCDSearchBytes} {
		if bLen > size {
			bLen = size
		}
		buf := make([]byte, int(bLen))
		if n, err := r.ReadAt(buf, size-bLen); err != nil && (err != io.EOF || int64(n) != bLen) {
			return nil
		}
		if p := findEOCD(buf); p >= 0 {
			copy(eocd[:], buf[p:p+eocdLen])
			eocdOffset = size - bLen + int64(p)
			break
		}
		if bLen == size {
			return nil
		}
	}
	if eocdOffset < 0 {
		return nil
	}
	records := uint64(binary.LittleEndian.Uint16(eocd[10:12]))
	dirSize := uint64(binary.LittleEndian.Uint32(eocd[12:16]))
	dirOffset := uint64(binary.LittleEndian.Uint32(eocd[16:20]))
	if records == 0xffff || dirSize == 0xffffffff || dirOffset == 0xffffffff {
		if locOffset := eocdOffset - zip64LocatorLen; locOffset >= 0 {
			var loc [zip64LocatorLen]byte
			if n, err := r.ReadAt(loc[:], locOffset); err != nil && (err != io.EOF || n != zip64LocatorLen) {
				return nil
			}
			if string(loc[0:4]) == "PK\x06\x07" &&
				binary.LittleEndian.Uint32(loc[4:8]) == 0 &&
				binary.LittleEndian.Uint32(loc[16:20]) == 1 {
				if z64Offset := int64(binary.LittleEndian.Uint64(loc[8:16])); z64Offset >= 0 {
					var z64 [zip64EOCDLen]byte
					if n, err := r.ReadAt(z64[:], z64Offset); err != nil && (err != io.EOF || n != zip64EOCDLen) {
						return nil
					}
					if string(z64[0:4]) != "PK\x06\x06" {
						return nil
					}
					records = binary.LittleEndian.Uint64(z64[32:40])
					dirSize = binary.LittleEndian.Uint64(z64[40:48])
				}
			}
		}
	}
	if dirSize > uint64(MaxDirectoryBytes) || records > uint64(MaxDirectoryBytes)/minCentralDirHeaderBytes {
		return ErrDirectoryTooLarge
	}
	return nil
}

func findEOCD(b []byte) int {
	for i := len(b) - eocdLen; i >= 0; i-- {
		if b[i] == 'P' && b[i+1] == 'K' && b[i+2] == 0x05 && b[i+3] == 0x06 {
			n := int(binary.LittleEndian.Uint16(b[i+eocdLen-2:]))
			if n+eocdLen+i <= len(b) {
				return i
			}
		}
	}
	return -1
}
