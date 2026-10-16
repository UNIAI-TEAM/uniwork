package imapclient

import "testing"

func TestImapLabelsIncludeStarred(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		labels []string
		want   bool
	}{
		{"nil", nil, false},
		{"empty", []string{}, false},
		{"backslash starred", []string{`\Starred`}, true},
		{"plain starred", []string{"Starred"}, true},
		{"lower", []string{"starred"}, true},
		{"other labels", []string{`\Important`, "Work"}, false},
		{"mixed", []string{`\Inbox`, `\Starred`, "Project"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := imapLabelsIncludeStarred(tc.labels); got != tc.want {
				t.Fatalf("imapLabelsIncludeStarred(%v) = %v, want %v", tc.labels, got, tc.want)
			}
		})
	}
}
