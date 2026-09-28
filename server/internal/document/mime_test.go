package document

import "testing"

func TestAllowedDocumentFileMIME(t *testing.T) {
	for _, m := range []string{
		"application/pdf", "image/png", "text/markdown",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.oasis.opendocument.text", "application/zip", "text/html",
	} {
		if !AllowedDocumentFileMIME(m) {
			t.Errorf("%s should be allowed", m)
		}
	}
	for _, m := range []string{
		"application/x-msdownload", "application/x-executable",
		"text/javascript", "application/x-sh", "", "application/octet-stream",
	} {
		if AllowedDocumentFileMIME(m) {
			t.Errorf("%s should be refused", m)
		}
	}
	// Parameters do not fool the check.
	if !AllowedDocumentFileMIME("text/plain; charset=utf-8") {
		t.Error("text/plain with charset should be allowed")
	}
}

func TestAllowedDocumentAssetMIME(t *testing.T) {
	for _, m := range []string{"image/png", "image/jpeg", "image/gif", "image/webp"} {
		if !AllowedDocumentAssetMIME(m) {
			t.Errorf("%s should be allowed as asset", m)
		}
	}
	for _, m := range []string{"image/svg+xml", "application/pdf", "text/html"} {
		if AllowedDocumentAssetMIME(m) {
			t.Errorf("%s must not be an asset (SVG is scripted)", m)
		}
	}
}

func TestFilenameMatchesMIME(t *testing.T) {
	cases := []struct {
		name     string
		filename string
		detected string
		want     bool
	}{
		{"pdf ok", "a.pdf", "application/pdf", true},
		{"pdf on doc", "a.docx", "application/pdf", false},
		{"docx sniffs zip", "a.docx", "application/zip", true},
		{"docx sniffs x-zip", "a.docx", "application/x-zip-compressed", true},
		{"txt sniffs text", "a.txt", "text/plain; charset=utf-8", true},
		{"md sniffs text", "a.md", "text/plain; charset=utf-8", true},
		{"html ok", "a.html", "text/html; charset=utf-8", true},
		{"exe on pdf ext", "a.pdf", "application/octet-stream", false},
		{"unknown ext", "a.xyz", "application/pdf", false},
		{"uppercase ext", "A.PDF", "application/pdf", true},
		{"no ext falls back", "noext", "application/pdf", true},
		{"no ext bad mime", "noext", "application/octet-stream", false},
		{"doc ole2 sniff", "a.doc", "application/x-ole-storage", true},
		{"xls ole2 sniff", "a.xls", "application/x-ole-storage", true},
		{"ppt ole2 sniff", "a.ppt", "application/x-ole-storage", true},
		{"doc declared mime", "a.doc", "application/msword", true},
		{"ole2 on pdf ext", "a.pdf", "application/x-ole-storage", false},
		{"ole2 no ext refused", "noext", "application/x-ole-storage", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FilenameMatchesMIME(c.filename, c.detected); got != c.want {
				t.Errorf("FilenameMatchesMIME(%q, %q) = %v, want %v", c.filename, c.detected, got, c.want)
			}
		})
	}
}

// http.DetectContentType returns application/octet-stream for OLE2 files, so
// every legacy Office upload used to die at the pair check. The magic bytes
// must sniff to application/x-ole-storage (BE R1 F-2).
func TestDetectContentTypeOLE2(t *testing.T) {
	head := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 504)...)
	if got := DetectContentType(head); got != "application/x-ole-storage" {
		t.Fatalf("OLE2 sniff = %q, want application/x-ole-storage", got)
	}
	for _, ext := range []string{".doc", ".xls", ".ppt"} {
		if !FilenameMatchesMIME("a"+ext, DetectContentType(head)) {
			t.Errorf("real OLE2 bytes on %s must pass the pair check", ext)
		}
	}
	// Random bytes are not OLE2.
	if got := DetectContentType([]byte("not a compound file at all, plain text")); got != "text/plain; charset=utf-8" {
		t.Fatalf("plain text sniff = %q", got)
	}
}
