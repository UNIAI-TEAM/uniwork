package service

import (
	"os"
	"regexp"
	"testing"

	"golang.org/x/text/unicode/norm"
)

// UNI-1305 item C, review round 2 (N4): uw_fold_search must fold every
// Vietnamese letter exactly as foldForSearch does. The database-backed
// TestDocumentSourceFoldAgreesWithGo runs sample names through both; this one
// needs no database: it reads the translate table out of the migration and
// checks each pair against foldForSearch, and that no Vietnamese letter is
// missing from it. Scope outside Vietnamese is stated in the migration.
func TestUwFoldSearchTableMatchesGo(t *testing.T) {
	raw, err := os.ReadFile("../../migrations/9991791780000004_uw_fold_search.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)translate\(input,\s*'([^']*)',\s*'([^']*)'\)`).FindSubmatch(raw)
	if m == nil {
		t.Fatal("translate(input, '...', '...') not found in the migration")
	}
	from, to := []rune(string(m[1])), []rune(string(m[2]))
	if len(from) != len(to) {
		t.Fatalf("translate table has %d source letters and %d targets", len(from), len(to))
	}
	inTable := make(map[rune]bool, len(from))
	for i, r := range from {
		inTable[r] = true
		if want := foldForSearch(string(r)); want != string(to[i]) {
			t.Errorf("translate maps %q to %q, foldForSearch gives %q", r, to[i], want)
		}
	}

	// Every Vietnamese letter: the 12 vowels with the 5 tone marks (and none),
	// both cases, composed (NFC) as users type them, plus đ and Đ, and the
	// ASCII capitals (they lower-case through the same table).
	letters := []string{"đ", "Đ"}
	tones := []string{"", "̀", "̉", "̃", "́", "̣"}
	for _, v := range []string{"a", "ă", "â", "e", "ê", "i", "o", "ô", "ơ", "u", "ư", "y", "A", "Ă", "Â", "E", "Ê", "I", "O", "Ô", "Ơ", "U", "Ư", "Y"} {
		for _, tone := range tones {
			letters = append(letters, norm.NFC.String(v+tone))
		}
	}
	for r := 'A'; r <= 'Z'; r++ {
		letters = append(letters, string(r))
	}
	for _, l := range letters {
		rs := []rune(l)
		if len(rs) != 1 {
			t.Fatalf("%q did not compose to one letter", l)
		}
		// A letter foldForSearch leaves alone (a plain lower-case vowel) needs no entry.
		if foldForSearch(l) != l && !inTable[rs[0]] {
			t.Errorf("letter %q (folds to %q) is missing from the uw_fold_search table", l, foldForSearch(l))
		}
	}
}
