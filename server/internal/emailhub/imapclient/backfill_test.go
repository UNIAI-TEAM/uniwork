package imapclient

import "testing"

func TestCapNewestUIDs(t *testing.T) {
	t.Parallel()
	in := []uint32{10, 5, 99, 42}
	got := capNewestUIDs(in, BackfillBatchSize)
	if len(got) != len(in) {
		t.Fatalf("expected all uids under cap, got %d", len(got))
	}

	burst := make([]uint32, BackfillBatchSize+12)
	for i := range burst {
		burst[i] = uint32(i + 1)
	}
	got = capNewestUIDs(burst, BackfillBatchSize)
	if len(got) != BackfillBatchSize {
		t.Fatalf("expected cap %d, got %d", BackfillBatchSize, len(got))
	}
	if got[0] != uint32(BackfillBatchSize+12) {
		t.Fatalf("expected newest uid first, got %v", got)
	}
}
