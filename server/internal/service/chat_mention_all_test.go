package service

import (
	"context"
	"slices"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const mentionAllBody = "[@all](mention://all/all) meeting at 3"

// smallChatRoom lowers the bound for the test so a two-person room counts as
// large; restored on cleanup.
func smallChatRoom(t *testing.T, n int) {
	t.Helper()
	prev := chatSmallRoomMembers
	chatSmallRoomMembers = n
	t.Cleanup(func() { chatSmallRoomMembers = prev })
}

// @all in a large room fans out to every member, so only the people who run
// the room may use it there; anyone may in a small room. A refused @all must
// not leave the message half-sent.
func TestMentionAllInALargeRoomIsForModerators(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "all-hands", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	smallChatRoom(t, 1)
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, ch.ID, SendChatMessageInput{Body: mentionAllBody}); !codedIs(err, "chat_mention_all_forbidden") {
		t.Fatalf("member @all in a large room: want chat_mention_all_forbidden, got %v", err)
	}
	msgs, err := s.ListRoomMessages(ctx, ub.ID, w.ID, ch.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 0 {
		t.Fatalf("a refused @all left %d message(s) behind", len(msgs))
	}

	pub.sent = nil
	sent, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: mentionAllBody})
	if err != nil {
		t.Fatalf("channel owner @all: %v", err)
	}
	if got := pub.sentTo("chat.mention.created"); !slices.Equal(got, []string{"user:" + ub.ID}) {
		t.Fatalf("@all notified %v, want every other member", got)
	}
	// The message stores a flag, not the member list (29 KB for 1,000 people).
	row, err := q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{ID: sent.ID, RoomID: ch.ID, WorkspaceID: w.ID})
	if err != nil {
		t.Fatal(err)
	}
	if meta := decodeChatMessageMetadata(row.Metadata); !meta.MentionsAll || len(meta.MentionedUserIDs) != 0 {
		t.Fatalf("metadata = %s, want mentions_all and no id list", row.Metadata)
	}
	// Readers still see themselves mentioned, and the sender does not.
	msgs, err = s.ListRoomMessages(ctx, ub.ID, w.ID, ch.ID, ListChatMessagesInput{SkipMarkRead: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 || !slices.Contains(msgs[0].MentionedUserIDs, strings.ToUpper(ub.ID)) {
		t.Fatalf("member's view of @all: %+v", msgs)
	}
	if n, err := s.roomMentionUnread(ctx, ub.ID, ch.ID, w.ID); err != nil || n != 1 {
		t.Fatalf("mention badge for @all = %d, %v; want 1", n, err)
	}
	if !messageMentionsCurrentUser(row.Metadata, ub.ID) {
		t.Fatal("@all must count as a mention of every member")
	}

	smallChatRoom(t, 50)
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, ch.ID, SendChatMessageInput{Body: mentionAllBody}); err != nil {
		t.Fatalf("member @all in a small room: %v", err)
	}
}
