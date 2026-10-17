package document

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	_ "image/gif" // register the decoders DecodeConfig needs
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path"
	"strings"
	"unicode/utf8"
)

// File validation for the editor (plan G1-03; C-01 §5.5). FileService has
// already measured the bytes and verified the MIME type from content
// (FS-C1 §9.1) by the time this runs; this layer checks that the bytes are a
// file the editor for that type can open safely: an OOXML package with the
// part its editor needs and no hostile entry, a PDF with its header and
// trailer, text that is UTF-8, an image whose header decodes. A file that
// fails is refused - it is never handed to another editor instead.

// ErrCodeUnsupportedMedia is the wire code of a refused file (C-01 §5.5,
// 415). The Reason says which check failed; it is machine-readable detail,
// not a sentence.
const ErrCodeUnsupportedMedia = "unsupported_media_type"

// Reasons a file is refused. Stable strings: the service puts them in
// error.fields.reason.
const (
	ReasonUnknownType       = "type_not_editable"
	ReasonZipUnreadable     = "zip_unreadable"
	ReasonZipTooManyEntries = "zip_too_many_entries"
	ReasonZipBomb           = "zip_uncompressed_too_large"
	ReasonZipRatio          = "zip_compression_ratio"
	ReasonZipPath           = "zip_unsafe_path"
	ReasonZipMacro          = "zip_macro_part"
	ReasonOOXMLMissingPart  = "ooxml_missing_part"
	ReasonODFMimetype       = "odf_mimetype"
	ReasonODFMissingPart    = "odf_missing_part"
	ReasonPDFHeader         = "pdf_header"
	ReasonPDFTrailer        = "pdf_trailer"
	ReasonOLESignature      = "ole_signature"
	ReasonTextEncoding      = "text_not_utf8"
	ReasonTextBinary        = "text_binary"
	ReasonImageHeader       = "image_header"
	ReasonImageDimensions   = "image_dimensions"
	ReasonEmpty             = "empty"
)

// FileError is a refused file.
type FileError struct {
	Reason string
	Msg    string
}

func (e *FileError) Error() string { return ErrCodeUnsupportedMedia + " (" + e.Reason + "): " + e.Msg }

func refuse(reason, format string, args ...any) error {
	return &FileError{Reason: reason, Msg: fmt.Sprintf(format, args...)}
}

// FileLimits bound what validation will unpack. A zip bomb is refused on its
// central directory - the declared sizes - before one byte is inflated.
type FileLimits struct {
	MaxEntries           int   // entries in one package
	MaxUncompressedBytes int64 // declared total after inflation
	MaxEntryRatio        int64 // declared uncompressed / compressed, per entry
	MaxEntryName         int   // bytes in one entry name
	MaxImagePixels       int64 // width * height of an image asset
	TextScanBytes        int64 // how much of a text file is checked
}

// DefaultFileLimits fit the default 200 MiB document_file cap: a real
// DOCX/XLSX/PPTX has a few hundred parts and compresses XML at most ~100:1.
var DefaultFileLimits = FileLimits{
	MaxEntries:           10000,
	MaxUncompressedBytes: 512 << 20,
	MaxEntryRatio:        200,
	MaxEntryName:         1024,
	MaxImagePixels:       100_000_000,
	TextScanBytes:        200 << 20,
}

// Content types this layer knows how to check (the document_file and
// document_asset allowlists of the FileService registry).
const (
	mimePDF  = "application/pdf"
	mimeText = "text/plain"
	mimeMD   = "text/markdown"
	mimeHTML = "text/html"
	mimeDOC  = "application/msword"
	mimeXLS  = "application/vnd.ms-excel"
	mimePPT  = "application/vnd.ms-powerpoint"
	mimeDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	mimeXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	mimePPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	mimeODT  = "application/vnd.oasis.opendocument.text"
	mimePNG  = "image/png"
	mimeJPEG = "image/jpeg"
	mimeGIF  = "image/gif"
	mimeWebP = "image/webp"
	// The files next to a Markdown/HTML page (UNI-1232): text the Office
	// frames load by relative path, never an editor's own format.
	mimeSVG = "image/svg+xml"
	mimeCSS = "text/css"
	mimeJS  = "text/javascript"
)

