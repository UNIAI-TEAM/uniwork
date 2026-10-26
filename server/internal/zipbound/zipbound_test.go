package zipbound

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"io"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type countingReaderAt struct {
	r     io.ReaderAt
	bytes int64
	calls int
}

func (c *countingReaderAt) ReadAt(p []byte, off int64) (int, error) {
	c.calls++
	n, err := c.r.ReadAt(p, off)
	c.bytes += int64(n)
	return n, err
}

type sparseTailReaderAt struct {
	size int64
	tail []byte
}

func (s *sparseTailReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 || off >= s.size {
		return 0, io.EOF
	}
	tailStart := s.size - int64(len(s.tail))
	for i := range p {
		pos := off + int64(i)
		if pos >= s.size {
			return i, io.EOF
		}
		if pos >= tailStart {
			p[i] = s.tail[pos-tailStart]
		} else {
			p[i] = 0
		}
	}
	return len(p), nil
}

func buildArchive(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.CreateHeader(&zip.FileHeader{
			Name:   name,
			Method: zip.Store,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestNewReaderRefusesDirectoryOverCapWithinBoundedReads(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	bigName := strings.Repeat("a", 1000)
	for i := range 1500 {
		w, err := zw.Create(strconv.Itoa(i) + "/" + bigName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	raw := buf.Bytes()
	maxAllowed := MaxDirectoryBytes + EndRecordWindowBytes

	t.Run("declared_directory_over_cap", func(t *testing.T) {
		cr := &countingReaderAt{r: bytes.NewReader(raw)}
		_, err := NewReader(cr, int64(len(raw)))
		if !errors.Is(err, ErrDirectoryTooLarge) {
			t.Fatalf("err = %v, want ErrDirectoryTooLarge", err)
		}
		if cr.bytes > maxAllowed {
			t.Fatalf("bytes read = %d, want <= %d", cr.bytes, maxAllowed)
		}
	})

	t.Run("forged_small_directory_size_stopped_by_read_budget", func(t *testing.T) {
		patched := append([]byte(nil), raw...)
		eocd := bytes.LastIndex(patched, []byte("PK\x05\x06"))
		if eocd < 0 {
			t.Fatal("missing EOCD")
		}
		// Lie that directorySize is 100 bytes while keeping directoryOffset at the
		// real 1.5 MiB central directory; archive/zip resets baseOffset to 0 on its
		// compatibility probe and streams headers until dirReader stops it.
		binary.LittleEndian.PutUint32(patched[eocd+12:eocd+16], 100)
		cr := &countingReaderAt{r: bytes.NewReader(patched)}
		_, err := NewReader(cr, int64(len(patched)))
		if !errors.Is(err, ErrDirectoryTooLarge) {
			t.Fatalf("err = %v, want ErrDirectoryTooLarge", err)
		}
		if cr.bytes > maxAllowed {
			t.Fatalf("bytes read = %d, want <= %d", cr.bytes, maxAllowed)
		}
	})
}

func TestNewReaderRefusesForgedZIP64DirectoryWithoutPreallocation(t *testing.T) {
	const (
		virtualSize   int64  = 200 << 20
		forgedRecords uint64 = 106*65536 + 2 // 6,946,818 (& 0xffff == 2)
	)
	tail := buildZIP64CentralDirTail(virtualSize, []string{"[Content_Types].xml", "word/document.xml"}, forgedRecords, 0)
	sr := &sparseTailReaderAt{size: virtualSize, tail: tail}
	cr := &countingReaderAt{r: sr}

	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	_, err := NewReader(cr, virtualSize)
	runtime.ReadMemStats(&after)

	if !errors.Is(err, ErrDirectoryTooLarge) {
		t.Errorf("err = %v, want ErrDirectoryTooLarge", err)
	}
	if delta := after.TotalAlloc - before.TotalAlloc; delta > 256<<10 {
		t.Errorf("TotalAlloc delta = %d bytes, want <= %d (no multi-MiB r.File preallocation)", delta, 256<<10)
	}
	if cr.bytes > 2048 {
		t.Errorf("bytes read = %d, want <= 2048", cr.bytes)
	}

	// A forged ZIP64 directorySize > MaxDirectoryBytes with only 2 records is also refused.
	sizeTail := buildZIP64CentralDirTail(virtualSize, []string{"[Content_Types].xml", "word/document.xml"}, 2, uint64(MaxDirectoryBytes)+1)
	_, err = NewReader(&sparseTailReaderAt{size: virtualSize, tail: sizeTail}, virtualSize)
	if !errors.Is(err, ErrDirectoryTooLarge) {
		t.Fatalf("forged directorySize: err = %v, want ErrDirectoryTooLarge", err)
	}
}

func TestDirReaderExhaustionStaysExhaustedUntilLifted(t *testing.T) {
	raw := bytes.Repeat([]byte("a"), 256)
	cr := &countingReaderAt{r: bytes.NewReader(raw)}
	dr := &dirReader{ReaderAt: cr, left: 100}

	buf := make([]byte, 60)
	if n, err := dr.ReadAt(buf, 0); err != nil || n != 60 {
		t.Fatalf("first ReadAt = (%d, %v), want (60, nil)", n, err)
	}
	if n, err := dr.ReadAt(buf, 60); !errors.Is(err, ErrDirectoryTooLarge) || n != 0 {
		t.Fatalf("exhausting ReadAt = (%d, %v), want (0, ErrDirectoryTooLarge)", n, err)
	}
	// A subsequent smaller ReadAt after exhaustion must still fail rather than
	// treating negative left as unlimited.
	if n, err := dr.ReadAt(buf[:10], 60); !errors.Is(err, ErrDirectoryTooLarge) || n != 0 {
		t.Fatalf("post-exhaustion ReadAt = (%d, %v), want (0, ErrDirectoryTooLarge)", n, err)
	}
	if cr.bytes != 60 {
		t.Fatalf("underlying bytes read = %d, want 60", cr.bytes)
	}

	dr.lifted = true
	if n, err := dr.ReadAt(buf, 60); err != nil || n != 60 {
		t.Fatalf("post-lift ReadAt = (%d, %v), want (60, nil)", n, err)
	}
}

func TestNewReaderOpensNormalOOXMLAndReadsEntriesAfterOpen(t *testing.T) {
	// Stored entry payload larger than MaxDirectoryBytes + EndRecordWindowBytes
	// proves the cap is lifted once the central directory has been parsed.
	bigPayload := strings.Repeat("<w:p/>", int((MaxDirectoryBytes+EndRecordWindowBytes)/6)+2048)
	cases := []struct {
		name  string
		parts map[string]string
		main  string
	}{
		{
			name: "docx",
			parts: map[string]string{
				"[Content_Types].xml": "<Types/>",
				"_rels/.rels":         "<Relationships/>",
				"word/document.xml":   bigPayload,
			},
			main: "word/document.xml",
		},
		{
			name: "xlsx",
			parts: map[string]string{
				"[Content_Types].xml": "<Types/>",
				"_rels/.rels":         "<Relationships/>",
				"xl/workbook.xml":     "<workbook/>",
			},
			main: "xl/workbook.xml",
		},
		{
			name: "pptx",
			parts: map[string]string{
				"[Content_Types].xml":  "<Types/>",
				"_rels/.rels":          "<Relationships/>",
				"ppt/presentation.xml": "<presentation/>",
			},
			main: "ppt/presentation.xml",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := buildArchive(t, c.parts)
			zr, err := NewReader(bytes.NewReader(raw), int64(len(raw)))
			if err != nil {
				t.Fatalf("NewReader(%s): %v", c.name, err)
			}
			rc, err := zr.Open(c.main)
			if err != nil {
				t.Fatalf("Open(%s): %v", c.main, err)
			}
			got, err := io.ReadAll(rc)
			_ = rc.Close()
			if err != nil {
				t.Fatalf("ReadAll(%s): %v", c.main, err)
			}
			if string(got) != c.parts[c.main] {
				t.Fatalf("entry len = %d, want %d", len(got), len(c.parts[c.main]))
			}
		})
	}
}

// buildZIP64CentralDirTail builds a ZIP64 central directory tail (central
// directory headers + ZIP64 EOCD + ZIP64 locator + standard EOCD) with the
// given entry names and declared ZIP64 record count / optional directorySize
// override.
func buildZIP64CentralDirTail(virtualSize int64, names []string, declaredRecords, declaredDirSize uint64) []byte {
	var cd bytes.Buffer
	for _, name := range names {
		var cdfh [46]byte
		copy(cdfh[0:4], "PK\x01\x02")
		binary.LittleEndian.PutUint16(cdfh[4:6], 45)
		binary.LittleEndian.PutUint16(cdfh[6:8], 45)
		binary.LittleEndian.PutUint16(cdfh[28:30], uint16(len(name)))
		cd.Write(cdfh[:])
		cd.WriteString(name)
	}
	cdSize := uint64(cd.Len())
	if declaredDirSize != 0 {
		cdSize = declaredDirSize
	}
	tailLen := int64(cd.Len() + zip64EOCDLen + zip64LocatorLen + eocdLen)
	cdOffset := uint64(virtualSize - tailLen)
	zip64EOCDOffset := cdOffset + uint64(cd.Len())

	var b bytes.Buffer
	b.Write(cd.Bytes())

	var z64eocd [56]byte
	copy(z64eocd[0:4], "PK\x06\x06")
	binary.LittleEndian.PutUint64(z64eocd[4:12], 44)
	binary.LittleEndian.PutUint16(z64eocd[12:14], 45)
	binary.LittleEndian.PutUint16(z64eocd[14:16], 45)
	binary.LittleEndian.PutUint64(z64eocd[24:32], declaredRecords)
	binary.LittleEndian.PutUint64(z64eocd[32:40], declaredRecords)
	binary.LittleEndian.PutUint64(z64eocd[40:48], cdSize)
	binary.LittleEndian.PutUint64(z64eocd[48:56], cdOffset)
	b.Write(z64eocd[:])

	var z64loc [20]byte
	copy(z64loc[0:4], "PK\x06\x07")
	binary.LittleEndian.PutUint32(z64loc[4:8], 0)
	binary.LittleEndian.PutUint64(z64loc[8:16], zip64EOCDOffset)
	binary.LittleEndian.PutUint32(z64loc[16:20], 1)
	b.Write(z64loc[:])

	var eocd [22]byte
	copy(eocd[0:4], "PK\x05\x06")
	binary.LittleEndian.PutUint16(eocd[8:10], 0xffff)
	binary.LittleEndian.PutUint16(eocd[10:12], 0xffff)
	binary.LittleEndian.PutUint32(eocd[12:16], 0xffffffff)
	binary.LittleEndian.PutUint32(eocd[16:20], 0xffffffff)
	b.Write(eocd[:])
	return b.Bytes()
}

// buildZIP64Archive constructs a minimal valid ZIP64 archive (one stored entry,
// central directory, ZIP64 end of central directory record, ZIP64 end of
// central directory locator, and standard EOCD with 0xffff/0xffffffff sentinel
// fields forcing archive/zip through its ZIP64 directory parser).
func buildZIP64Archive(name string, payload []byte) []byte {
	var b bytes.Buffer
	crc := crc32.ChecksumIEEE(payload)
	// Local file header (30 bytes + name) + payload.
	var lfh [30]byte
	copy(lfh[0:4], "PK\x03\x04")
	binary.LittleEndian.PutUint16(lfh[4:6], 45) // version needed: 4.5 (ZIP64)
	binary.LittleEndian.PutUint16(lfh[8:10], 0) // store
	binary.LittleEndian.PutUint32(lfh[14:18], crc)
	binary.LittleEndian.PutUint32(lfh[18:22], uint32(len(payload)))
	binary.LittleEndian.PutUint32(lfh[22:26], uint32(len(payload)))
	binary.LittleEndian.PutUint16(lfh[26:28], uint16(len(name)))
	b.Write(lfh[:])
	b.WriteString(name)
	b.Write(payload)

	cdOffset := uint64(b.Len())
	// Central directory file header (46 bytes + name).
	var cdfh [46]byte
	copy(cdfh[0:4], "PK\x01\x02")
	binary.LittleEndian.PutUint16(cdfh[4:6], 45)
	binary.LittleEndian.PutUint16(cdfh[6:8], 45)
	binary.LittleEndian.PutUint16(cdfh[10:12], 0) // store
	binary.LittleEndian.PutUint32(cdfh[16:20], crc)
	binary.LittleEndian.PutUint32(cdfh[20:24], uint32(len(payload)))
	binary.LittleEndian.PutUint32(cdfh[24:28], uint32(len(payload)))
	binary.LittleEndian.PutUint16(cdfh[28:30], uint16(len(name)))
	binary.LittleEndian.PutUint32(cdfh[42:46], 0) // local header offset 0
	b.Write(cdfh[:])
	b.WriteString(name)
	cdSize := uint64(b.Len()) - cdOffset

	zip64EOCDOffset := uint64(b.Len())
	// ZIP64 end of central directory record (56 bytes).
	var z64eocd [56]byte
	copy(z64eocd[0:4], "PK\x06\x06")
	binary.LittleEndian.PutUint64(z64eocd[4:12], 44) // size of remaining record
	binary.LittleEndian.PutUint16(z64eocd[12:14], 45)
	binary.LittleEndian.PutUint16(z64eocd[14:16], 45)
	binary.LittleEndian.PutUint64(z64eocd[24:32], 1)        // entries on disk
	binary.LittleEndian.PutUint64(z64eocd[32:40], 1)        // total entries
	binary.LittleEndian.PutUint64(z64eocd[40:48], cdSize)   // central dir size
	binary.LittleEndian.PutUint64(z64eocd[48:56], cdOffset) // central dir offset
	b.Write(z64eocd[:])

	// ZIP64 end of central directory locator (20 bytes).
	var z64loc [20]byte
	copy(z64loc[0:4], "PK\x06\x07")
	binary.LittleEndian.PutUint32(z64loc[4:8], 0)
	binary.LittleEndian.PutUint64(z64loc[8:16], zip64EOCDOffset)
	binary.LittleEndian.PutUint32(z64loc[16:20], 1)
	b.Write(z64loc[:])

	// Standard EOCD (22 bytes) with 0xffff / 0xffffffff sentinels.
	var eocd [22]byte
	copy(eocd[0:4], "PK\x05\x06")
	binary.LittleEndian.PutUint16(eocd[8:10], 0xffff)
	binary.LittleEndian.PutUint16(eocd[10:12], 0xffff)
	binary.LittleEndian.PutUint32(eocd[12:16], 0xffffffff)
	binary.LittleEndian.PutUint32(eocd[16:20], 0xffffffff)
	b.Write(eocd[:])
	return b.Bytes()
}

func TestNewReaderOpensZIP64ArchiveWithinLimits(t *testing.T) {
	want := []byte("<w:document/>")
	raw := buildZIP64Archive("word/document.xml", want)
	zr, err := NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("NewReader(ZIP64): %v", err)
	}
	if len(zr.File) != 1 || zr.File[0].Name != "word/document.xml" {
		t.Fatalf("files = %+v, want [word/document.xml]", zr.File)
	}
	rc, err := zr.File[0].Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got, err := io.ReadAll(rc)
	_ = rc.Close()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("payload = %q, want %q", got, want)
	}
}
