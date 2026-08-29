package ai

import "testing"

func TestParseSummaryJSONTolerant(t *testing.T) {
	in := "Here you go:\n```json\n{\"summary\":\"S\",\"decisions\":[\"D1\"],\"action_items\":[{\"title\":\"T\",\"owner\":\"An\"}]}\n```"
	out, err := ParseSummaryJSON(in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Summary != "S" || len(out.Decisions) != 1 || len(out.ActionItems) != 1 || out.ActionItems[0].Owner != "An" {
		t.Fatalf("%+v", out)
	}
	if _, err := ParseSummaryJSON("no json here"); err == nil {
		t.Fatal("expected error")
	}
	empty, err := ParseSummaryJSON(`{"summary":"x"}`)
	if err != nil || empty.Decisions == nil || empty.ActionItems == nil {
		t.Fatalf("nil slices must become empty: %+v %v", empty, err)
	}
}
