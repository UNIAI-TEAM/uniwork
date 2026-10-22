package service

import (
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSplitFollowups(t *testing.T) {
	long := strings.Repeat("ă", 200) + "?"
	for _, tc := range []struct {
		name, answer, body string
		items              []string
	}{
		{"a block of two", "Có 2 việc [S1].\n\n<followups>\n- Việc nào trễ nhất?\n- Ai đang làm?\n</followups>",
			"Có 2 việc [S1].", []string{"Việc nào trễ nhất?", "Ai đang làm?"}},
		{"five become three", "Xong.\n<followups>\n- A?\n- B?\n- C?\n- D?\n- E?\n</followups>", "Xong.", []string{"A?", "B?", "C?"}},
		{"a long question is cut", "Xong.\n<followups>\n- " + long + "\n</followups>", "Xong.", []string{strings.Repeat("ă", 120)}},
		{"markdown, links and tags are dropped", "Xong.\n<followups>\n- **Việc** nào của [Banner Tết](/a/b) <b>trễ</b> nhất? https://x.test/y\n</followups>",
			"Xong.", []string{"Việc nào của Banner Tết trễ nhất?"}},
		{"no block is verbatim", "Xong [S1].\n", "Xong [S1].\n", nil},
		{"a block cut off by a stop", "Xong.\n<followups>\n- Việc nào", "Xong.", nil},
		{"an empty block", "Xong.\n<followups>\n</followups>", "Xong.", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, items := splitFollowups(tc.answer)
			if body != tc.body || !slices.Equal(items, tc.items) || (tc.items == nil && items != nil) {
				t.Fatalf("body %q items %q, want %q %q", body, items, tc.body, tc.items)
			}
			for _, q := range items {
				if utf8.RuneCountInString(q) > followupRunesMax || strings.Contains(q, "\n") {
					t.Fatalf("follow-up %q is not one line of at most %d runes", q, followupRunesMax)
				}
			}
		})
	}
}

// The dock's draft never streams the follow-up block, even when its tag
// arrives split across deltas; a tag that turns out to be another word
// streams once it is told apart.
func TestDraftStopsAtTheFollowupsTag(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  []string
		want string
	}{
		{"tag across deltas", []string{"Xong việc cuối.\n<follo", "wups>\n- A?"}, "Xong việc cuối.\n"},
		{"a near miss streams", []string{"a <follo", "wers b"}, "a <followers b"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var events []AskEvent
			d := &askDraft{emit: collectEvents(&events), cutFollowups: true}
			for _, r := range tc.raw {
				d.add(r)
			}
			if got := joinDeltas(events); got != tc.want || d.sent != tc.want {
				t.Fatalf("streamed %q (sent %q), want %q", got, d.sent, tc.want)
			}
		})
	}
}
