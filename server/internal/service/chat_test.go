package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func countEvents(events []Event, typ string) int {
	n := 0
	for _, ev := range events {
		if ev.Type == typ {
			n++
		}
	}
	return n
}

func chatFixture(t *testing.T) (*ChatService, *capturePublisher, *db.Queries, db.User, db.User, db.Workspace) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "chat-a@example.com", "A")
	ub := registerVerified(t, q, as, "chat-b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-chat")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Chat WS", "chat-ws")
	pub := &capturePublisher{}
	return NewChatService(q, ws, pub), pub, q, ua, ub, v.Workspace
}

func TestWorkspaceChatRoomAndMessages(t *testing.T) {
	s, pub, _, ua, ub, w := chatFixture(t)
	ctx := context.Background()

	status, err := s.GetWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil || !status.Enabled || status.RoomID != "" {
		t.Fatalf("initial status: err=%v status=%+v", err, status)
	}

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil || room.RoomID == "" {
		t.Fatalf("ensure room: err=%v room=%+v", err, room)
	}

	msgs, err := s.ListWorkspaceMessages(ctx, ua.ID, w.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) != 0 {
		t.Fatalf("empty list: err=%v len=%d", err, len(msgs))
	}

	sent, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "Xin chào team"})
	if err != nil || sent.Body != "Xin chào team" {
		t.Fatalf("send: err=%v msg=%+v", err, sent)
	}
	if len(pub.events) != 1 || pub.events[0].Type != "chat.message.created" {
		t.Fatalf("publish: %+v", pub.events)
	}

	reacted, err := s.ToggleChatMessageReaction(ctx, ua.ID, w.ID, sent.RoomID, sent.ID, "👍")
	if err != nil || reacted.Reactions["👍"] != 1 {
		t.Fatalf("toggle reaction: err=%v msg=%+v", err, reacted)
	}
	if pub.events[len(pub.events)-1].Type != "chat.message.updated" {
		t.Fatalf("reaction publish: %+v", pub.events)
	}

	reacted, err = s.ToggleChatMessageReaction(ctx, ua.ID, w.ID, sent.RoomID, sent.ID, "👍")
	if err != nil || len(reacted.Reactions) != 0 {
		t.Fatalf("remove reaction: err=%v msg=%+v", err, reacted)
	}

	msgs, err = s.ListWorkspaceMessages(ctx, ua.ID, w.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) != 1 || msgs[0].Body != "Xin chào team" {
		t.Fatalf("list after send: err=%v msgs=%+v", err, msgs)
	}

	if _, err := s.ListWorkspaceMessages(ctx, ub.ID, w.ID, ListChatMessagesInput{}); err != ErrForbidden {
		t.Fatalf("non-member list: %v", err)
	}
}

func addWorkspaceMember(t *testing.T, q *db.Queries, workspaceID, userID string) {
	t.Helper()
	if err := q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: userID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
}

func addOrgMember(t *testing.T, q *db.Queries, orgID, userID string) {
	t.Helper()
	if err := q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: orgID, UserID: userID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestResolveDM(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil || dm.Kind != "dm" || dm.ID == "" {
		t.Fatalf("resolve dm: err=%v dm=%+v", err, dm)
	}
	if countEvents(pub.events, "chat.room.created") != 2 {
		t.Fatalf("publish create: %+v", pub.events)
	}

	dm2, err := s.ResolveDM(ctx, ub.ID, w.ID, ua.ID)
	if err != nil || dm2.ID != dm.ID {
		t.Fatalf("dedupe dm: err=%v dm2=%+v", err, dm2)
	}

	sent, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "Chào B"})
	if err != nil || sent.Body != "Chào B" {
		t.Fatalf("send dm: err=%v msg=%+v", err, sent)
	}

	msgs, err := s.ListRoomMessages(ctx, ub.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) != 1 {
		t.Fatalf("list dm: err=%v len=%d", err, len(msgs))
	}

	rooms, err := s.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, room := range rooms {
		if room.ID == dm.ID && room.Kind == "dm" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("list rooms missing dm: %+v", rooms)
	}
}

