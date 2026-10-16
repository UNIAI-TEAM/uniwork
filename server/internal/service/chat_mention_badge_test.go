package service

import (
	"context"
	"fmt"
	"testing"
)

// Room detail summaries must use the same capped mention badge as the channel list.
func TestRoomSummaryMentionUnreadMatchesChannelList(t *testing.T) {
	s, _, _, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "mention-cap", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 105; i++ {
		if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, ch.ID, SendChatMessageInput{
			Body: mentionOf(ua) + fmt.Sprintf("n%d", i),
		}); err != nil {
			t.Fatal(err)
		}
	}
	list, err := s.ListChannels(ctx, ua.ID, w.ID, ListChannelsInput{Scope: "mine"})
	if err != nil {
		t.Fatal(err)
	}
	var sidebarMention int
	for _, row := range list {
		if row.ID == ch.ID {
			sidebarMention = row.MentionUnreadCount
			break
		}
	}
	if sidebarMention != 100 {
		t.Fatalf("sidebar mention_unread = %d, want capped 100", sidebarMention)
	}
	detail, err := s.JoinChannel(ctx, ua.ID, w.ID, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.MentionUnreadCount != sidebarMention {
		t.Fatalf("detail mention_unread = %d, sidebar = %d, want equal", detail.MentionUnreadCount, sidebarMention)
	}
}
