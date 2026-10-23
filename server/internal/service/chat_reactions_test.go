package service

import (
	"strings"
	"testing"
)

func TestReactionCountsFromMetadata(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1","USER2"],"❤️":["USER1"]}}`)
	got := reactionCountsFromMetadata(decodeChatMessageMetadata(raw))
	if got["👍"] != 2 || got["❤️"] != 1 {
		t.Fatalf("counts: %+v", got)
	}
	if reactionCountsFromMetadata(decodeChatMessageMetadata(nil)) != nil {
		t.Fatal("empty metadata should be nil")
	}
}

func TestToggleReactionInMetadata(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1"]}}`)
	added, err := toggleReactionInMetadata(raw, "USER2", "👍")
	if err != nil {
		t.Fatal(err)
	}
	got := reactionCountsFromMetadata(decodeChatMessageMetadata(added))
	if got["👍"] != 2 {
		t.Fatalf("add: %+v", got)
	}

	removed, err := toggleReactionInMetadata(added, "USER1", "👍")
	if err != nil {
		t.Fatal(err)
	}
	got = reactionCountsFromMetadata(decodeChatMessageMetadata(removed))
	if got["👍"] != 1 {
		t.Fatalf("remove one: %+v", got)
	}

	cleared, err := toggleReactionInMetadata(removed, "USER2", "👍")
	if err != nil {
		t.Fatal(err)
	}
	if reactionCountsFromMetadata(decodeChatMessageMetadata(cleared)) != nil {
		t.Fatalf("last toggle should clear emoji: %s", cleared)
	}

	if _, err := toggleReactionInMetadata(nil, "USER1", ""); err == nil {
		t.Fatal("empty emoji should fail")
	}
}

func TestChatReactionMustBeABoundedEmoji(t *testing.T) {
	for _, ok := range []string{"👍", "❤️", "👨‍👩‍👧‍👦", "1️⃣", "🇻🇳"} {
		if _, err := toggleReactionInMetadata(nil, "USER1", ok); err != nil {
			t.Errorf("%q refused: %v", ok, err)
		}
	}
	for _, bad := range []string{"like", "a👍", "ố", "👍 👍", "\x00", "123", strings.Repeat("👍", 9)} {
		_, err := toggleReactionInMetadata(nil, "USER1", bad)
		requireValidationError(t, err, bad)
	}
}

func TestChatReactionKindsPerMessageAreCapped(t *testing.T) {
	var raw []byte
	for i := 0; i < maxChatReactionKinds; i++ {
		next, err := toggleReactionInMetadata(raw, "USER1", string(rune(0x1F600+i)))
		if err != nil {
			t.Fatalf("reaction %d: %v", i, err)
		}
		raw = next
	}
	_, err := toggleReactionInMetadata(raw, "USER1", "🚀")
	requireValidationError(t, err, "one kind past the cap")
	// An existing kind still toggles at the cap.
	if _, err := toggleReactionInMetadata(raw, "USER2", string(rune(0x1F600))); err != nil {
		t.Fatalf("existing kind at the cap: %v", err)
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
	got := myReactionsFromMetadata(decodeChatMessageMetadata(raw), "user2")
	if len(got) != 2 || got[0] != "❤️" && got[1] != "❤️" {
		t.Fatalf("mine: %+v", got)
	}
	if myReactionsFromMetadata(decodeChatMessageMetadata(raw), "") != nil {
		t.Fatal("no viewer means no mine")
	}
	if myReactionsFromMetadata(decodeChatMessageMetadata(raw), "USER9") != nil {
		t.Fatal("viewer without reactions should be nil")
	}
}
