package service

import "testing"

func TestReactionCountsFromMetadata(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1","USER2"],"❤️":["USER1"]}}`)
	got := reactionCountsFromMetadata(raw)
	if got["👍"] != 2 || got["❤️"] != 1 {
		t.Fatalf("counts: %+v", got)
	}
	if reactionCountsFromMetadata(nil) != nil {
		t.Fatal("empty metadata should be nil")
	}
}

func TestToggleReactionInMetadata(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1"]}}`)
	added, err := toggleReactionInMetadata(raw, "USER2", "👍")
	if err != nil {
		t.Fatal(err)
	}
	got := reactionCountsFromMetadata(added)
	if got["👍"] != 2 {
		t.Fatalf("add: %+v", got)
	}

	removed, err := toggleReactionInMetadata(added, "USER1", "👍")
	if err != nil {
		t.Fatal(err)
	}
	got = reactionCountsFromMetadata(removed)
	if got["👍"] != 1 {
		t.Fatalf("remove one: %+v", got)
	}

	cleared, err := toggleReactionInMetadata(removed, "USER2", "👍")
	if err != nil {
		t.Fatal(err)
	}
	if reactionCountsFromMetadata(cleared) != nil {
		t.Fatalf("last toggle should clear emoji: %s", cleared)
	}

	if _, err := toggleReactionInMetadata(nil, "USER1", ""); err == nil {
		t.Fatal("empty emoji should fail")
	}
}
