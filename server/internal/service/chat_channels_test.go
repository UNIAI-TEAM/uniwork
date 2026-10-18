package service

import (
	"context"
	"slices"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// Two leave/re-invite rounds leave two 'left' rows; joining again must add one
// fresh active row instead of reviving both into the active unique index.
func TestJoinPublicChannelAfterLeavingTwice(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "ops-rejoin", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, ch.ID, []string{ub.ID}); err != nil {
		t.Fatalf("re-invite: %v", err)
	}
	if err := s.RemoveChatRoomMember(ctx, ua.ID, w.ID, ch.ID, ub.ID); err != nil {
		t.Fatalf("kick: %v", err)
	}

	if _, err := s.JoinChannel(ctx, ub.ID, w.ID, ch.ID); err != nil {
		t.Fatalf("join after leaving twice: %v", err)
	}
	mine, err := s.ListChannels(ctx, ub.ID, w.ID, ListChannelsInput{Scope: "mine"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range mine {
		found = found || r.ID == ch.ID
	}
	if !found {
		t.Fatal("rejoined channel missing from mine list")
	}

	count := func(sql string) int {
		t.Helper()
		var n int
		if err := s.pool.QueryRow(ctx, sql, ch.ID, ub.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM chat_room_members WHERE room_id = $1 AND user_id = $2 AND status = 'active'`); n != 1 {
		t.Fatalf("active member rows = %d, want 1", n)
	}
	if n := count(`SELECT count(*) FROM audit_events WHERE action = 'chat.room.member_added' AND resource_id = $1
		AND metadata::jsonb->>'member_id' = $2 AND metadata::jsonb->>'via' = 'join'`); n != 1 {
		t.Fatalf("join audit rows = %d, want 1", n)
	}
}

func TestJoinChannelKeepsSendRestriction(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "ops-readonly", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	restrict := func(on bool) {
		t.Helper()
		if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
			RoomID: ch.ID, UserID: ub.ID, SendRestricted: on,
		}); err != nil {
			t.Fatal(err)
		}
	}
	leaveAndJoin := func() bool {
		t.Helper()
		if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, ch.ID); err != nil {
			t.Fatalf("leave: %v", err)
		}
		if _, err := s.JoinChannel(ctx, ub.ID, w.ID, ch.ID); err != nil {
			t.Fatalf("join: %v", err)
		}
		m, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: ch.ID, UserID: ub.ID})
		if err != nil {
			t.Fatal(err)
		}
		return m.SendRestricted
	}

	// A read-only member cannot lift the mark by leaving and joining again.
	restrict(true)
	if !leaveAndJoin() {
		t.Fatal("rejoin cleared send_restricted")
	}
	// Two 'left' rows now exist; only the latest one decides.
	restrict(false)
	if leaveAndJoin() {
		t.Fatal("rejoin took send_restricted from an older left row")
	}
	restrict(true)
	if !leaveAndJoin() {
		t.Fatal("rejoin ignored the latest left row's send_restricted")
	}
}

// The only admin of a channel or group that others still use cannot leave it,
// by leaving or by removing themselves, until someone else is admin: nobody
// would be left to invite, kick or promote.
func TestLastAdminCannotLeaveARoomOthersStillUse(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "last-admin-c@example.com")

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "du-an-x", Visibility: chatVisibilityPrivate, MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Sales", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	admin := "admin"
	for _, roomID := range []string{ch.ID, group.ID} {
		if err := s.LeaveChatRoom(ctx, ua.ID, w.ID, roomID); !codedIs(err, "chat_last_admin") {
			t.Fatalf("room %s: last admin leave = %v, want chat_last_admin", roomID, err)
		}
		if _, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: roomID, UserID: ua.ID}); err != nil {
			t.Fatalf("room %s: refused leave must keep the admin: %v", roomID, err)
		}
		if err := s.UpdateChatRoomMember(ctx, ua.ID, w.ID, roomID, ub.ID, UpdateChatRoomMemberInput{Role: &admin}); err != nil {
			t.Fatalf("room %s: promote: %v", roomID, err)
		}
		if err := s.LeaveChatRoom(ctx, ua.ID, w.ID, roomID); err != nil {
			t.Fatalf("room %s: leave once another admin exists: %v", roomID, err)
		}
		// Removing oneself is leaving too.
		if err := s.RemoveChatRoomMember(ctx, ub.ID, w.ID, roomID, ub.ID); !codedIs(err, "chat_last_admin") {
			t.Fatalf("room %s: last admin self-removal = %v, want chat_last_admin", roomID, err)
		}
	}
}

// ListChatRoomMembers marks the room's creator, the one the client needs to
// mirror canModerateChatRoom and canDemoteChatAdmin.
func TestListChatRoomMembersMarksTheCreator(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "creator-flag-c@example.com")
	group, err := s.CreateGroup(ctx, ub.ID, w.ID, CreateGroupInput{Name: "Sales", MemberUserIDs: []string{ua.ID, uc.ID}})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	members, err := s.ListChatRoomMembers(ctx, ua.ID, w.ID, group.ID)
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	if len(members) != 3 {
		t.Fatalf("members = %d, want 3", len(members))
	}
	for _, m := range members {
		if m.IsCreator != (m.UserID == ub.ID) {
			t.Fatalf("member %s IsCreator = %v", m.UserID, m.IsCreator)
		}
	}
}

// "N người đã xem" counts the members whose read pointer reached a message,
// so the member list carries each pointer, at the message's own precision.
func TestListChatRoomMembersCarriesTheReadPointer(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "read-pointer-c@example.com")
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Ops", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "seen?"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := s.MarkRoomRead(ctx, ub.ID, w.ID, group.ID); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	members, err := s.ListChatRoomMembers(ctx, ua.ID, w.ID, group.ID)
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	byID := map[string]ChatRoomMemberView{}
	for _, m := range members {
		byID[m.UserID] = m
	}
	if got := byID[ub.ID].LastReadAt; got == nil || !got.Equal(msg.CreatedAt) {
		t.Fatalf("reader LastReadAt = %v, want the message time %v", got, msg.CreatedAt)
	}
	if got := byID[uc.ID].LastReadAt; got != nil {
		t.Fatalf("member who never read has LastReadAt %v", got)
	}
}

// UNI-1672: chat.channel.updated is ephemeral, so the outbox row alone reaches
// nobody; unarchiving tells the members directly, as UpdateChannel does.
func TestUnarchiveChannelTellsTheMembers(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "sale", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ArchiveChannel(ctx, ua.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	pub.sent = nil
	if err := s.UnarchiveChannel(ctx, ua.ID, w.ID, ch.ID); err != nil {
		t.Fatal(err)
	}
	got := pub.sentTo("chat.channel.updated")
	for _, id := range []string{ua.ID, ub.ID} {
		if !slices.Contains(got, "user:"+id) {
			t.Fatalf("unarchive went to %v, want every member including %s", got, id)
		}
	}
}
