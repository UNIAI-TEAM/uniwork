package document

import (
	"archive/zip"
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

const (
	tDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	tXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	tPPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

type zipEntry struct {
	name   string
	body   []byte
	stored bool
}

func buildZip(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		method := zip.Deflate
		if e.stored {
			method = zip.Store
		}
		w, err := zw.CreateHeader(&zip.FileHeader{Name: e.name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(e.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func ooxml(t *testing.T, parts ...string) []byte {
	entries := []zipEntry{{name: "[Content_Types].xml", body: []byte("<Types/>")}, {name: "_rels/.rels", body: []byte("<Relationships/>")}}
	for _, p := range parts {
		entries = append(entries, zipEntry{name: p, body: []byte("<x/>")})
	}
	return buildZip(t, entries...)
}

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func validate(body []byte, contentType string, limits FileLimits) (FileFacts, error) {
	return ValidateFile(bytes.NewReader(body), int64(len(body)), contentType, limits)
}

func wantReason(t *testing.T, err error, reason string) {
	t.Helper()
	var fe *FileError
	if !errors.As(err, &fe) {
		t.Fatalf("want FileError %s, got %v", reason, err)
	}
	if fe.Reason != reason {
		t.Fatalf("reason = %s (%s), want %s", fe.Reason, fe.Msg, reason)
	}
}

func TestValidateFileAcceptsEditableFormats(t *testing.T) {
	ole := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 504)...)
	cases := []struct {
		name, contentType, format string
		body                      []byte
	}{
		{"docx", tDOCX, "docx", ooxml(t, "word/document.xml", "word/styles.xml")},
		{"xlsx", tXLSX, "xlsx", ooxml(t, "xl/workbook.xml", "xl/worksheets/sheet1.xml")},
		{"pptx", tPPTX, "pptx", ooxml(t, "ppt/presentation.xml", "ppt/slides/slide1.xml")},
		{"pdf", "application/pdf", "pdf", []byte("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")},
		{"pdf2", "application/pdf", "pdf", []byte("%PDF-2.0\n%%EOF")},
		{"doc", "application/msword", "doc", ole},
		{"xls", "application/vnd.ms-excel", "xls", ole},
		{"ppt", "application/vnd.ms-powerpoint", "ppt", ole},
		{"text", "text/plain; charset=utf-8", "text", []byte("Biên bản họp\n")},
		{"markdown", "text/markdown", "text", []byte("# Tiêu đề\n\n- một\n")},
		{"png", "image/png", "image", pngBytes(t, 3, 2)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			facts, err := validate(c.body, c.contentType, DefaultFileLimits)
			if err != nil {
				t.Fatalf("refused: %v", err)
			}
			if facts.Format != c.format {
				t.Fatalf("format = %q, want %q", facts.Format, c.format)
			}
		})
	}
	facts, _ := validate(pngBytes(t, 3, 2), "image/png", DefaultFileLimits)
	if facts.Width != 3 || facts.Height != 2 {
		t.Fatalf("png size = %dx%d, want 3x2", facts.Width, facts.Height)
	}
}

func TestValidateFileRefusesHostilePackages(t *testing.T) {
	bomb := buildZip(t,
		zipEntry{name: "[Content_Types].xml", body: []byte("<Types/>")},
		zipEntry{name: "word/document.xml", body: bytes.Repeat([]byte("A"), 4<<20)},
	)
	many := []zipEntry{{name: "[Content_Types].xml", body: []byte("x")}, {name: "word/document.xml", body: []byte("x")}}
	for i := 0; i < 20; i++ {
		many = append(many, zipEntry{name: "word/media/p" + strings.Repeat("x", i) + ".xml", body: []byte("x")})
	}
	small := DefaultFileLimits
	small.MaxEntries = 10
	tight := DefaultFileLimits
	tight.MaxUncompressedBytes = 1 << 20

	cases := []struct {
		name, contentType, reason string
		body                      []byte
		limits                    FileLimits
	}{
		{"not a zip", tDOCX, ReasonZipUnreadable, []byte("PK\x03\x04 but not really"), DefaultFileLimits},
		{"docx without document.xml", tDOCX, ReasonOOXMLMissingPart, ooxml(t, "word/styles.xml"), DefaultFileLimits},
		{"xlsx parts in a docx", tDOCX, ReasonOOXMLMissingPart, ooxml(t, "xl/workbook.xml"), DefaultFileLimits},
		{"no content types", tPPTX, ReasonOOXMLMissingPart, buildZip(t, zipEntry{name: "ppt/presentation.xml", body: []byte("x")}), DefaultFileLimits},
		{"dot-dot entry", tDOCX, ReasonZipPath, ooxml(t, "word/document.xml", "../../etc/passwd"), DefaultFileLimits},
		{"absolute entry", tDOCX, ReasonZipPath, ooxml(t, "word/document.xml", "/etc/passwd"), DefaultFileLimits},
		{"backslash entry", tDOCX, ReasonZipPath, ooxml(t, "word/document.xml", "word\\..\\evil.xml"), DefaultFileLimits},
		{"drive entry", tDOCX, ReasonZipPath, ooxml(t, "word/document.xml", "C:/evil.xml"), DefaultFileLimits},
		{"duplicate entry", tDOCX, ReasonZipPath, ooxml(t, "word/document.xml", "WORD/document.xml"), DefaultFileLimits},
		{"macro part", tDOCX, ReasonZipMacro, ooxml(t, "word/document.xml", "word/vbaProject.bin"), DefaultFileLimits},
		{"compression ratio", tDOCX, ReasonZipRatio, bomb, DefaultFileLimits},
		{"inflated total", tDOCX, ReasonZipBomb, bomb, tight},
		{"too many entries", tDOCX, ReasonZipTooManyEntries, buildZip(t, many...), small},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := validate(c.body, c.contentType, c.limits)
			wantReason(t, err, c.reason)
		})
	}
}

func TestValidateFileRefusesBrokenFiles(t *testing.T) {
	cut := []byte("Tiếng Việ")
	cases := []struct {
		name, contentType, reason string
		body                      []byte
	}{
		{"empty", "application/pdf", ReasonEmpty, nil},
		{"pdf without header", "application/pdf", ReasonPDFHeader, []byte("hello %%EOF")},
		{"pdf without trailer", "application/pdf", ReasonPDFTrailer, append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("x"), 2048)...)},
		{"ole without signature", "application/msword", ReasonOLESignature, make([]byte, 512)},
		{"latin-1 text", "text/plain", ReasonTextEncoding, []byte("caf\xe9\n")},
		{"text with NUL", "text/markdown", ReasonTextBinary, []byte("a\x00b")},
		{"text cut mid-rune", "text/plain", ReasonTextEncoding, cut[:len(cut)-1]},
		{"png header only", "image/png", ReasonImageHeader, []byte("\x89PNG\r\n\x1a\n")},
		{"unknown type", "application/zip", ReasonUnknownType, []byte("PK")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := validate(c.body, c.contentType, DefaultFileLimits)
			wantReason(t, err, c.reason)
		})
	}
	huge := DefaultFileLimits
	huge.MaxImagePixels = 5
	_, err := validate(pngBytes(t, 3, 2), "image/png", huge)
	wantReason(t, err, ReasonImageDimensions)
}

