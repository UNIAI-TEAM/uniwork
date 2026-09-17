package tablequery

import (
	"errors"
	"strings"
	"testing"
)

func TestCursorRoundTripAndTamper(t *testing.T) {
	v := "2026-09-01"
	c := Cursor{V: 1, FP: "abc", SortValue: &v, CreatedAt: "2026-09-16T01:02:03.123456Z", ID: "01T"}
	s := EncodeCursor(c)
	if strings.ContainsAny(s, "+/=") {
		t.Fatalf("cursor %q is not base64url without padding", s)
	}
	back, err := DecodeCursor(s)
	if err != nil || back.FP != "abc" || *back.SortValue != v || back.ID != "01T" {
		t.Fatalf("round trip = %+v, %v", back, err)
	}
	for _, bad := range []string{"", "%%%", EncodeCursor(Cursor{V: 2, ID: "x", CreatedAt: c.CreatedAt}), EncodeCursor(Cursor{V: 1})} {
		if _, err := DecodeCursor(bad); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("DecodeCursor(%q) err = %v, want ErrInvalidCursor", bad, err)
		}
	}
}

func TestFingerprintIgnoresFilterOrderAndDuplicates(t *testing.T) {
	a := Query{WorkspaceID: "w", Filter: Filter{Statuses: []string{"todo", "done"}}, Search: "x"}.Normalize()
	b := Query{WorkspaceID: "w", Filter: Filter{Statuses: []string{"done", "todo", "todo"}}, Search: "x"}.Normalize()
	if Fingerprint(a) != Fingerprint(b) {
		t.Fatal("equal queries must share a fingerprint")
	}
	c := b
	c.Sort = Sort{Field: "title"}
	if Fingerprint(c) == Fingerprint(b) {
		t.Fatal("sort must change the fingerprint")
	}
}

func TestFingerprintChangesWithPropertyTypeAndOptionOrder(t *testing.T) {
	sortA := Query{WorkspaceID: "w", Sort: Sort{Field: "property", Property: &PropertyRef{
		ID: "p1", Type: "select", Options: []string{"todo", "doing", "done"},
	}}}.Normalize()
	sortReordered := Query{WorkspaceID: "w", Sort: Sort{Field: "property", Property: &PropertyRef{
		ID: "p1", Type: "select", Options: []string{"doing", "todo", "done"},
	}}}.Normalize()
	if Fingerprint(sortA) == Fingerprint(sortReordered) {
		t.Fatal("reordering a sort property's select options must change the fingerprint")
	}
	sortRetyped := Query{WorkspaceID: "w", Sort: Sort{Field: "property", Property: &PropertyRef{
		ID: "p1", Type: "text", Options: []string{"todo", "doing", "done"},
	}}}.Normalize()
	if Fingerprint(sortA) == Fingerprint(sortRetyped) {
		t.Fatal("changing a sort property's type must change the fingerprint")
	}

	groupA := Query{WorkspaceID: "w", Group: Group{Kind: GroupKindProperty, Property: &PropertyRef{
		ID: "p1", Type: "select", Options: []string{"todo", "doing", "done"},
	}}}.Normalize()
	groupReordered := Query{WorkspaceID: "w", Group: Group{Kind: GroupKindProperty, Property: &PropertyRef{
		ID: "p1", Type: "select", Options: []string{"doing", "todo", "done"},
	}}}.Normalize()
	if Fingerprint(groupA) == Fingerprint(groupReordered) {
		t.Fatal("reordering a group property's select options must change the fingerprint")
	}
	groupRetyped := Query{WorkspaceID: "w", Group: Group{Kind: GroupKindProperty, Property: &PropertyRef{
		ID: "p1", Type: "checkbox", Options: []string{"todo", "doing", "done"},
	}}}.Normalize()
	if Fingerprint(groupA) == Fingerprint(groupRetyped) {
		t.Fatal("changing a group property's type must change the fingerprint")
	}
}
