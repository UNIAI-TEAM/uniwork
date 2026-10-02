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

// A smallint column read as int16 used to fall through equalValue's type list
// and log "quorum_percent 60 → 60" on every edit.
func TestDiffComparesEveryIntegerKind(t *testing.T) {
	before := map[string]any{"a": int16(60), "b": int8(3), "c": uint32(7), "d": int(5), "e": int16(-1)}
	after := map[string]any{"a": int16(60), "b": int8(3), "c": uint32(7), "d": int64(5), "e": int16(-1)}
	if got := Diff(before, after); len(got) != 0 {
		t.Fatalf("equal integers reported as changed: %+v", got)
	}

	got := Diff(map[string]any{"q": int16(60)}, map[string]any{"q": int16(70)})
	if got["q"].From != int16(60) || got["q"].To != int16(70) {
		t.Fatalf("changed int16 = %+v", got)
	}
	// A negative signed value never equals the uint64 that shares its bits.
	if equalValue(int64(-1), ^uint64(0)) {
		t.Fatal("int64(-1) must not equal MaxUint64")
	}
	if equalValue(int16(60), "60") || equalValue(int16(60), float64(60)) {
		t.Fatal("an integer only equals another integer")
	}
}
