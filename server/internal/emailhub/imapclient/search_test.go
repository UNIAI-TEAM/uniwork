package imapclient

import (
	"testing"

	"github.com/emersion/go-imap"
)

func TestBuildSearchCriteria(t *testing.T) {
	t.Parallel()
	crit := buildSearchCriteria("  invoice  ", SearchOptions{})
	if len(crit.Text) != 1 || crit.Text[0] != "invoice" {
		t.Fatalf("unexpected text criteria: %#v", crit.Text)
	}
	if len(crit.WithFlags) != 0 {
		t.Fatalf("expected no flag filter, got %#v", crit.WithFlags)
	}

	starred := buildSearchCriteria("payroll", SearchOptions{StarredOnly: true})
	if len(starred.WithFlags) != 1 || starred.WithFlags[0] != imap.FlaggedFlag {
		t.Fatalf("expected flagged filter, got %#v", starred.WithFlags)
	}
}

func TestCapSearchUIDs(t *testing.T) {
	t.Parallel()
	in := []uint32{10, 5, 99, 42}
	got := capSearchUIDs(in)
	if len(got) != len(in) {
		t.Fatalf("expected all uids under cap, got %d", len(got))
	}

	burst := make([]uint32, maxSearchResults+15)
	for i := range burst {
		burst[i] = uint32(i + 1)
	}
	got = capSearchUIDs(burst)
	if len(got) != maxSearchResults {
		t.Fatalf("expected cap %d, got %d", maxSearchResults, len(got))
	}
	if got[0] != uint32(maxSearchResults+15) {
		t.Fatalf("expected newest uid first, got %v", got)
	}
}
