package zipbound_test

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strconv"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/zipbound"
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

func buildArchive(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range entries {
		w, err := zw.Create(name)
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
	cr := &countingReaderAt{r: bytes.NewReader(raw)}

	_, err := zipbound.NewReader(cr, int64(len(raw)))
	if !errors.Is(err, zipbound.ErrDirectoryTooLarge) {
		t.Fatalf("err = %v, want ErrDirectoryTooLarge", err)
	}
	maxAllowed := zipbound.MaxDirectoryBytes + zipbound.EndRecordWindowBytes
	if cr.bytes > maxAllowed {
		t.Fatalf("bytes read = %d, want <= %d (cap + end-record window)", cr.bytes, maxAllowed)
	}
}

func TestNewReaderOpensNormalOOXMLAndReadsEntriesAfterOpen(t *testing.T) {
	// Entry payload larger than MaxDirectoryBytes proves the cap is lifted once
	// the central directory has been parsed.
	bigPayload := strings.Repeat("<w:p/>", int(zipbound.MaxDirectoryBytes/6)+1024)
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
			zr, err := zipbound.NewReader(bytes.NewReader(raw), int64(len(raw)))
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

// buildZIP64Archive constructs a minimal valid ZIP64 archive (one stored entry,
// central directory, ZIP64 end of central directory record, ZIP64 end of
// central directory locator, and standard EOCD with 0xffff/0xffffffff sentinel
// fields forcing archive/zip through its ZIP64 directory parser).
func buildZIP64Archive(name string, payload []byte) []byte {
	var b bytes.Buffer
	// Local file header (30 bytes + name) + payload.
	var lfh [30]byte
	copy(lfh[0:4], "PK\x03\x04")
	binary.LittleEndian.PutUint16(lfh[4:6], 45) // version needed: 4.5 (ZIP64)
	binary.LittleEndian.PutUint16(lfh[8:10], 0) // store
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
	raw := buildZIP64Archive("word/document.xml", []byte("<w:document/>"))
	zr, err := zipbound.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("NewReader(ZIP64): %v", err)
	}
	if len(zr.File) != 1 || zr.File[0].Name != "word/document.xml" {
		t.Fatalf("files = %+v, want [word/document.xml]", zr.File)
	}
}
