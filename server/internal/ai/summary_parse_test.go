package ai

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

// TestParseSummaryJSONValidates (L1): garbage and empty answers are
// ErrOutputInvalid, strings are trimmed, blank entries dropped, counts and
// lengths capped.
func TestParseSummaryJSONValidates(t *testing.T) {
	for _, in := range []string{
		"no json here",
		"{not json}",
		`{}`,
		`{"summary":"   ","decisions":["  ",""],"action_items":[{"title":"  ","owner":"An","due":"mai"}]}`,
	} {
		if _, err := ParseSummaryJSON(in); !errors.Is(err, ErrOutputInvalid) {
			t.Errorf("ParseSummaryJSON(%q) = %v, want ErrOutputInvalid", in, err)
		}
	}
	out, err := ParseSummaryJSON(`{"summary":"  Tóm tắt  ","decisions":[" Chốt A ",""],"action_items":[{"title":"  Gửi báo cáo ","owner":" An ","due":" thứ Sáu "},{"title":"","owner":"Bình"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if out.Summary != "Tóm tắt" || len(out.Decisions) != 1 || out.Decisions[0] != "Chốt A" ||
		len(out.ActionItems) != 1 || out.ActionItems[0] != (ActionItem{Title: "Gửi báo cáo", Owner: "An", Due: "thứ Sáu"}) {
		t.Fatalf("not trimmed or not dropped: %+v", out)
	}
	// Decisions alone are a record worth keeping.
	if _, err := ParseSummaryJSON(`{"summary":"","decisions":["Chốt A"],"action_items":[]}`); err != nil {
		t.Fatalf("decisions only: %v", err)
	}
	var items []string
	for i := 0; i < maxSummaryItems+5; i++ {
		items = append(items, fmt.Sprintf(`{"title":"Việc %d","owner":"","due":""}`, i))
	}
	long := strings.Repeat("dài ", maxItemTitleRunes)
	capped, err := ParseSummaryJSON(`{"summary":"S","decisions":[],"action_items":[{"title":"` + long + `","owner":"","due":""},` + strings.Join(items, ",") + `]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(capped.ActionItems) != maxSummaryItems {
		t.Fatalf("items = %d, want %d", len(capped.ActionItems), maxSummaryItems)
	}
	if n := len([]rune(capped.ActionItems[0].Title)); n > maxItemTitleRunes || !strings.HasSuffix(capped.ActionItems[0].Title, "…") {
		t.Fatalf("title not capped: %d runes", n)
	}
}
