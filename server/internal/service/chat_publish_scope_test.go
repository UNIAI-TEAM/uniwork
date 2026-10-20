package service

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"
)

// A non-default channel's members are not the workspace. Every message event
// of such a channel goes to chat:{room}; one that went to the workspace told
// every member who typed, read, edited or deleted what in a private channel.
func TestChannelMessageEventsStayInTheChannelScope(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "private-ops", Visibility: chatVisibilityPrivate,
	})
	if err != nil {
		t.Fatal(err)
	}
	chatTypingLastPublished.Range(func(k, _ any) bool {
		chatTypingLastPublished.Delete(k)
		return true
	})
	pub.sent = nil

	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "hello"})
	if err != nil {
		t.Fatal(err)
	}
	steps := []struct {
		name string
		run  func() error
	}{
		{"edit", func() error { _, err := s.EditChatMessage(ctx, ua.ID, w.ID, ch.ID, msg.ID, "hello!"); return err }},
		{"react", func() error {
			_, err := s.ToggleChatMessageReaction(ctx, ua.ID, w.ID, ch.ID, msg.ID, "👍")
			return err
		}},
		{"pin", func() error { _, err := s.ToggleChatMessagePin(ctx, ua.ID, w.ID, ch.ID, msg.ID); return err }},
		{"typing", func() error { return s.SignalTyping(ctx, ua.ID, w.ID, ch.ID) }},
		{"poll", func() error {
			_, err := s.SendPollMessage(ctx, ua.ID, w.ID, ch.ID, SendPollMessageInput{Question: "Q?", Options: []string{"a", "b"}})
			return err
		}},
		{"note", func() error {
			_, err := s.SendNoteMessage(ctx, ua.ID, w.ID, ch.ID, SendNoteMessageInput{Body: "note"})
			return err
		}},
		{"post", func() error {
			_, err := s.SendPostMessage(ctx, ua.ID, w.ID, ch.ID, SendPostMessageInput{Title: "T", Body: "post"})
			return err
		}},
		{"reminder", func() error {
			_, err := s.SendReminderMessage(ctx, ua.ID, w.ID, ch.ID, SendReminderMessageInput{
				Body: "later", RemindAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			})
			return err
		}},
		{"delete", func() error { return s.DeleteChatMessage(ctx, ua.ID, w.ID, ch.ID, msg.ID) }},
	}
	for _, st := range steps {
		if err := st.run(); err != nil {
			t.Fatalf("%s: %v", st.name, err)
		}
	}

	room := ChatScopeType + ":" + ch.ID
	for _, typ := range []string{"chat.message.created", "chat.message.updated", "chat.message.deleted", "chat.typing"} {
		dests := pub.sentTo(typ)
		if !slices.Contains(dests, room) {
			t.Errorf("%s never reached %s: %v", typ, room, dests)
		}
		for _, d := range dests {
			if strings.HasPrefix(d, "workspace:") {
				t.Errorf("%s of a non-default channel went to %s", typ, d)
			}
		}
	}
}

// The default channel's members are the workspace, so its events stay on the
// workspace by design.
func TestDefaultRoomMessageEventsGoToTheWorkspace(t *testing.T) {
	s, pub, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "hi all"})
	if err != nil {
		t.Fatal(err)
	}
	pub.sent = nil
	if _, err := s.EditChatMessage(ctx, ua.ID, w.ID, room.RoomID, msg.ID, "hi everyone"); err != nil {
		t.Fatal(err)
	}
	if got := pub.sentTo("chat.message.updated"); !slices.Equal(got, []string{"workspace:" + w.ID}) {
		t.Fatalf("default room edit went to %v, want the workspace", got)
	}
	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, room.RoomID, SendPollMessageInput{
		Question: "Họp lúc mấy giờ?", Options: []string{"9h", "10h"},
	})
	pub.sent = nil
	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, room.RoomID, poll.ID, poll.Poll.Options[0].ID); err != nil {
		t.Fatal(err)
	}
	if got := pub.sentTo("chat.message.updated"); !slices.Equal(got, []string{"workspace:" + w.ID}) {
		t.Fatalf("default room vote went to %v, want the workspace", got)
	}
}