// ODF text (G2-07b): the Q7 conversion source must be a real ODF package -
// a stored `mimetype` naming ODF text and a content.xml - before any
// conversion job can exist.
func TestValidateFileOdt(t *testing.T) {
	const odt = "application/vnd.oasis.opendocument.text"
	valid := buildZip(t,
		zipEntry{name: "mimetype", body: []byte(odt), stored: true},
		zipEntry{name: "content.xml", body: []byte("<office:document-content/>")},
	)
	facts, err := validate(valid, odt, DefaultFileLimits)
	if err != nil || facts.Format != "odt" {
		t.Fatalf("valid odt = %+v, %v", facts, err)
	}

	missing := buildZip(t, zipEntry{name: "content.xml", body: []byte("<x/>")})
	_, err = validate(missing, odt, DefaultFileLimits)
	wantReason(t, err, ReasonODFMissingPart)

	compressed := buildZip(t,
		zipEntry{name: "mimetype", body: []byte(odt)},
		zipEntry{name: "content.xml", body: []byte("<x/>")},
	)
	_, err = validate(compressed, odt, DefaultFileLimits)
	wantReason(t, err, ReasonODFMimetype)

	wrongType := buildZip(t,
		zipEntry{name: "mimetype", body: []byte("application/vnd.oasis.opendocument.spreadsheet"), stored: true},
		zipEntry{name: "content.xml", body: []byte("<x/>")},
	)
	_, err = validate(wrongType, odt, DefaultFileLimits)
	wantReason(t, err, ReasonODFMimetype)

	noContent := buildZip(t, zipEntry{name: "mimetype", body: []byte(odt), stored: true})
	_, err = validate(noContent, odt, DefaultFileLimits)
	wantReason(t, err, ReasonODFMissingPart)
}

