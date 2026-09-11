package service

import "testing"

func TestBuiltInTaskStatusesCanonicalOrder(t *testing.T) {
	got := BuiltInTaskStatuses()
	want := []string{"backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"}
	if len(got) != len(want) {
		t.Fatalf("len = %d", len(got))
	}
	for i := range want {
		if got[i].Key != want[i] || got[i].Category != want[i] || got[i].Position != float64(i*1024) {
			t.Fatalf("status[%d] = %+v", i, got[i])
		}
	}
}

func TestDeriveTaskPrefix(t *testing.T) {
	cases := []struct {
		slug string
		want string
	}{
		{"alpha", "ALP"},
		{"doi-alpha", "DOI"},
		{"ab", "AB"},
		{"a-b", "AB"},
		{"---", "UW"},
		{"", "UW"},
		{"12x", "12X"},
	}
	for _, tc := range cases {
		if got := deriveTaskPrefix(tc.slug); got != tc.want {
			t.Fatalf("deriveTaskPrefix(%q) = %q, want %q", tc.slug, got, tc.want)
		}
	}
}