// chat.room.read matters to the reader's other tabs and, in a DM, to the peer
// who renders the receipt; nobody else. A read that does not move the pointer
// is no news, and every client that hears one reloads its sidebar.
func TestRoomReadReachesOnlyTheReaderAndTheDMPeer(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "team", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "news"}); err != nil {
		t.Fatal(err)
	}
	pub.sent = nil
	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, ch.ID, ListChatMessagesInput{}); err != nil {
		t.Fatal(err)
	}
	if got := pub.sentTo("chat.room.read"); !slices.Equal(got, []string{"user:" + ub.ID}) {
		t.Fatalf("channel read went to %v, want only the reader", got)
	}
	pub.sent = nil
	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, ch.ID, ListChatMessagesInput{}); err != nil {
		t.Fatal(err)
	}
	if err := s.MarkRoomRead(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if got := pub.sentTo("chat.room.read"); len(got) != 0 {
		t.Fatalf("a read that did not advance the pointer was published to %v", got)
	}

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "psst"}); err != nil {
		t.Fatal(err)
	}
	pub.sent = nil
	if err := s.MarkRoomRead(ctx, ub.ID, w.ID, dm.ID); err != nil {
		t.Fatal(err)
	}
	got := pub.sentTo("chat.room.read")
	slices.Sort(got)
	want := []string{"user:" + ua.ID, "user:" + ub.ID}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("DM read went to %v, want the reader and the peer %v", got, want)
	}
}

// "N người đã xem": a read that moves a member's pointer in a group or a
// non-default channel reaches the sockets holding that room open. The default
// channel's members are the workspace and a DM has its own receipt
// (chat.room.read to the peer), so neither hears it.
func TestMemberReadReachesTheRoomScopeOfGroupsAndChannelsOnly(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	uc := chatTestUser(t, q, w, "member-read-c@example.com")
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Sales", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "team", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, roomID := range []string{group.ID, ch.ID} {
		if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: "news"}); err != nil {
			t.Fatal(err)
		}
		pub.sent, pub.events = nil, nil
		if err := s.MarkRoomRead(ctx, ub.ID, w.ID, roomID); err != nil {
			t.Fatal(err)
		}
		if got := pub.sentTo("chat.room.member_read"); !slices.Equal(got, []string{"chat:" + roomID}) {
			t.Fatalf("member read of %s went to %v, want the room scope", roomID, got)
		}
		for _, ev := range pub.events {
			if ev.Type != "chat.room.member_read" {
				continue
			}
			p := ev.Payload
			if len(p) != 2 || p["room_id"] != roomID || p["user_id"] != ub.ID {
				t.Fatalf("member read payload = %v, want ids only", p)
			}
		}
		pub.sent = nil
		if err := s.MarkRoomRead(ctx, ub.ID, w.ID, roomID); err != nil {
			t.Fatal(err)
		}
		if got := pub.sentTo("chat.room.member_read"); len(got) != 0 {
			t.Fatalf("a read that did not move the pointer was published to %v", got)
		}
	}

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendWorkspaceMessage(ctx, ub.ID, w.ID, SendChatMessageInput{Body: "hi all"}); err != nil {
		t.Fatal(err)
	}
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, dm.ID, SendChatMessageInput{Body: "psst"}); err != nil {
		t.Fatal(err)
	}
	for _, roomID := range []string{room.RoomID, dm.ID} {
		pub.sent = nil
		if err := s.MarkRoomRead(ctx, ua.ID, w.ID, roomID); err != nil {
			t.Fatal(err)
		}
		if got := pub.sentTo("chat.room.read"); !slices.Contains(got, "user:"+ua.ID) {
			t.Fatalf("read of %s did not move the pointer (chat.room.read went to %v)", roomID, got)
		}
		if got := pub.sentTo("chat.room.member_read"); len(got) != 0 {
			t.Fatalf("member read of %s went to %v, want nowhere", roomID, got)
		}
	}
}
