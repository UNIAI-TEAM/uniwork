package service

import (
	"testing"
	"time"
)

func TestParseMeetingDueSpoken(t *testing.T) {
	anchor := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC) // Thursday

	cases := []struct {
		in   string
		want string
	}{
		{"2026-09-10", "2026-09-10"},
		{"10/09/2026", "2026-09-10"},
		{"ngày mai", "2026-09-04"},
		{"tomorrow", "2026-09-04"},
		{"thứ Sáu", "2026-09-04"},
		{"Friday", "2026-09-04"},
		{"tuần sau", "2026-09-10"},
	}
	for _, tc := range cases {
		got := parseMeetingDueSpoken(tc.in, anchor)
		if got == nil || *got != tc.want {
			t.Fatalf("%q: got %v want %s", tc.in, got, tc.want)
		}
	}
	if got := parseMeetingDueSpoken("sometime soon", anchor); got != nil {
		t.Fatalf("unparseable should be nil: %v", got)
	}
}