// A multibyte rune split across the 64 KiB chunk boundary is not an error.
func TestValidateTextAcrossChunkBoundary(t *testing.T) {
	body := append(bytes.Repeat([]byte("a"), (64<<10)-1), []byte("ếb\n")...)
	if _, err := validate(body, "text/plain", DefaultFileLimits); err != nil {
		t.Fatalf("refused valid UTF-8 across a chunk: %v", err)
	}
}

// webpLossless1x1 is a real 1x1 lossless WebP (VP8L).
var webpLossless1x1 = []byte("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00")

// The files next to a Markdown/HTML page (UNI-1232): GIF and WebP pictures
// with their pixel size, SVG, CSS and JavaScript as UTF-8 text.
func TestValidateFileAcceptsPageSiblings(t *testing.T) {
	gif := []byte("GIF89a\x02\x00\x03\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x02\x00\x03\x00\x00\x02\x02D\x01\x00;")
	vp8x := append([]byte("RIFF\x16\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00"), 0x0f, 0x00, 0x00, 0x09, 0x00, 0x00)
	vp8 := append([]byte("RIFF\x16\x00\x00\x00WEBPVP8 \x0a\x00\x00\x00\x00\x00\x00\x9d\x01\x2a"), 0x05, 0x00, 0x07, 0x00)
	cases := []struct {
		name, contentType, format string
		body                      []byte
		w, h                      int
	}{
		{"gif", "image/gif", "image", gif, 2, 3},
		{"webp lossless", "image/webp", "image", webpLossless1x1, 1, 1},
		{"webp extended", "image/webp", "image", vp8x, 16, 10},
		{"webp lossy", "image/webp", "image", vp8, 5, 7},
		{"svg", "image/svg+xml", "text", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0, 0},
		{"css", "text/css", "text", []byte("body { color: #222 }\n"), 0, 0},
		{"js", "text/javascript", "text", []byte("document.title = 'Biên bản'\n"), 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			facts, err := validate(c.body, c.contentType, DefaultFileLimits)
			if err != nil {
				t.Fatalf("refused: %v", err)
			}
			if facts.Format != c.format || facts.Width != c.w || facts.Height != c.h {
				t.Fatalf("facts = %+v, want %s %dx%d", facts, c.format, c.w, c.h)
			}
		})
	}
	for name, body := range map[string][]byte{
		"not riff":      []byte("GIF89a" + strings.Repeat("\x00", 40)),
		"vp8 no start":  append([]byte("RIFF\x16\x00\x00\x00WEBPVP8 \x0a\x00\x00\x00\x00\x00\x00\x00\x00\x00"), 0x05, 0x00, 0x07, 0x00),
		"vp8l no sig":   append([]byte("RIFF\x16\x00\x00\x00WEBPVP8L\x0a\x00\x00\x00\x00"), make([]byte, 10)...),
		"unknown chunk": append([]byte("RIFF\x20\x00\x00\x00WEBPALPH\x0a\x00\x00\x00"), make([]byte, 20)...),
		"truncated":     []byte("RIFF\x00\x00\x00\x00WEBPVP8L"),
		// RA-8: lengths that do not fit the stored bytes.
		"riff past the file": webpLossless1x1[:len(webpLossless1x1)-4],
		"chunk past riff":    append(append([]byte{}, webpLossless1x1[:16]...), append([]byte{0xff, 0x00, 0x00, 0x00}, webpLossless1x1[20:]...)...),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := validate(body, "image/webp", DefaultFileLimits)
			wantReason(t, err, ReasonImageHeader)
		})
	}
}