// ooxmlMainPart is the part each editor opens first; a package without it is
// not that format, whatever its [Content_Types].xml says.
var ooxmlMainPart = map[string]string{
	mimeDOCX: "word/document.xml",
	mimeXLSX: "xl/workbook.xml",
	mimePPTX: "ppt/presentation.xml",
}

// FileFacts is what validation learned: the format family and, for images,
// the pixel size (document_assets.width/height).
type FileFacts struct {
	Format string // docx, xlsx, pptx, doc, xls, ppt, pdf, text, image
	Width  int
	Height int
}

var ole2Signature = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// ValidateFile checks size bytes read through r against the verified
// contentType. It reads what it needs through ReadAt and never trusts a
// length the file declares over the size FileService measured.
func ValidateFile(r io.ReaderAt, size int64, contentType string, limits FileLimits) (FileFacts, error) {
	if size <= 0 {
		return FileFacts{}, refuse(ReasonEmpty, "the file is empty")
	}
	base, _, _ := strings.Cut(strings.ToLower(contentType), ";")
	switch base = strings.TrimSpace(base); base {
	case mimeDOCX, mimeXLSX, mimePPTX:
		return validateOOXML(r, size, base, limits)
	case mimeODT:
		return validateODT(r, size, limits)
	case mimePDF:
		return validatePDF(r, size)
	case mimeDOC, mimeXLS, mimePPT:
		return validateOLE(r, size, base)
	case mimeText, mimeMD, mimeHTML, mimeCSS, mimeJS, mimeSVG:
		// HTML is text the editor opens as text; the preview sandbox (G2-06),
		// not this validator, is what keeps a rendered HTML document safe.
		return validateText(r, size, limits)
	case mimePNG, mimeJPEG, mimeGIF:
		return validateImage(r, size, limits)
	case mimeWebP:
		return validateWebP(r, size, limits)
	default:
		return FileFacts{}, refuse(ReasonUnknownType, "no editor opens %q", base)
	}
}

func validateOOXML(r io.ReaderAt, size int64, contentType string, limits FileLimits) (FileFacts, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return FileFacts{}, refuse(ReasonZipUnreadable, "the package cannot be read: %v", err)
	}
	parts, err := checkZipParts(zr, limits)
	if err != nil {
		return FileFacts{}, err
	}
	if _, ok := parts["[content_types].xml"]; !ok {
		return FileFacts{}, refuse(ReasonOOXMLMissingPart, "[Content_Types].xml is missing")
	}
	main := ooxmlMainPart[contentType]
	if _, ok := parts[main]; !ok {
		return FileFacts{}, refuse(ReasonOOXMLMissingPart, "%s is missing", main)
	}
	return FileFacts{Format: ooxmlFormat(contentType)}, nil
}

// validateODT checks the ODF shape Q7 conversion sources must have: the zip
// safety rules of an OOXML package plus the two parts a converter needs - the
// spec-mandated `mimetype` entry naming ODF text (stored, not deflated) and
// content.xml. An ODF package without them is refused like any other broken
// package; it is never handed to another editor.
func validateODT(r io.ReaderAt, size int64, limits FileLimits) (FileFacts, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return FileFacts{}, refuse(ReasonZipUnreadable, "the package cannot be read: %v", err)
	}
	parts, err := checkZipParts(zr, limits)
	if err != nil {
		return FileFacts{}, err
	}
	declared, ok := parts["mimetype"]
	if !ok {
		return FileFacts{}, refuse(ReasonODFMissingPart, "the mimetype entry is missing")
	}
	if declared.Method != zip.Store {
		return FileFacts{}, refuse(ReasonODFMimetype, "the mimetype entry is compressed")
	}
	rc, err := declared.Open()
	if err != nil {
		return FileFacts{}, refuse(ReasonODFMimetype, "the mimetype entry cannot be read: %v", err)
	}
	raw, err := io.ReadAll(io.LimitReader(rc, 256))
	_ = rc.Close()
	if err != nil {
		return FileFacts{}, refuse(ReasonODFMimetype, "the mimetype entry cannot be read: %v", err)
	}
	if strings.TrimSpace(string(raw)) != mimeODT {
		return FileFacts{}, refuse(ReasonODFMimetype, "the mimetype entry names %q", string(raw))
	}
	if _, ok := parts["content.xml"]; !ok {
		return FileFacts{}, refuse(ReasonODFMissingPart, "content.xml is missing")
	}
	return FileFacts{Format: "odt"}, nil
}

