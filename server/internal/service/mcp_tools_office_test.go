package service

import (
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
)

func TestMcpOfficeMIME(t *testing.T) {
	for _, c := range []struct {
		mime, name, want string
		ok               bool
	}{
		{"", "BAO-GIA.DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", true},
		{"application/zip", "so-lieu.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true},
		{"", "gioi-thieu.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", true},
		{"application/vnd.oasis.opendocument.text", "bien-ban", "application/vnd.oasis.opendocument.text", true},
		{"text/csv; charset=utf-8", "don-hang", "text/csv", true},
		{"application/pdf", "tai-lieu.pdf", "", false},
		{"text/markdown", "ghi-chu.md", "", false}, // text files keep their own path
		{"image/png", "logo.png", "", false},
	} {
		if got, ok := mcpOfficeMIME(c.mime, c.name); got != c.want || ok != c.ok {
			t.Errorf("mcpOfficeMIME(%q, %q) = %q, %v; want %q, %v", c.mime, c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestMcpOfficeReadable(t *testing.T) {
	for size, want := range map[int64]bool{0: false, 1: true, mcpOfficeReadBytes: true, mcpOfficeReadBytes + 1: false} {
		if got := mcpOfficeReadable(size); got != want {
			t.Errorf("mcpOfficeReadable(%d) = %v", size, got)
		}
	}
}

func TestMcpOfficeText(t *testing.T) {
	short := attachtext.Doc{Unit: "paragraph", Parts: []attachtext.Part{{Text: "Báo giá tháng 10"}, {Text: "Hàng | Giá"}}}
	if text, cut := mcpOfficeText(short); text != "Báo giá tháng 10\nHàng | Giá" || cut {
		t.Errorf("short = %q, %v", text, cut)
	}
	if text, cut := mcpOfficeText(attachtext.Doc{}); text != "" || cut {
		t.Errorf("empty = %q, %v", text, cut)
	}
	// Two long sheets: each keeps its own first rows, the whole stays under the cap.
	var long attachtext.Doc
	for _, sheet := range []string{"Doanh thu Q1", "Doanh thu Q2"} {
		long.Parts = append(long.Parts, attachtext.Part{Label: sheet})
		for i := 0; i < 2000; i++ {
			long.Parts = append(long.Parts, attachtext.Part{Text: fmt.Sprintf("Q-%04d | Máy lọc nước | 12 | 3.500.000", i)})
		}
	}
	text, cut := mcpOfficeText(long)
	if !cut || utf8.RuneCountInString(text) > mcpMaxItemRunes || !strings.HasSuffix(text, mcpItemCut) ||
		!strings.Contains(text, "## Doanh thu Q1") || !strings.Contains(text, "## Doanh thu Q2") {
		t.Errorf("long: cut=%v runes=%d", cut, utf8.RuneCountInString(text))
	}
}

// One part longer than the whole budget still shows its start.
func TestMcpOfficeTextShowsTheStartOfAnOversizedPart(t *testing.T) {
	d := attachtext.Doc{Parts: []attachtext.Part{{Text: strings.Repeat("a", 20000)}}}
	text, cut := mcpOfficeText(d)
	if !cut || !strings.HasPrefix(text, "aaa") || utf8.RuneCountInString(text) > mcpMaxItemRunes || !strings.HasSuffix(text, mcpItemCut) {
		t.Errorf("oversized part: cut=%v runes=%d", cut, utf8.RuneCountInString(text))
	}
}
