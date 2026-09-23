package service

import (
	"strings"
	"testing"
)

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

// Reacting to a file, voice or poll message must not drop the rest of its
// metadata: the attachment's object key lives beside the reactions.
func TestToggleReactionKeepsOtherMetadata(t *testing.T) {
	raw := []byte(`{"filename":"a.pdf","object_key":"k/1","content_type":"application/pdf","size_bytes":10}`)
	added, err := toggleReactionInMetadata(raw, "USER1", "👍")
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := toggleReactionInMetadata(added, "USER1", "👍")
	if err != nil {
		t.Fatal(err)
	}
	for _, out := range [][]byte{added, cleared} {
		if !strings.Contains(string(out), `"object_key":"k/1"`) || !strings.Contains(string(out), `"filename":"a.pdf"`) {
			t.Fatalf("file metadata lost: %s", out)
		}
	}
	pinned, _, err := togglePinInMetadata(raw)
	if err != nil {
		t.Fatal(err)
	}
	unpinned, isPinned, err := togglePinInMetadata(pinned)
	if err != nil || isPinned {
		t.Fatalf("unpin: %v %v", err, isPinned)
	}
	if !strings.Contains(string(unpinned), `"object_key":"k/1"`) {
		t.Fatalf("unpin dropped file metadata: %s", unpinned)
	}
}

func TestMyReactionsFromMetadata(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1","USER2"],"❤️":["user2"],"🎉":["USER3"]}}`)
	got := myReactionsFromMetadata(raw, "user2")
	if len(got) != 2 || got[0] != "❤️" && got[1] != "❤️" {
		t.Fatalf("mine: %+v", got)
	}
	if myReactionsFromMetadata(raw, "") != nil {
		t.Fatal("no viewer means no mine")
	}
	if myReactionsFromMetadata(raw, "USER9") != nil {
		t.Fatal("viewer without reactions should be nil")
	}
}
