package service

import (
	"testing"
)

func TestParseMentionUserIDsFromBody(t *testing.T) {
	memberIDs, all := parseMentionUserIDsFromBody(
		"hi [@Binh](mention://member/USER2) and [@all](mention://all/all)",
	)
	if !all {
		t.Fatal("expected @all")
	}
	if len(memberIDs) != 1 || memberIDs[0] != "USER2" {
		t.Fatalf("member ids = %#v", memberIDs)
	}
}

func TestMentionedUserIDsFromMetadata(t *testing.T) {
	raw := []byte(`{"mentioned_user_ids":["USER2","USER2","USER3"]}`)
	got := mentionedUserIDsFromMetadata(raw)
	if len(got) != 2 || got[0] != "USER2" || got[1] != "USER3" {
		t.Fatalf("got %#v", got)
	}
}

func TestMessageMentionsCurrentUser(t *testing.T) {
	raw := []byte(`{"mentioned_user_ids":["USER2"]}`)
	if !messageMentionsCurrentUser(raw, "user2") {
		t.Fatal("expected mention match")
	}
	if messageMentionsCurrentUser(raw, "USER9") {
		t.Fatal("unexpected mention match")
	}
}

func TestEncodeMentionsMetadataPreservesReactions(t *testing.T) {
	raw := []byte(`{"reactions":{"👍":["USER1"]}}`)
	next, err := encodeMentionsMetadata(raw, []string{"USER2"})
	if err != nil {
		t.Fatal(err)
	}
	meta := decodeChatMessageMetadata(next)
	if len(meta.Reactions["👍"]) != 1 || meta.Reactions["👍"][0] != "USER1" {
		t.Fatalf("reactions lost: %#v", meta.Reactions)
	}
	if len(meta.MentionedUserIDs) != 1 || meta.MentionedUserIDs[0] != "USER2" {
		t.Fatalf("mentions missing: %#v", meta.MentionedUserIDs)
	}
}
