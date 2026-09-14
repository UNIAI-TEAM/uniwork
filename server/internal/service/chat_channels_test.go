package service

import (
	"context"
	"testing"
)

func TestChatChannelsCreateJoinDiscover(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	pub, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "general-pub", Visibility: chatVisibilityPublic, Topic: "hello",
	})
	if err != nil {
		t.Fatalf("create public: %v", err)
	}
	if pub.Kind != chatRoomKindChannel || pub.Visibility != chatVisibilityPublic || pub.IsDefault {
		t.Fatalf("public channel shape: %+v", pub)
	}

	priv, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "secrets", Visibility: chatVisibilityPrivate,
	})
	if err != nil {
		t.Fatalf("create private: %v", err)
	}

	disc, err := s.ListChannels(ctx, ub.ID, w.ID, ListChannelsInput{Scope: "discoverable"})
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	foundPub, foundPriv := false, false
	for _, r := range disc {
		if r.ID == pub.ID {
			foundPub = true
		}
		if r.ID == priv.ID {
			foundPriv = true
		}
	}
	if !foundPub {
		t.Fatal("expected public channel in discoverable")
	}
	if foundPriv {
		t.Fatal("private channel must not appear in discoverable")
	}

	if _, err := s.JoinChannel(ctx, ub.ID, w.ID, priv.ID); !codedIs(err, "chat_channel_private") {
		t.Fatalf("join private: want chat_channel_private, got %v", err)
	}
	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, priv.ID, ListChatMessagesInput{}); !codedIs(err, "chat_channel_private") {
		t.Fatalf("read private: want chat_channel_private, got %v", err)
	}

	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, pub.ID, ListChatMessagesInput{}); err != nil {
		t.Fatalf("read public without join: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, pub.ID, SendChatMessageInput{Body: "hi"}); !codedIs(err, "chat_not_member") {
		t.Fatalf("send before join: want chat_not_member, got %v", err)
	}
	joined, err := s.JoinChannel(ctx, ub.ID, w.ID, pub.ID)
	if err != nil || joined.ID != pub.ID {
		t.Fatalf("join: err=%v room=%+v", err, joined)
	}
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, pub.ID, SendChatMessageInput{Body: "hi"}); err != nil {
		t.Fatalf("send after join: %v", err)
	}

	disc2, err := s.ListChannels(ctx, ub.ID, w.ID, ListChannelsInput{Scope: "discoverable"})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range disc2 {
		if r.ID == pub.ID {
			t.Fatal("joined channel still in discoverable")
		}
	}
}

func TestChatChannelDefaultImmutable(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.q.GetChatRoomByID(ctx, room.RoomID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != chatRoomKindChannel || !got.IsDefault {
		t.Fatalf("ensure should create default channel, got kind=%s default=%v", got.Kind, got.IsDefault)
	}
	vis := chatVisibilityPrivate
	if _, err := s.UpdateChannel(ctx, ua.ID, w.ID, room.RoomID, UpdateChannelInput{Visibility: &vis}); !codedIs(err, "chat_channel_default_immutable") {
		t.Fatalf("visibility change: want default_immutable, got %v", err)
	}
	if err := s.ArchiveChannel(ctx, ua.ID, w.ID, room.RoomID); !codedIs(err, "chat_channel_default_immutable") {
		t.Fatalf("archive: want default_immutable, got %v", err)
	}
}

func TestChatChannelNameValidation(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	if _, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "", Visibility: "public"}); !codedIs(err, "chat_channel_name_invalid") {
		t.Fatalf("empty name: got %v", err)
	}
}

func TestChatChannelLeaveAndKick(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "ops", Visibility: chatVisibilityPrivate, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatalf("member leave: %v", err)
	}
	mine, err := s.ListChannels(ctx, ub.ID, w.ID, ListChannelsInput{Scope: "mine"})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range mine {
		if r.ID == ch.ID {
			t.Fatal("left channel still in mine list")
		}
	}

	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, ch.ID, []string{ub.ID}); err != nil {
		t.Fatalf("re-invite: %v", err)
	}
	if err := s.RemoveChatRoomMember(ctx, ua.ID, w.ID, ch.ID, ub.ID); err != nil {
		t.Fatalf("kick from channel: %v", err)
	}
	// Kick must not remove workspace membership.
	if _, err := s.ws.RequireMember(ctx, w.ID, ub.ID); err != nil {
		t.Fatalf("kick must keep workspace membership: %v", err)
	}

	def, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.LeaveChatRoom(ctx, ua.ID, w.ID, def.RoomID); err == nil {
		t.Fatal("must not leave default channel")
	}
}

func TestListChatRoomsIncludesJoinedChannels(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "sidebar-dev", Visibility: chatVisibilityPublic,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	rooms, err := s.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("list rooms: %v", err)
	}
	found := false
	for _, r := range rooms {
		if r.ID == ch.ID {
			found = true
			if r.Kind != chatRoomKindChannel || r.Visibility != chatVisibilityPublic {
				t.Fatalf("channel shape in list: %+v", r)
			}
			break
		}
	}
	if !found {
		t.Fatal("created channel missing from ListChatRooms (sidebar source)")
	}
}
