package service

import "testing"

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
