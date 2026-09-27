package migrations

import (
	"reflect"
	"testing"
)

// The numbering passed 999 with the Documents migrations: a string sort
// would run 1010_x before 154_x, i.e. before the table it alters.
func TestVersionsSortNumerically(t *testing.T) {
	got := []string{"1010_b", "154_a", "101_c", "998_d", "1000_e", "100_f", "001_g"}
	sortVersions(got)
	want := []string{"001_g", "100_f", "101_c", "154_a", "998_d", "1000_e", "1010_b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sortVersions = %v, want %v", got, want)
	}
}

func TestEmbeddedVersionsAreInNumericOrder(t *testing.T) {
	vs, err := versions()
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(vs); i++ {
		if versionNumber(vs[i-1]) > versionNumber(vs[i]) {
			t.Fatalf("%s runs before %s", vs[i-1], vs[i])
		}
	}
	if Latest() != vs[len(vs)-1] {
		t.Fatalf("Latest() = %q, want %q", Latest(), vs[len(vs)-1])
	}
}
