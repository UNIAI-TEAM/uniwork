package service

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestFoldForSearchRemovesVietnameseDiacritics(t *testing.T) {
	cases := map[string]string{
		"Nguyễn Văn Ân":   "nguyen van an",
		"ĐỖ THỊ HÀ":       "do thi ha",
		"Trần  Quốc  Đạt": "tran quoc dat",
		"an@acme.vn":      "an@acme.vn",
		"":                "",
	}
	for in, want := range cases {
		if got := foldForSearch(in); got != want {
			t.Errorf("foldForSearch(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildSearchTextJoinsEveryColumnTheDirectoryOffers(t *testing.T) {
	got := buildSearchText("Nguyễn Văn An", "an@acme.vn", "Trưởng nhóm", "Kỹ thuật")
	want := "nguyen van an an@acme.vn truong nhom ky thuat"
	if got != want {
		t.Fatalf("buildSearchText = %q, want %q", got, want)
	}
}

func TestMatchSnippet(t *testing.T) {
	filler := strings.Repeat("Đoạn mở đầu số một. ", 30) // 600 runes
	deep := filler + "Điều khoản bảo hành 24 tháng áp dụng cho mọi thiết bị. " + filler
	const sql = "sql snippet"

	t.Run("deep match is centred and cut at both ends", func(t *testing.T) {
		got := matchSnippet(deep, "bao hanh", sql)
		if !strings.Contains(got, "bảo hành") || utf8.RuneCountInString(got) > documentSnippetRunes ||
			!strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") {
			t.Fatalf("got %q (%d runes)", got, utf8.RuneCountInString(got))
		}
	})
	t.Run("match at the start has no leading ellipsis", func(t *testing.T) {
		got := matchSnippet("Bảo hành 24 tháng. "+filler, "bao hanh", sql)
		if strings.HasPrefix(got, "…") || !strings.HasPrefix(got, "Bảo hành") || !strings.HasSuffix(got, "…") {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("short text is returned whole", func(t *testing.T) {
		if got := matchSnippet("Bảo hành 24 tháng", "bao hanh", sql); got != "Bảo hành 24 tháng" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("empty query gives the sql snippet", func(t *testing.T) {
		if got := matchSnippet(deep, "", sql); got != sql {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("empty sql snippet stays empty whatever the text holds", func(t *testing.T) {
		if got := matchSnippet(deep, "bao hanh", ""); got != "" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("no match gives the sql snippet", func(t *testing.T) {
		if got := matchSnippet(deep, "khong co dau", sql); got != sql {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("d-bar, emoji and newlines keep the position", func(t *testing.T) {
		text := strings.Repeat("Đường đi 😀\n\n  ", 40) + "Đơn hàng số 7 đã giao 😀 xong." + strings.Repeat(" x", 200)
		got := matchSnippet(text, "don hang so 7", sql)
		if !strings.Contains(got, "Đơn hàng số 7") || !utf8.ValidString(got) || utf8.RuneCountInString(got) > documentSnippetRunes {
			t.Fatalf("got %q", got)
		}
	})
}

// BenchmarkMatchSnippet is a 600k-rune Vietnamese file with its match near the
// start: the cost must follow the indexed window, not the file.
func BenchmarkMatchSnippet(b *testing.B) {
	body := "Điều khoản bảo hành 24 tháng áp dụng. " + strings.Repeat("Đoạn mở đầu số một. ", 30000)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if matchSnippet(body, "bao hanh 24", "sql") == "sql" {
			b.Fatal("no match")
		}
	}
}

func TestMatchSnippetStopsAtTheIndexedWindow(t *testing.T) {
	body := strings.Repeat("a ", maxSearchContentRunes) + "bao hanh"
	if got := matchSnippet(body, "bao hanh", "sql"); got != "sql" {
		t.Fatalf("a match past the indexed window shaped the snippet: %q", got)
	}
}
