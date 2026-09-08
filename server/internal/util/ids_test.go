package util

import "testing"

func TestNewIDIsMonotonicWithinAMillisecond(t *testing.T) {
	prev := NewID()
	for i := 0; i < 256; i++ {
		next := NewID()
		if next <= prev {
			t.Fatalf("id %d not strictly after previous: %s then %s", i, prev, next)
		}
		prev = next
	}
}
