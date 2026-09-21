package imapclient

import "testing"

func TestCapIncrementalUIDs(t *testing.T) {
	t.Parallel()
	in := []uint32{105, 101, 103, 102, 104}
	got := capIncrementalUIDs(in)
	if len(got) != len(in) {
		t.Fatalf("expected all %d uids, got %d", len(in), len(got))
	}
	for i, uid := range in {
		if got[i] != uid {
			t.Fatalf("expected order preserved under cap, got %v", got)
		}
	}

	burst := make([]uint32, maxIncrementalUIDBatch+10)
	for i := range burst {
		burst[i] = uint32(i + 1)
	}
	got = capIncrementalUIDs(burst)
	if len(got) != maxIncrementalUIDBatch {
		t.Fatalf("expected batch cap %d, got %d", maxIncrementalUIDBatch, len(got))
	}
	if got[0] != 1 || got[len(got)-1] != uint32(maxIncrementalUIDBatch) {
		t.Fatalf("expected lowest uids first, got %v", got)
	}
}
