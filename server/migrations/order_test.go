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

// /readyz refuses only a schema older than the binary: a rollout migrates
// first, so old pods still serving see a newer schema and must stay ready.
func TestBehindComparesNumerically(t *testing.T) {
	cases := []struct {
		applied, latest string
		want            bool
	}{
		{"154_a", "1010_b", true},
		{"1010_b", "1010_b", false},
		{"1010_b", "154_a", false},
		{"9991700000000000_x", "1010_b", false},
		{"", "001_a", true},
	}
	for _, c := range cases {
		if got := behind(c.applied, c.latest); got != c.want {
			t.Errorf("behind(%q, %q) = %v, want %v", c.applied, c.latest, got, c.want)
		}
	}
}