func TestCreateGroupAndInvite(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)
	pub.events = nil

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Nhóm test", MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil || group.Kind != "group" || group.ID == "" {
		t.Fatalf("create group: err=%v group=%+v", err, group)
	}
	if countEvents(pub.events, "chat.room.created") != 3 {
		t.Fatalf("publish create group: %+v", pub.events)
	}

	group2, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Khác", MemberUserIDs: []string{uc.ID, ub.ID},
	})
	if err != nil || group2.ID != group.ID {
		t.Fatalf("dedupe group: err=%v group2=%+v", err, group2)
	}

	ud := registerVerified(t, q, as, "chat-d@example.com", "D")
	addOrgMember(t, q, w.OrganizationID, ud.ID)
	pub.events = nil
	updated, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, []string{ud.ID})
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if len(updated.MemberUserIDs) < 3 {
		t.Fatalf("members after invite: %+v", updated.MemberUserIDs)
	}
	if countEvents(pub.events, "chat.room.updated") != 4 {
		t.Fatalf("publish invite: %+v", pub.events)
	}

	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, group.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, group.ID, ListChatMessagesInput{}); err != ErrForbidden {
		t.Fatalf("left member list: %v", err)
	}
}

func TestBlockDM(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.BlockChatUser(ctx, ub.ID, w.ID, ua.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "blocked"}); err == nil {
		t.Fatal("send should fail when blocked")
	}
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, dm.ID, SendChatMessageInput{Body: "also blocked"}); err == nil {
		t.Fatal("blocked user send should fail too")
	}
	rooms, err := s.ListChatRooms(ctx, ub.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, room := range rooms {
		if room.Kind == "dm" && room.PeerUserID == ua.ID {
			t.Fatalf("blocked dm should be hidden: %+v", rooms)
		}
	}
	if err := s.UnblockChatUser(ctx, ub.ID, w.ID, ua.ID); err != nil {
		t.Fatalf("unblock: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "ok again"}); err != nil {
		t.Fatalf("send after unblock: %v", err)
	}
}

func TestResolveDMAfterLeave(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "hi"}); err != nil {
		t.Fatalf("send before leave: %v", err)
	}
	if err := s.LeaveChatRoom(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("leave dm: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "blocked"}); err != ErrForbidden {
		t.Fatalf("send after leave: %v", err)
	}

	dm2, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil || dm2.ID != dm.ID {
		t.Fatalf("re-resolve dm: err=%v dm=%+v", err, dm2)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "back again"}); err != nil {
		t.Fatalf("send after rejoin: %v", err)
	}
	msgs, err := s.ListRoomMessages(ctx, ub.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) < 2 {
		t.Fatalf("list after rejoin: err=%v len=%d", err, len(msgs))
	}
}

func TestDMPeerVisibleWhenPeerLeaves(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "hi"}); err != nil {
		t.Fatalf("send before peer leave: %v", err)
	}
	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("peer leave: %v", err)
	}
	rooms, err := s.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	dmCount := 0
	for _, room := range rooms {
		if room.Kind != "dm" {
			continue
		}
		dmCount++
		if room.ID != dm.ID || room.PeerUserID != ub.ID {
			t.Fatalf("unexpected dm row: %+v", room)
		}
	}
	if dmCount != 1 {
		t.Fatalf("expected one dm for remaining member, got %d: %+v", dmCount, rooms)
	}
}

