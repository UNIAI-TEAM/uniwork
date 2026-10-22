package service

import (
	"testing"
	"time"
)

func TestTypingMapPrunesStaleEntries(t *testing.T) {
	chatTypingLastPublished.Range(func(k, _ any) bool {
		chatTypingLastPublished.Delete(k)
		return true
	})
	chatTypingLastPrune.Store(0)

	stale := time.Now().Add(-chatTypingMinGap - time.Second)
	chatTypingLastPublished.Store("u1|r1", stale)
	chatTypingLastPublished.Store("u2|r2", time.Now())

	chatTypingLastPrune.Store(time.Now().Add(-chatTypingPruneEvery - time.Second).UnixNano())
	shouldPublishTyping("u3", "r3", time.Now())

	if _, ok := chatTypingLastPublished.Load("u1|r1"); ok {
		t.Fatal("stale typing key should be pruned")
	}
	if _, ok := chatTypingLastPublished.Load("u2|r2"); !ok {
		t.Fatal("recent typing key should remain")
	}
}
