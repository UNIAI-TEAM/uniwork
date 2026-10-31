package service

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/office"
)

func TestPDFModelTextCutsAtTheItemCap(t *testing.T) {
	page := strings.Repeat("a", 9000)
	text, truncated := pdfModelText([]string{page, page, page}, false)
	if n := utf8.RuneCountInString(text); n > mcpMaxItemRunes || !strings.HasSuffix(text, mcpItemCut) || !truncated {
		t.Fatalf("runes=%d cut=%v truncated=%v", n, strings.HasSuffix(text, mcpItemCut), truncated)
	}
	if !strings.HasPrefix(text, "[page 1]\n") {
		t.Errorf("start = %.20q", text)
	}
	idx := pdfIndexText([]string{page, page, page})
	if n := utf8.RuneCountInString(idx); n > maxSearchContentRunes || n == 0 || strings.Contains(idx, "[page") {
		t.Errorf("index runes = %d", n)
	}
}

func TestPDFPageTexts(t *testing.T) {
	pages := pdfPageTexts("Một\f\fBa")
	if len(pages) != 3 || pages[1] != "" {
		t.Fatalf("pages = %q", pages)
	}
	text, truncated := pdfModelText(pages, false)
	if text != "[page 1]\nMột\n\n[page 3]\nBa" || truncated {
		t.Errorf("text = %q truncated=%v", text, truncated)
	}
	if got := pdfIndexText(pages); got != "Một\nBa" {
		t.Errorf("index = %q", got)
	}
	if text, _ := pdfModelText(pdfPageTexts("\f\f"), false); text != "" {
		t.Errorf("empty pages gave %q", text)
	}
}

// fakePDFText stands in for the Office engine's PDF text job.
type fakePDFText struct {
	text  string
	err   error
	calls []office.ExtractTextRequest
}

func (f *fakePDFText) ExtractText(_ context.Context, req office.ExtractTextRequest) (office.ExtractTextResult, error) {
	f.calls = append(f.calls, req)
	return office.ExtractTextResult{Text: f.text}, f.err
}

const testPDFBytes = "%PDF-1.7\n% bao cao\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"

func TestGetDocumentReadsAPDF(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.textFile(t, "report.pdf", []byte(testPDFBytes))
	fake := &fakePDFText{text: "Trang một\fTrang hai"}
	x.tools.SetPDFText(fake)
	d := x.getDoc(t, id)
	if d.Format != "extracted" || d.Note != mcpPDFNote || d.Truncated ||
		!strings.Contains(d.Content, "[page 1]\nTrang một") || !strings.Contains(d.Content, "[page 2]\nTrang hai") {
		t.Fatalf("pdf = %+v", d)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("engine calls = %d", len(fake.calls))
	}
	c := fake.calls[0]
	if c.Format != office.ExtractFormatPDF || c.DocumentID != id || c.DriveFileID != "" || c.ActorID != x.p.UserID ||
		(c.ActorKind != "" && c.ActorKind != "human") || len(c.Content) != len(testPDFBytes) ||
		c.OrganizationID != x.w.OrganizationID || c.WorkspaceID != x.w.ID {
		t.Errorf("request = %+v", c)
	}
	var downloads int
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM document_access_logs WHERE document_id = $1 AND action = $2`, id, DocumentAccessDownload).Scan(&downloads); err != nil || downloads != 1 {
		t.Errorf("download rows = %d (%v)", downloads, err)
	}
	if len(x.tools.ask.fileReads) != 0 {
		t.Error("the file read slot was not given back")
	}
}

func TestGetDocumentPDFNotes(t *testing.T) {
	cases := []struct {
		name string
		fake *fakePDFText // nil: no engine wired
		big  bool
		want string
		call bool
	}{
		{"no text layer", &fakePDFText{text: "\f\f"}, false, mcpPDFNoTextNote, true},
		{"password", &fakePDFText{err: &office.ExtractUnreadableError{Reason: "password_required"}}, false, mcpOfficeUnreadableNote, true},
		{"engine busy", &fakePDFText{err: office.ErrExtractUnavailable}, false, mcpFileBusyNote, true},
		{"no engine", nil, false, mcpPDFUnavailableNote, false},
		{"too large", &fakePDFText{text: "x"}, true, mcpOfficeTooLargeNote, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			x := newMcpToolWorld(t)
			id := x.textFile(t, "report.pdf", []byte(testPDFBytes))
			if tc.fake != nil {
				x.tools.SetPDFText(tc.fake)
			}
			if tc.big {
				if _, err := x.tools.ask.pool.Exec(context.Background(), `UPDATE document_versions SET size_bytes = $2 WHERE document_id = $1`, id, int64(mcpOfficeReadBytes)+1); err != nil {
					t.Fatal(err)
				}
			}
			d, err := x.tools.GetDocument(context.Background(), x.p, mcpDocumentRef{WorkspaceID: x.w.ID, DocumentID: id})
			if err != nil {
				t.Fatal(err)
			}
			if d.Note != tc.want || d.Content != "" || d.Format != "" || d.Filename != "report.pdf" {
				t.Errorf("doc = %+v, want note %q", d, tc.want)
			}
			if tc.fake != nil && (len(tc.fake.calls) > 0) != tc.call {
				t.Errorf("engine calls = %d, want called=%v", len(tc.fake.calls), tc.call)
			}
			if len(x.tools.ask.fileReads) != 0 {
				t.Error("the file read slot was not given back")
			}
		})
	}
}