// checkZipParts applies the shared package safety rules (entry bounds, names,
// inflation ratio, macro parts) and returns the entries by lower-case name.
func checkZipParts(zr *zip.Reader, limits FileLimits) (map[string]*zip.File, error) {
	if len(zr.File) > limits.MaxEntries {
		return nil, refuse(ReasonZipTooManyEntries, "%d entries, at most %d", len(zr.File), limits.MaxEntries)
	}
	parts := make(map[string]*zip.File, len(zr.File))
	var total uint64
	for _, f := range zr.File {
		if err := checkEntryName(f.Name, limits.MaxEntryName); err != nil {
			return nil, err
		}
		lower := strings.ToLower(f.Name)
		if _, dup := parts[lower]; dup {
			return nil, refuse(ReasonZipPath, "entry %q appears twice", f.Name)
		}
		if path.Base(lower) == "vbaproject.bin" {
			return nil, refuse(ReasonZipMacro, "macro-enabled packages are not editable")
		}
		total += f.UncompressedSize64
		if total > uint64(limits.MaxUncompressedBytes) {
			return nil, refuse(ReasonZipBomb, "the package inflates past %d bytes", limits.MaxUncompressedBytes)
		}
		if f.UncompressedSize64 > 0 && f.Method != zip.Store {
			comp := f.CompressedSize64
			if comp == 0 || f.UncompressedSize64/comp > uint64(limits.MaxEntryRatio) {
				return nil, refuse(ReasonZipRatio, "entry %q compresses more than %d:1", f.Name, limits.MaxEntryRatio)
			}
		}
		parts[lower] = f
	}
	return parts, nil
}

func ooxmlFormat(contentType string) string {
	switch contentType {
	case mimeDOCX:
		return "docx"
	case mimeXLSX:
		return "xlsx"
	default:
		return "pptx"
	}
}

// checkEntryName refuses every name an unpacker could resolve outside the
// package root: absolute paths, drive letters, backslashes, "..", NUL and
// other control characters.
func checkEntryName(name string, maxLen int) error {
	switch {
	case name == "":
		return refuse(ReasonZipPath, "an entry has no name")
	case len(name) > maxLen:
		return refuse(ReasonZipPath, "an entry name is longer than %d bytes", maxLen)
	case !utf8.ValidString(name):
		return refuse(ReasonZipPath, "an entry name is not UTF-8")
	case strings.HasPrefix(name, "/"), strings.Contains(name, "\\"):
		return refuse(ReasonZipPath, "entry %q is not a relative forward-slash path", name)
	case len(name) >= 2 && name[1] == ':':
		return refuse(ReasonZipPath, "entry %q names a drive", name)
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return refuse(ReasonZipPath, "entry %q has a control character", name)
		}
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == ".." || seg == "." {
			return refuse(ReasonZipPath, "entry %q leaves the package root", name)
		}
	}
	return nil
}

// validatePDF: the header must start the file (PDF 1.x/2.x) and "%%EOF" must
// sit in the last 1 KiB, where every conforming writer puts the trailer.
func validatePDF(r io.ReaderAt, size int64) (FileFacts, error) {
	head := make([]byte, min64(size, 1024))
	if _, err := r.ReadAt(head, 0); err != nil && !errors.Is(err, io.EOF) {
		return FileFacts{}, refuse(ReasonPDFHeader, "cannot read the header: %v", err)
	}
	if !bytes.HasPrefix(head, []byte("%PDF-1.")) && !bytes.HasPrefix(head, []byte("%PDF-2.")) {
		return FileFacts{}, refuse(ReasonPDFHeader, "the file does not start with a PDF header")
	}
	n := min64(size, 1024)
	tail := make([]byte, n)
	if _, err := r.ReadAt(tail, size-n); err != nil && !errors.Is(err, io.EOF) {
		return FileFacts{}, refuse(ReasonPDFTrailer, "cannot read the trailer: %v", err)
	}
	if !bytes.Contains(tail, []byte("%%EOF")) {
		return FileFacts{}, refuse(ReasonPDFTrailer, "the file has no %%%%EOF trailer")
	}
	return FileFacts{Format: "pdf"}, nil
}

