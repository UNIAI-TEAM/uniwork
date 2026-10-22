package ai

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
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

// TestParseLiveItemsJSON (UNI-2025): an empty array is an answer, a missing
// one or garbage is ErrOutputInvalid, items are cleaned like a summary's.
func TestParseLiveItemsJSON(t *testing.T) {
	for _, in := range []string{"no json", `{}`, `{"action_items":null}`, `{"action_items":"x"}`} {
		if _, err := ParseLiveItemsJSON(in); !errors.Is(err, ErrOutputInvalid) {
			t.Errorf("ParseLiveItemsJSON(%q) = %v, want ErrOutputInvalid", in, err)
		}
	}
	if got, err := ParseLiveItemsJSON(`{"action_items":[]}`); err != nil || len(got) != 0 {
		t.Fatalf("empty: %v %v", got, err)
	}
	got, err := ParseLiveItemsJSON("```json\n" + `{"action_items":[{"title":" Gửi báo giá ","owner":" An ","due":"","evidence":[" S2 "]},{"title":"  ","owner":"","due":"","evidence":[]}]}` + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []ActionItem{{Title: "Gửi báo giá", Owner: "An", Evidence: []string{"S2"}}}) {
		t.Fatalf("not cleaned: %+v", got)
	}
}

// TestActionItemDescriptionAndPriority (meeting_summary@6, meeting_live_items@2):
// both parsers trim the prose description and cap it at maxItemDescriptionRunes,
// and keep a priority only when it is one of low|medium|high|urgent (any case);
// anything else, a guess the model dressed up included, becomes "".
func TestActionItemDescriptionAndPriority(t *testing.T) {
	long := strings.Repeat("ạ", maxItemDescriptionRunes+50)
	items := `[{"title":"A","description":"  Gửi báo giá cho khách để chốt hợp đồng.  ","priority":" High "},` +
		`{"title":"B","description":"` + long + `","priority":"critical"},` +
		`{"title":"C","priority":"urgent"},{"title":"D","priority":""}]`
	want := []ActionItem{
		{Title: "A", Description: "Gửi báo giá cho khách để chốt hợp đồng.", Priority: "high"},
		{Title: "B", Description: capRunes(long, maxItemDescriptionRunes)},
		{Title: "C", Priority: "urgent"},
		{Title: "D"},
	}
	sum, err := ParseSummaryJSON(`{"summary":"x","decisions":[],"action_items":` + items + `}`)
	if err != nil {
		t.Fatal(err)
	}
	live, err := ParseLiveItemsJSON(`{"action_items":` + items + `}`)
	if err != nil {
		t.Fatal(err)
	}
	for name, got := range map[string][]ActionItem{"summary": sum.ActionItems, "live": live} {
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: %+v, want %+v", name, got, want)
		}
	}
	if n := utf8.RuneCountInString(want[1].Description); n != maxItemDescriptionRunes {
		t.Fatalf("capped description has %d runes", n)
	}
}

// TestParseCaptionTranslateJSON (UNI-2028): a missing list or garbage is
// ErrOutputInvalid; entries without an id or a text are dropped.
func TestParseCaptionTranslateJSON(t *testing.T) {
	for _, in := range []string{"no json", `{}`, `{"translations":null}`, `{"translations":"x"}`} {
		if _, err := ParseCaptionTranslateJSON(in); !errors.Is(err, ErrOutputInvalid) {
			t.Errorf("ParseCaptionTranslateJSON(%q) = %v, want ErrOutputInvalid", in, err)
		}
	}
	got, err := ParseCaptionTranslateJSON("```json\n" + `{"translations":[{"id":" T1 ","text":" Send the quote "},{"id":"T2","text":"  "},{"id":"","text":"x"}]}` + "\n```")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []CaptionTranslation{{ID: "T1", Text: "Send the quote"}}) {
		t.Fatalf("not cleaned: %+v", got)
	}
}
