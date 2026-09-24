package service

import "testing"

func TestResolveAssignee(t *testing.T) {
	uidA := "user-a"
	uidB := "user-b"
	c := assigneeCandidates{
		byExact: map[string]string{
			normalizePersonName("An Nguyễn"): uidA,
			normalizePersonName("B"):         uidB,
		},
		all: []assigneeCandidate{
			{UserID: uidA, Name: "An Nguyễn"},
			{UserID: uidB, Name: "B"},
		},
	}

	if got := c.resolve("An Nguyễn"); got == nil || *got != uidA {
		t.Fatalf("exact match: %v", got)
	}
	if got := c.resolve("B"); got == nil || *got != uidB {
		t.Fatalf("single-letter exact: %v", got)
	}
	if got := c.resolve("An"); got == nil || *got != uidA {
		t.Fatalf("fuzzy single: %v", got)
	}
	if got := c.resolve(""); got != nil {
		t.Fatal("empty owner should be nil")
	}
	if got := c.resolve("Unknown Person"); got != nil {
		t.Fatalf("no match: %v", got)
	}

	ambiguous := assigneeCandidates{
		byExact: map[string]string{},
		all: []assigneeCandidate{
			{UserID: "1", Name: "An Alpha"},
			{UserID: "2", Name: "An Beta"},
		},
	}
	if got := ambiguous.resolve("An"); got != nil {
		t.Fatalf("ambiguous should stay nil: %v", got)
	}
}

func TestNormalizePersonName(t *testing.T) {
	if got := normalizePersonName("  Trần  Văn A  "); got != "tran van a" {
		t.Fatalf("got %q", got)
	}
}
