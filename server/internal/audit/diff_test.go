package audit

import "testing"

func TestDiffKeepsOnlyChangedFields(t *testing.T) {
	before := map[string]any{"title": "A", "status": "todo", "assignee_id": nil}
	after := map[string]any{"title": "A", "status": "in_progress", "assignee_id": "u1"}

	got := Diff(before, after)

	if _, ok := got["title"]; ok {
		t.Fatalf("unchanged field kept: %+v", got)
	}
	if got["status"].From != "todo" || got["status"].To != "in_progress" {
		t.Fatalf("status change = %+v", got["status"])
	}
	if got["assignee_id"].From != nil || got["assignee_id"].To != "u1" {
		t.Fatalf("assignee change = %+v", got["assignee_id"])
	}
}

func TestDiffTreatsMissingBeforeAsChanged(t *testing.T) {
	got := Diff(map[string]any{}, map[string]any{"priority": "high"})
	if len(got) != 1 || got["priority"].To != "high" {
		t.Fatalf("diff = %+v", got)
	}
}

func TestTextNormalizesNull(t *testing.T) {
	if Text(false, "ignored") != nil {
		t.Fatal("invalid text must normalize to nil")
	}
	if Text(true, "x") != any("x") {
		t.Fatal("valid text must normalize to its string")
	}
}

func TestValidCorrelationID(t *testing.T) {
	for _, ok := range []string{"01J8X4K2M0N1P2Q3R4S5T6U7V8", "abc-DEF_123"} {
		if !ValidCorrelationID(ok) {
			t.Fatalf("%q should be accepted", ok)
		}
	}
	// Too short, and a value carrying characters that would let a client write
	// its own fields into a structured log line.
	for _, bad := range []string{"", "short", "has space", "quote\"inject", "newline\nhere"} {
		if ValidCorrelationID(bad) {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}