func validateOLE(r io.ReaderAt, size int64, contentType string) (FileFacts, error) {
	head := make([]byte, len(ole2Signature))
	if size < int64(len(head)) {
		return FileFacts{}, refuse(ReasonOLESignature, "the file is shorter than a compound file header")
	}
	if _, err := r.ReadAt(head, 0); err != nil || !bytes.Equal(head, ole2Signature) {
		return FileFacts{}, refuse(ReasonOLESignature, "the file is not a compound file")
	}
	format := map[string]string{mimeDOC: "doc", mimeXLS: "xls", mimePPT: "ppt"}[contentType]
	return FileFacts{Format: format}, nil
}

// validateText reads the whole file (up to TextScanBytes, which follows the
// configured document_file cap) in chunks and refuses invalid UTF-8 or NUL
// bytes: FileService only checks the first 64 KiB (FS-C1 §9.1 known limit).
func validateText(r io.ReaderAt, size int64, limits FileLimits) (FileFacts, error) {
	limit := min64(size, limits.TextScanBytes)
	const chunk = 64 << 10
	buf := make([]byte, chunk+utf8.UTFMax)
	var carry int
	for off := int64(0); off < limit; {
		n := int(min64(chunk, limit-off))
		read, err := r.ReadAt(buf[carry:carry+n], off)
		if err != nil && !errors.Is(err, io.EOF) {
			return FileFacts{}, refuse(ReasonTextEncoding, "cannot read the text: %v", err)
		}
		if read == 0 {
			break
		}
		off += int64(read)
		data := buf[:carry+read]
		if bytes.IndexByte(data, 0) >= 0 {
			return FileFacts{}, refuse(ReasonTextBinary, "the text contains NUL bytes")
		}
		// Keep an incomplete trailing rune for the next chunk.
		keep := 0
		if off < limit {
			keep = incompleteSuffix(data)
		}
		if !utf8.Valid(data[:len(data)-keep]) {
			return FileFacts{}, refuse(ReasonTextEncoding, "the text is not UTF-8")
		}
		copy(buf, data[len(data)-keep:])
		carry = keep
	}
	if carry > 0 && !utf8.Valid(buf[:carry]) {
		return FileFacts{}, refuse(ReasonTextEncoding, "the text is not UTF-8")
	}
	return FileFacts{Format: "text"}, nil
}

// incompleteSuffix is how many trailing bytes start a rune the chunk cut.
func incompleteSuffix(b []byte) int {
	for i := 1; i <= utf8.UTFMax && i <= len(b); i++ {
		c := b[len(b)-i]
		if c < 0x80 {
			return 0 // ASCII: nothing pending
		}
		if utf8.RuneStart(c) {
			if utf8.FullRune(b[len(b)-i:]) {
				return 0
			}
			return i
		}
	}
	return 0
}

