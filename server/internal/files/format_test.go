package files

import "testing"

// UNI-1868: one table maps the documents library's six formats to the MIME a
// verified upload carries, and answers a row's format from its MIME with the
// title's extension as the fallback. The list SQL takes the same table's MIME
// list, so this test is what pins both readings.
func TestDocumentFormat(t *testing.T) {
	cases := []struct {
		name  string
		mime  string
		title string
		want  string
	}{
		{"docx by mime", mimeDOCX, "hợp đồng.docx", DocumentFormatDocx},
		{"xlsx by mime", mimeXLSX, "bảng.xlsx", DocumentFormatXlsx},
		{"pptx by mime", mimePPTX, "bài.pptx", DocumentFormatPptx},
		{"pdf by mime", "application/pdf", "báo cáo.pdf", DocumentFormatPDF},
		{"markdown by mime", "text/markdown", "ghi chú", DocumentFormatMD},
		{"html by mime", "text/html", "trang", DocumentFormatHTML},
		// The verified MIME wins over a title naming another format.
		{"mime wins", "application/pdf", "báo cáo.docx", DocumentFormatPDF},
		// A MIME the table cannot name leaves the title to answer, upper case
		// included; a generic upload type is the case that happens in practice.
		{"generic mime falls back", "application/octet-stream", "ghi chú.MD", DocumentFormatMD},
		{"no mime falls back", "", "trang.HTML", DocumentFormatHTML},
		// Neither names one of the six.
		{"unknown mime and extension", "application/zip", "kho.zip", ""},
		{"legacy office is not a lane", "application/msword", "cũ.doc", ""},
		{"no extension", "", "không có phần mở rộng", ""},
		{"a dot that opens the title names nothing", "", ".docx", ""},
		{"a trailing dot names nothing", "", "hợp đồng.", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := DocumentFormat(c.mime, c.title); got != c.want {
				t.Fatalf("DocumentFormat(%q, %q) = %q, want %q", c.mime, c.title, got, c.want)
			}
		})
	}
}

func TestDocumentFormatTable(t *testing.T) {
	if got, want := len(DocumentFormats()), 6; got != want {
		t.Fatalf("DocumentFormats() = %d formats, want %d", got, want)
	}
	// DocumentFormats and DocumentFormatMimes are the table's two views and
	// agree with the per-format lookup, which is what the list SQL is handed.
	mimes := DocumentFormatMimes()
	if len(mimes) != len(DocumentFormats()) {
		t.Fatalf("DocumentFormatMimes() = %v, want one MIME per format", mimes)
	}
	for _, format := range DocumentFormats() {
		mime, ok := DocumentFormatMime(format)
		if !ok {
			t.Fatalf("DocumentFormatMime(%q) does not answer", format)
		}
		if DocumentFormat(mime, "") != format {
			t.Fatalf("DocumentFormat(%q, \"\") does not answer %q", mime, format)
		}
		if !containsString(mimes, mime) {
			t.Fatalf("DocumentFormatMimes() is missing %q", mime)
		}
	}
	if _, ok := DocumentFormatMime("page"); ok {
		t.Fatal("DocumentFormatMime(\"page\") answered: a page is not a file format")
	}
	if _, ok := DocumentFormatMime("doc"); ok {
		t.Fatal("DocumentFormatMime(\"doc\") answered: legacy Office is not a library lane")
	}
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