func TestEmptyDMHiddenUntilFirstMessage(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}

	uaRooms, err := s.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, room := range uaRooms {
		if room.ID == dm.ID {
			t.Fatalf("empty dm should not appear for initiator: %+v", uaRooms)
		}
	}

	ubRooms, err := s.ListChatRooms(ctx, ub.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, room := range ubRooms {
		if room.ID == dm.ID {
			t.Fatalf("empty dm should not appear for peer: %+v", ubRooms)
		}
	}

	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "hello"}); err != nil {
		t.Fatalf("send: %v", err)
	}

	ubRooms, err = s.ListChatRooms(ctx, ub.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, room := range ubRooms {
		if room.ID == dm.ID && room.Kind == "dm" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("peer should see dm after first message: %+v", ubRooms)
	}
}

func TestResolveDMCrossWorkspaceSameOrg(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	w2View, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Chat WS 2", "chat-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w2View.Workspace.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil || dm.ID == "" {
		t.Fatalf("resolve from ws1: err=%v dm=%+v", err, dm)
	}

	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "cross-ws hi"}); err != nil {
		t.Fatalf("send from ws1: %v", err)
	}

	msgs, err := s.ListRoomMessages(ctx, ub.ID, w2View.Workspace.ID, dm.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) != 1 || msgs[0].Body != "cross-ws hi" {
		t.Fatalf("list from ws2: err=%v msgs=%+v", err, msgs)
	}
}

func TestVoiceBlockedDM(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.BlockChatUser(ctx, ub.ID, w.ID, ua.ID); err != nil {
		t.Fatalf("block: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-1"); err == nil {
		t.Fatal("voice invite should fail when blocked")
	}
	if _, err := s.MintVoiceTokenRoom(ctx, ua.ID, dm.ID, "call-1"); err == nil {
		t.Fatal("voice token should fail when blocked")
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-1"); err == nil {
		t.Fatal("voice accept should fail when blocked")
	}
}

func TestVoiceInviteAfterLeave(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.LeaveChatRoom(ctx, ua.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-1"); err != ErrForbidden {
		t.Fatalf("invite after leave: %v", err)
	}
}

func TestVoiceAcceptAfterLeave(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, dm.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("accept after leave: %v", err)
	}
	if _, err := s.MintVoiceTokenRoom(ctx, ub.ID, dm.ID, "call-1"); err != nil {
		t.Fatalf("token after accept rejoin: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-2"); err != nil {
		t.Fatalf("invite to rejoined peer: %v", err)
	}
}

func TestVoiceCallLogCompleted(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-log-1"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, "call-log-1"); err != nil {
		t.Fatalf("accept: %v", err)
	}
	duration := 42
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, "call-log-1", &duration); err != nil {
		t.Fatalf("hangup: %v", err)
	}
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, msg := range msgs {
		if msg.Kind != "voice_call_log" || msg.VoiceCall == nil {
			continue
		}
		found = true
		if msg.VoiceCall.Outcome != voiceCallOutcomeCompleted {
			t.Fatalf("outcome: %+v", msg.VoiceCall)
		}
		if msg.VoiceCall.DurationSeconds != duration {
			t.Fatalf("duration: got %d want %d", msg.VoiceCall.DurationSeconds, duration)
		}
		if msg.VoiceCall.CallerID != ua.ID {
			t.Fatalf("caller: %+v", msg.VoiceCall)
		}
	}
	if !found {
		t.Fatal("voice call log message missing")
	}
	logPublished := false
	for _, ev := range pub.events {
		if ev.Type == "chat.message.created" {
			logPublished = true
			break
		}
	}
	if !logPublished {
		t.Fatalf("publish log: %+v", pub.events)
	}
}