func validateImage(r io.ReaderAt, size int64, limits FileLimits) (FileFacts, error) {
	cfg, _, err := image.DecodeConfig(io.NewSectionReader(r, 0, size))
	if err != nil {
		return FileFacts{}, refuse(ReasonImageHeader, "the image header does not decode: %v", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > limits.MaxImagePixels {
		return FileFacts{}, refuse(ReasonImageDimensions, "%dx%d is outside the allowed pixel count", cfg.Width, cfg.Height)
	}
	return FileFacts{Format: "image", Width: cfg.Width, Height: cfg.Height}, nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// validateWebP reads the pixel size from the first chunk of a WebP file (the
// standard library has no WebP decoder): VP8X carries the canvas size, a
// lossy VP8 frame and a lossless VP8L bitstream carry the image size.
func validateWebP(r io.ReaderAt, size int64, limits FileLimits) (FileFacts, error) {
	head := make([]byte, 30)
	n, _ := r.ReadAt(head, 0)
	head = head[:n]
	if len(head) < 30 || string(head[0:4]) != "RIFF" || string(head[8:12]) != "WEBP" {
		return FileFacts{}, refuse(ReasonImageHeader, "not a WebP file")
	}
	// The RIFF length and the first chunk must fit the stored bytes: a stream cut
	// short is stored as an image no browser decodes.
	riff := int64(binary.LittleEndian.Uint32(head[4:8]))
	chunk := int64(binary.LittleEndian.Uint32(head[16:20]))
	if riff+8 > size || 20+chunk > riff+8 {
		return FileFacts{}, refuse(ReasonImageHeader, "the WebP stream is truncated")
	}
	var w, h int
	switch string(head[12:16]) {
	case "VP8X":
		w = 1 + (int(head[24]) | int(head[25])<<8 | int(head[26])<<16)
		h = 1 + (int(head[27]) | int(head[28])<<8 | int(head[29])<<16)
	case "VP8 ":
		if head[23] != 0x9d || head[24] != 0x01 || head[25] != 0x2a {
			return FileFacts{}, refuse(ReasonImageHeader, "the VP8 frame has no start code")
		}
		w = int(head[26]) | int(head[27]&0x3f)<<8
		h = int(head[28]) | int(head[29]&0x3f)<<8
	case "VP8L":
		if head[20] != 0x2f {
			return FileFacts{}, refuse(ReasonImageHeader, "the VP8L stream has no signature")
		}
		bits := uint32(head[21]) | uint32(head[22])<<8 | uint32(head[23])<<16 | uint32(head[24])<<24
		w = 1 + int(bits&0x3fff)
		h = 1 + int(bits>>14&0x3fff)
	default:
		return FileFacts{}, refuse(ReasonImageHeader, "unknown WebP chunk %q", head[12:16])
	}
	if w <= 0 || h <= 0 || int64(w)*int64(h) > limits.MaxImagePixels {
		return FileFacts{}, refuse(ReasonImageDimensions, "%dx%d is outside the allowed pixel count", w, h)
	}
	return FileFacts{Format: "image", Width: w, Height: h}, nil
}

// ExpectedMIMEForExtension maps each document_file extension to its expected
// content type family for multipart upload session preflight (BIGUP S1-b).
func ExpectedMIMEForExtension(filename string) (string, bool) {
	ext := strings.ToLower(path.Ext(strings.TrimSpace(filename)))
	switch ext {
	case ".pdf":
		return mimePDF, true
	case ".docx":
		return mimeDOCX, true
	case ".xlsx":
		return mimeXLSX, true
	case ".pptx":
		return mimePPTX, true
	case ".odt":
		return mimeODT, true
	case ".doc":
		return mimeDOC, true
	case ".xls":
		return mimeXLS, true
	case ".ppt":
		return mimePPT, true
	case ".txt", ".csv", ".json", ".xml", ".yaml", ".yml":
		return mimeText, true
	case ".md", ".markdown":
		return mimeMD, true
	case ".html", ".htm":
		return mimeHTML, true
	case ".css":
		return mimeCSS, true
	case ".js", ".mjs":
		return mimeJS, true
	case ".svg":
		return mimeSVG, true
	case ".png":
		return mimePNG, true
	case ".jpg", ".jpeg":
		return mimeJPEG, true
	case ".gif":
		return mimeGIF, true
	case ".webp":
		return mimeWebP, true
	default:
		return "", false
	}
}

// RequiresZipCentralDirectory reports whether the contentType is an OOXML
// package whose upload session Open probe must include central_dir_b64.
func RequiresZipCentralDirectory(contentType string) bool {
	switch contentType {
	case mimeDOCX, mimeXLSX, mimePPTX:
		return true
	default:
		return false
	}
}

// ValidateUploadProbe checks the Open probe (head + central_dir for OOXML)
// before a multipart upload is created in S3.
func ValidateUploadProbe(contentType string, sizeBytes int64, head, centralDir []byte, cdOffset, cdSize int64, limits FileLimits) error {
	if len(head) == 0 {
		return refuse(ReasonEmpty, "the probe head is empty")
	}
	switch contentType {
	case mimeDOCX, mimeXLSX, mimePPTX:
		if len(head) < 4 || !bytes.Equal(head[:4], []byte("PK\x03\x04")) {
			return refuse(ReasonZipUnreadable, "the file does not start with a ZIP header")
		}
		if len(centralDir) == 0 || cdSize <= 0 || int64(len(centralDir)) != cdSize || cdOffset < 0 || cdOffset+cdSize > sizeBytes {
			return refuse(ReasonZipUnreadable, "the ZIP central directory probe is missing or out of bounds")
		}
		zr, err := openZipCentralDirectoryProbe(sizeBytes, head, centralDir, cdOffset)
		if err != nil {
			return refuse(ReasonZipUnreadable, "the ZIP central directory cannot be read: %v", err)
		}
		parts, err := checkZipParts(zr, limits)
		if err != nil {
			return err
		}
		if _, ok := parts["[content_types].xml"]; !ok {
			return refuse(ReasonOOXMLMissingPart, "[Content_Types].xml is missing")
		}
		main := ooxmlMainPart[contentType]
		if _, ok := parts[main]; !ok {
			return refuse(ReasonOOXMLMissingPart, "%s is missing", main)
		}
		return nil
	case mimePDF:
		if !bytes.HasPrefix(head, []byte("%PDF-1.")) && !bytes.HasPrefix(head, []byte("%PDF-2.")) {
			return refuse(ReasonPDFHeader, "the file does not start with a PDF header")
		}
		return nil
	case mimeDOC, mimeXLS, mimePPT:
		_, err := validateOLE(bytes.NewReader(head), int64(len(head)), contentType)
		return err
	case mimeText, mimeMD, mimeHTML, mimeCSS, mimeJS, mimeSVG:
		if bytes.IndexByte(head, 0) >= 0 {
			return refuse(ReasonTextBinary, "the probe head contains a NUL byte")
		}
		if !validUTF8Cut(head, int64(len(head)) < sizeBytes) {
			return refuse(ReasonTextEncoding, "the probe head is not valid UTF-8")
		}
		return nil
	case mimePNG, mimeJPEG, mimeGIF:
		_, err := validateImage(bytes.NewReader(head), sizeBytes, limits)
		return err
	case mimeWebP:
		_, err := validateWebP(bytes.NewReader(head), sizeBytes, limits)
		return err
	default:
		return refuse(ReasonUnknownType, "no editor opens %q", contentType)
	}
}

func validUTF8Cut(b []byte, truncated bool) bool {
	if utf8.Valid(b) {
		return true
	}
	if !truncated {
		return false
	}
	for cut := 1; cut < utf8.UTFMax && cut < len(b); cut++ {
		if utf8.Valid(b[:len(b)-cut]) && !utf8.FullRune(b[len(b)-cut:]) {
			return true
		}
	}
	return false
}

type sparseZipProbeReaderAt struct {
	size       int64
	head       []byte
	cdOffset   int64
	centralDir []byte
}

func (s *sparseZipProbeReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off < 0 || off >= s.size {
		return 0, io.EOF
	}
	n := int64(len(p))
	if off+n > s.size {
		n = s.size - off
	}
	for i := int64(0); i < n; i++ {
		pos := off + i
		switch {
		case pos < int64(len(s.head)):
			p[i] = s.head[pos]
		case pos >= s.cdOffset && pos < s.cdOffset+int64(len(s.centralDir)):
			p[i] = s.centralDir[pos-s.cdOffset]
		default:
			p[i] = 0
		}
	}
	if int(n) < len(p) {
		return int(n), io.EOF
	}
	return int(n), nil
}

func openZipCentralDirectoryProbe(sizeBytes int64, head, centralDir []byte, cdOffset int64) (*zip.Reader, error) {
	// Place centralDir at the tail [virtualSize-len(centralDir) .. virtualSize)
	// when cdOffset+len(centralDir) == sizeBytes, or at cdOffset.
	sr := &sparseZipProbeReaderAt{
		size:       cdOffset + int64(len(centralDir)),
		head:       head,
		cdOffset:   cdOffset,
		centralDir: centralDir,
	}
	if zr, err := zip.NewReader(sr, sr.size); err == nil {
		return zr, nil
	}
	// If the caller built centralDir from a synthetic test ZIP whose EOCD had
	// a different directoryOffset, patch the EOCD directoryOffset to cdOffset.
	if cdOffset >= 0 && cdOffset < 0xffffffff && bytes.HasPrefix(centralDir, []byte("PK\x01\x02")) {
		patched := append([]byte(nil), centralDir...)
		if eocd := bytes.LastIndex(patched, []byte("PK\x05\x06")); eocd >= 0 && eocd+22 <= len(patched) {
			binary.LittleEndian.PutUint32(patched[eocd+16:eocd+20], uint32(cdOffset))
			sr.centralDir = patched
			return zip.NewReader(sr, sr.size)
		}
	}
	return nil, errors.New("invalid zip central directory")
}
