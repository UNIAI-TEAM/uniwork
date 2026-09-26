package filescontract

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"strings"
)

// Sample is one minimal real body, the filename a client would send with it,
// and the type files.DetectContentType must verify it as. The suite uploads
// them against every purpose, and a module's own upload tests may use them to
// reach a type the bytes of a PNG cannot (an OOXML document, a voice note).
type Sample struct {
	Name        string
	Filename    string
	Body        []byte
	ContentType string
}

// Samples returns one sample per type DetectContentType returns that a
// registry row allows or maps with CanonicalTypes. ContentType is the
// detector's answer; a purpose stores Policy.Canonical of it. Every call
// builds fresh bodies, so a caller may keep or mutate them.
func Samples() []Sample {
	return []Sample{
		{"jpeg", "photo.jpg", jpegSample(), "image/jpeg"},
		{"png", "photo.png", pngSample(), "image/png"},
		{"gif", "photo.gif", []byte("GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"), "image/gif"},
		{"webp", "photo.webp", riff("WEBP", "VP8 ", make([]byte, 10)), "image/webp"},
		{"bmp", "photo.bmp", bmpSample(), "image/bmp"},
		{"pdf", "report.pdf", []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"), "application/pdf"},
		{"text", "notes.txt", []byte("Biên bản họp, không phải ảnh.\n"), "text/plain"},
		{"markdown", "notes.md", []byte("# Biên bản\n\n- một\n- hai\n"), "text/markdown"},
		{"csv", "export.csv", []byte("id,tên\n1,Ánh\n2,Bình\n"), "text/csv"},
		{"ndjson", "export.ndjson", []byte("{\"id\":\"1\",\"action\":\"task.created\"}\n{\"id\":\"2\",\"action\":\"task.updated\"}\n"), "application/x-ndjson"},
		{"zip", "export.zip", zipSample("export.ndjson", "export.csv"), "application/zip"},
		{"docx", "brief.docx", ooxmlSample("word/document.xml", "word/styles.xml"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"xlsx", "sheet.xlsx", ooxmlSample("xl/workbook.xml", "xl/worksheets/sheet1.xml"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"pptx", "deck.pptx", ooxmlSample("ppt/presentation.xml", "ppt/slides/slide1.xml"), "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
		{"doc", "brief.doc", cfbSample(), "application/msword"},
		{"xls", "sheet.xls", cfbSample(), "application/vnd.ms-excel"},
		{"ppt", "deck.ppt", cfbSample(), "application/vnd.ms-powerpoint"},
		{"webm", "voice.webm", webmSample(), "video/webm"},
		{"ogg_opus", "voice.ogg", oggSample("OpusHead\x01\x01\x38\x01\x80\xbb\x00\x00\x00\x00\x00"), "audio/ogg"},
		{"ogg_theora", "call.ogv", oggSample("\x80theora\x03\x02\x01"), "video/ogg"},
		{"ogg_other_codec", "voice.ogg", oggSample("\x7fmystery"), "application/ogg"},
		{"m4a", "voice.m4a", ftypSample("M4A ", "M4A ", "mp42", "isom"), "audio/mp4"},
		{"mp4", "call.mp4", ftypSample("isom", "isom", "iso2", "avc1", "mp41"), "video/mp4"},
	}
}

// MisnamedSamples are bodies whose filename claims a type the bytes do not
// prove. ContentType is what the bytes verify as: the name never moves a file
// into another family, so a purpose accepts one of these only when it allows
// the bytes' own type.
func MisnamedSamples() []Sample {
	exe := append([]byte("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"), make([]byte, 48)...)
	return []Sample{
		{"binary_named_pdf", "report.pdf", exe, "application/octet-stream"},
		{"binary_named_docx", "brief.docx", exe, "application/octet-stream"},
		{"text_named_docx", "brief.docx", []byte("chỉ là văn bản\n"), "text/plain"},
		{"text_named_png", "photo.png", []byte("chỉ là văn bản\n"), "text/plain"},
		{"zip_named_csv", "export.csv", zipSample("a.txt"), "application/zip"},
		{"zip_named_docx", "brief.docx", zipSample("word/document.xml"), "application/zip"},
		{"cfb_named_docx", "brief.docx", cfbSample(), "application/octet-stream"},
		{"cfb_named_txt", "notes.txt", cfbSample(), "application/octet-stream"},
		{"pdf_named_doc", "brief.doc", []byte("%PDF-1.7\n%%EOF\n"), "application/pdf"},
		{"png_named_csv", "export.csv", pngSample(), "image/png"},
		{"latin1_named_csv", "export.csv", []byte("id,t\xe9n\n1,\xc1nh\n"), "text/plain"},
	}
}

func jpegSample() []byte {
	b := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00}
	return append(b, 0xff, 0xd9)
}

func pngSample() []byte {
	b := []byte("\x89PNG\r\n\x1a\n")
	// IHDR: 1x1, 8-bit RGBA. The CRC is not checked by any sniffer.
	b = append(b, 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89)
	return append(b, 0, 0, 0, 0, 'I', 'E', 'N', 'D', 0xae, 0x42, 0x60, 0x82)
}

func bmpSample() []byte {
	b := make([]byte, 58)
	copy(b, "BM")
	binary.LittleEndian.PutUint32(b[2:], uint32(len(b)))
	binary.LittleEndian.PutUint32(b[10:], 54)
	binary.LittleEndian.PutUint32(b[14:], 40)
	binary.LittleEndian.PutUint32(b[18:], 1)
	binary.LittleEndian.PutUint32(b[22:], 1)
	binary.LittleEndian.PutUint16(b[26:], 1)
	binary.LittleEndian.PutUint16(b[28:], 24)
	return b
}

func riff(form, chunk string, payload []byte) []byte {
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(4+8+len(payload)))
	b.WriteString(form)
	b.WriteString(chunk)
	_ = binary.Write(&b, binary.LittleEndian, uint32(len(payload)))
	b.Write(payload)
	return b.Bytes()
}

// zipSample is a real zip written by archive/zip, which streams entries with
// data descriptors the way most writers do.
func zipSample(names ...string) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range names {
		f, err := w.Create(name)
		if err != nil {
			panic(err)
		}
		if _, err := f.Write([]byte(strings.Repeat("x", 32))); err != nil {
			panic(err)
		}
	}
	if err := w.Close(); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// ooxmlSample is the smallest package an OOXML reader opens far enough to
// know its kind: the content-types part, the package relationships and the
// main parts.
func ooxmlSample(parts ...string) []byte {
	return zipSample(append([]string{"[Content_Types].xml", "_rels/.rels"}, parts...)...)
}

// cfbSample is an OLE compound file header followed by one empty sector. DOC,
// XLS and PPT share it; only the directory streams inside differ.
func cfbSample() []byte {
	b := make([]byte, 1024)
	copy(b, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1})
	binary.LittleEndian.PutUint16(b[24:], 0x003e) // minor version
	binary.LittleEndian.PutUint16(b[26:], 0x0003) // major version 3
	binary.LittleEndian.PutUint16(b[28:], 0xfffe) // little-endian byte order
	binary.LittleEndian.PutUint16(b[30:], 9)      // 512-byte sectors
	binary.LittleEndian.PutUint16(b[32:], 6)      // 64-byte mini sectors
	return b
}

// webmSample is an EBML header declaring the webm DocType, then the start of a
// Segment, as MediaRecorder writes it.
func webmSample() []byte {
	b := []byte{0x1a, 0x45, 0xdf, 0xa3, 0x9f,
		0x42, 0x86, 0x81, 0x01, // EBMLVersion 1
		0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion 1
		0x42, 0xf2, 0x81, 0x04, // EBMLMaxIDLength 4
		0x42, 0xf3, 0x81, 0x08, // EBMLMaxSizeLength 8
		0x42, 0x82, 0x84, 'w', 'e', 'b', 'm', // DocType webm
		0x42, 0x87, 0x81, 0x04, // DocTypeVersion 4
		0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion 2
		0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // Segment, unknown size
	}
	return append(b, make([]byte, 32)...)
}

// oggSample is one beginning-of-stream Ogg page whose single segment is the
// codec identification header.
func oggSample(ident string) []byte {
	b := []byte("OggS")
	b = append(b, 0x00, 0x02)          // version, BOS flag
	b = append(b, make([]byte, 8)...)  // granule position
	b = append(b, 1, 0, 0, 0)          // serial
	b = append(b, make([]byte, 4)...)  // page sequence
	b = append(b, make([]byte, 4)...)  // checksum (unchecked)
	b = append(b, 1, byte(len(ident))) // one segment
	return append(b, ident...)
}

// ftypSample is an ftyp box (major brand, minor version, compatible brands)
// followed by an empty mdat box.
func ftypSample(major string, compatible ...string) []byte {
	var b bytes.Buffer
	_ = binary.Write(&b, binary.BigEndian, uint32(16+4*len(compatible)))
	b.WriteString("ftyp")
	b.WriteString(major)
	_ = binary.Write(&b, binary.BigEndian, uint32(0x200))
	for _, brand := range compatible {
		b.WriteString(brand)
	}
	_ = binary.Write(&b, binary.BigEndian, uint32(8))
	b.WriteString("mdat")
	return b.Bytes()
}