func TestGroupVoiceCall(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	ud := registerVerified(t, q, as, "chat-d-voice@example.com", "D")
	addOrgMember(t, q, w.OrganizationID, ud.ID)
	addWorkspaceMember(t, q, w.ID, ud.ID)

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Voice group", MemberUserIDs: []string{ub.ID, ud.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	pub.events = nil

	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, group.ID, "group-call-1"); err != nil {
		t.Fatalf("group invite: %v", err)
	}
	last := pub.events[len(pub.events)-1]
	if last.Type != "chat.voice.invite" {
		t.Fatalf("invite event: %+v", last)
	}
	if last.Payload["call_kind"] != chatRoomKindGroup {
		t.Fatalf("call_kind: %+v", last.Payload)
	}
	if last.Payload["room_name"] != "Voice group" {
		t.Fatalf("room_name: %+v", last.Payload)
	}
	if last.Payload["target_user_id"] != "" {
		t.Fatalf("group invite should not set target_user_id: %+v", last.Payload)
	}

	if err := s.SignalVoiceAccept(ctx, uc.ID, w.ID, group.ID, "group-call-1"); err != ErrForbidden {
		t.Fatalf("stranger group accept: %v", err)
	}
	if _, err := s.MintVoiceTokenRoom(ctx, uc.ID, group.ID, "group-call-1"); err != ErrForbidden {
		t.Fatalf("stranger group token: %v", err)
	}

	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, group.ID, "group-call-1"); err != nil {
		t.Fatalf("member accept: %v", err)
	}
	lkRoom, err := s.MintVoiceTokenRoom(ctx, ub.ID, group.ID, "group-call-1")
	if err != nil {
		t.Fatalf("member token: %v", err)
	}
	if !strings.HasSuffix(lkRoom, "-group-call-1") {
		t.Fatalf("per-call livekit room: %q", lkRoom)
	}

	if err := s.LeaveChatRoom(ctx, ub.ID, w.ID, group.ID); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, group.ID, "group-call-2"); err != ErrForbidden {
		t.Fatalf("left member accept: %v", err)
	}
}

func TestGroupVoiceTokenInvitedMember(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	ud := registerVerified(t, q, as, "chat-invited-voice@example.com", "D")
	addOrgMember(t, q, w.OrganizationID, ud.ID)
	addWorkspaceMember(t, q, w.ID, ud.ID)
	ue := registerVerified(t, q, as, "chat-invited-voice-e@example.com", "E")
	addOrgMember(t, q, w.OrganizationID, ue.ID)
	addWorkspaceMember(t, q, w.ID, ue.ID)

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Invite voice", MemberUserIDs: []string{ub.ID, ue.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, []string{ud.ID}); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, group.ID, "inv-call-1"); err != nil {
		t.Fatalf("voice invite: %v", err)
	}
	if _, err := s.MintVoiceTokenRoom(ctx, ud.ID, group.ID, "inv-call-1"); err != nil {
		t.Fatalf("invited member token: %v", err)
	}
}

func TestGroupVoiceHangupOnlyCaller(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := registerVerified(t, q, as, "chat-hangup-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Hangup group", MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, group.ID, "group-hangup-1"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	pub.events = nil

	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, group.ID, "group-hangup-1", nil); err != ErrForbidden {
		t.Fatalf("member hangup for all: %v", err)
	}
	if err := s.SignalVoiceHangup(ctx, ua.ID, w.ID, group.ID, "group-hangup-1", nil); err != nil {
		t.Fatalf("caller hangup for all: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.voice.hangup" {
		t.Fatalf("hangup publish: %+v", pub.events[len(pub.events)-1])
	}
}

func TestVoiceCallStrangerCannotJoin(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, "call-stranger"); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, uc.ID, w.ID, dm.ID, "call-stranger"); err != ErrForbidden {
		t.Fatalf("stranger accept: %v", err)
	}
	if _, err := s.MintVoiceTokenRoom(ctx, uc.ID, dm.ID, "call-stranger"); err != ErrForbidden {
		t.Fatalf("stranger token: %v", err)
	}
}

func TestLookupUserDifferentOrg(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	orgs := NewOrganizationService(q)
	otherOrg, err := orgs.Create(ctx, ub.ID, "Other Org", "other-org")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.LookupUserByEmail(ctx, ua.ID, w.ID, ub.Email)
	if err != ErrNotFound {
		t.Fatalf("lookup across orgs: err=%v want not found", err)
	}
	_ = otherOrg
}
