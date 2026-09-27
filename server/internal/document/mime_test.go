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
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FilenameMatchesMIME(c.filename, c.detected); got != c.want {
				t.Errorf("FilenameMatchesMIME(%q, %q) = %v, want %v", c.filename, c.detected, got, c.want)
			}
		})
	}
}
