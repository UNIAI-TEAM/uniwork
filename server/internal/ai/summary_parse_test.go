package ai

import (
	"errors"
	"fmt"
	"reflect"
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
	if out.Summary != "Tóm tắt" || !reflect.DeepEqual(out.Decisions, []Decision{{Text: "Chốt A"}}) ||
		!reflect.DeepEqual(out.ActionItems, []ActionItem{{Title: "Gửi báo cáo", Owner: "An", Due: "thứ Sáu"}}) {
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

// TestParseSummaryJSONEvidence (UNI-2002, @5): a decision is an object with
// its evidence, a bare string still reads (pre-@5 answers), and evidence is
// trimmed and capped; which labels exist is the caller's check.
func TestParseSummaryJSONEvidence(t *testing.T) {
	labels := make([]string, 0, maxEvidenceLabels+3)
	for i := 0; i < maxEvidenceLabels+3; i++ {
		labels = append(labels, fmt.Sprintf(`"S%d"`, i))
	}
	out, err := ParseSummaryJSON(`{"summary":"S","decisions":["Chốt A",{"text":" Chốt B ","evidence":[" S1 ","","` + strings.Repeat("S", maxEvidenceRunes+1) + `"]},{"text":"","evidence":["S2"]}],` +
		`"action_items":[{"title":"Gửi","owner":"","due":"","evidence":[` + strings.Join(labels, ",") + `]}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if want := []Decision{{Text: "Chốt A"}, {Text: "Chốt B", Evidence: []string{"S1"}}}; !reflect.DeepEqual(out.Decisions, want) {
		t.Fatalf("decisions = %+v, want %+v", out.Decisions, want)
	}
	if n := len(out.ActionItems[0].Evidence); n != maxEvidenceLabels {
		t.Fatalf("evidence = %d labels, want %d", n, maxEvidenceLabels)
	}
	if _, err := ParseSummaryJSON(`{"summary":"S","decisions":[7]}`); !errors.Is(err, ErrOutputInvalid) {
		t.Fatalf("a decision that is neither string nor object: %v", err)
	}
}
