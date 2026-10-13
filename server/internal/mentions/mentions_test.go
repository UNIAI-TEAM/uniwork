package mentions

import (
	"strings"
	"testing"
)

func TestTokenIDs(t *testing.T) {
	idA := "01J8X4USR" + strings.Repeat("0", 17)
	idB := "01J8X4USR" + strings.Repeat("1", 17)
	sort := func(ids ...string) []string { return ids }
	for _, tc := range []struct {
		name string
		body string
		want []string
	}{
		{"full token", "[@An](mention://member/" + idA + ") xem giúp", []string{idA}},
		{"two tokens sorted", "[@B](mention://member/" + idB + ") [@A](mention://member/" + idA + ")", sort(idA, idB)},
		{"lowered id normalizes", "[@A](mention://member/" + strings.ToLower(idA) + ")", []string{idA}},
		{"duplicate collapses", "[@A](mention://member/" + idA + ") [@A](mention://member/" + idA + ")", []string{idA}},
		{"escaped label", `[@A\]b](mention://member/` + idA + ")", []string{idA}},
		{"bare url is not a token", "mention://member/" + idA, nil},
		{"link without label is not a token", "(mention://member/" + idA + ")", nil},
		{"token in inline code is not a mention", "`[@A](mention://member/" + idA + ")`", nil},
		{"text after a code span is parsed again", "`code` [@A](mention://member/" + idA + ")", []string{idA}},
		{"id must be a 26-char ULID", "[@A](mention://member/" + idA[:25] + ")", nil},
		{"empty body", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := TokenIDs(tc.body)
			if len(got) != len(tc.want) {
				t.Fatalf("TokenIDs = %v, want %v", got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Fatalf("TokenIDs = %v, want %v", got, tc.want)
				}
			}
		})
	}
}
