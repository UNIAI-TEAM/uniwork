package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// deliverChatEvents drains the outbox into the fixture's publisher. Room
// events leave through the outbox now, so a test asking "were the members
// told" has to run the delivery path rather than read a synchronous publish.
func deliverChatEvents(t *testing.T, pool *pgxpool.Pool, q *db.Queries, s *ChatService, pub *capturePublisher) {
	t.Helper()
	d := outbox.New(pool, q, outbox.Options{})
	d.Register(outbox.NewRealtimeConsumer(RealtimePublisher{Pub: pub}).WithMembers(s))
	if err := d.Process(context.Background(), 200); err != nil {
		t.Fatal(err)
	}
}

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
	s, pub, q, ua, ub, w, _ := chatFixtureWithPool(t)
	return s, pub, q, ua, ub, w
}

// chatFixtureWithPool is chatFixture plus the pool, for the tests that build a
// second service of their own.
func chatFixtureWithPool(t *testing.T) (*ChatService, *capturePublisher, *db.Queries, db.User, db.User, db.Workspace, *pgxpool.Pool) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "chat-a@example.com", "A")
	ub := registerVerified(t, q, as, "chat-b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-chat")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Chat WS", "chat-ws")
	pub := &capturePublisher{}
	return NewChatService(pool, q, ws, pub), pub, q, ua, ub, v.Workspace, pool
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

func TestWorkspaceRoomMemberRolesAndKick(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}
	ownerMember, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.RoomID, UserID: ua.ID,
	})
	if err != nil || ownerMember.Role != "admin" {
		t.Fatalf("owner chat role: err=%v role=%q", err, ownerMember.Role)
	}
	memberRow, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.RoomID, UserID: ub.ID,
	})
	if err != nil || memberRow.Role != "member" {
		t.Fatalf("member chat role: err=%v role=%q", err, memberRow.Role)
	}

	if err := s.RemoveWorkspaceRoomMember(ctx, ub.ID, w.ID, room.RoomID, ua.ID); err != ErrForbidden {
		t.Fatalf("member kick owner: %v", err)
	}
	pub.events = nil
	if err := s.RemoveWorkspaceRoomMember(ctx, ua.ID, w.ID, room.RoomID, ub.ID); err != nil {
		t.Fatalf("owner kick member: %v", err)
	}
	if len(pub.events) != 1 || pub.events[0].Type != "chat.room.updated" {
		t.Fatalf("kick publish: %+v", pub.events)
	}
	if _, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.RoomID, UserID: ub.ID,
	}); err == nil {
		t.Fatal("kicked member still active in chat room")
	}
	if _, err := s.ListWorkspaceMessages(ctx, ub.ID, w.ID, ListChatMessagesInput{}); err != ErrForbidden {
		t.Fatalf("kicked member still reads workspace chat: %v", err)
	}
}

func TestChatRoomModerationPromoteMuteAndGroupKick(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure workspace room: %v", err)
	}
	adminRole := "admin"
	if err := s.UpdateChatRoomMember(ctx, ua.ID, w.ID, wsRoom.RoomID, ub.ID, UpdateChatRoomMemberInput{
		Role: &adminRole,
	}); err != nil {
		t.Fatalf("promote workspace chat admin: %v", err)
	}
	restricted := true
	if err := s.UpdateChatRoomMember(ctx, ub.ID, w.ID, wsRoom.RoomID, uc.ID, UpdateChatRoomMemberInput{
		SendRestricted: &restricted,
	}); err != nil {
		t.Fatalf("mute member: %v", err)
	}
	if _, err := s.SendWorkspaceMessage(ctx, uc.ID, w.ID, SendChatMessageInput{Body: "blocked"}); err == nil {
		t.Fatal("muted member should not send in workspace room")
	}
	if _, err := s.ListWorkspaceMessages(ctx, uc.ID, w.ID, ListChatMessagesInput{}); err != nil {
		t.Fatalf("muted member should still read: %v", err)
	}

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Mod group", MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	creatorMember, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: group.ID, UserID: ua.ID,
	})
	if err != nil || creatorMember.Role != "admin" {
		t.Fatalf("creator admin: err=%v role=%q", err, creatorMember.Role)
	}
	pub.events = nil
	if err := s.RemoveChatRoomMember(ctx, ua.ID, w.ID, group.ID, uc.ID); err != nil {
		t.Fatalf("kick from group: %v", err)
	}
	// Kick fans out to each remaining member's user channel (ua and ub).
	if len(pub.events) != 2 || countEvents(pub.events, "chat.room.updated") != 2 {
		t.Fatalf("kick publish: %+v", pub.events)
	}
	if _, err := s.ListRoomMessages(ctx, uc.ID, w.ID, group.ID, ListChatMessagesInput{}); err != ErrForbidden {
		t.Fatalf("kicked member still reads group: %v", err)
	}
}

func TestChatMessageEditDeletePin(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	sent, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "Original"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	edited, err := s.EditChatMessage(ctx, ua.ID, w.ID, sent.RoomID, sent.ID, "Edited body")
	if err != nil || edited.Body != "Edited body" || edited.EditedAt == nil {
		t.Fatalf("edit: err=%v msg=%+v", err, edited)
	}
	if pub.events[len(pub.events)-1].Type != "chat.message.updated" {
		t.Fatalf("edit publish: %+v", pub.events)
	}

	pinned, err := s.ToggleChatMessagePin(ctx, ub.ID, w.ID, sent.RoomID, sent.ID)
	if err != nil || !pinned.Pinned {
		t.Fatalf("pin: err=%v msg=%+v", err, pinned)
	}
	pinned, err = s.ToggleChatMessagePin(ctx, ub.ID, w.ID, sent.RoomID, sent.ID)
	if err != nil || pinned.Pinned {
		t.Fatalf("unpin: err=%v msg=%+v", err, pinned)
	}

	if _, err := s.EditChatMessage(ctx, ub.ID, w.ID, sent.RoomID, sent.ID, "Hijack"); err != ErrForbidden {
		t.Fatalf("edit other user: %v", err)
	}

	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, sent.RoomID, sent.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if pub.events[len(pub.events)-1].Type != "chat.message.deleted" {
		t.Fatalf("delete publish: %+v", pub.events[len(pub.events)-1])
	}

	msgs, err := s.ListWorkspaceMessages(ctx, ua.ID, w.ID, ListChatMessagesInput{})
	if err != nil || len(msgs) != 0 {
		t.Fatalf("list after delete: err=%v len=%d", err, len(msgs))
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
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil || dm.Kind != "dm" || dm.ID == "" {
		t.Fatalf("resolve dm: err=%v dm=%+v", err, dm)
	}
	deliverChatEvents(t, pool, q, s, pub)
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
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
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
	deliverChatEvents(t, pool, q, s, pub)
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
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
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
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
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
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
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
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
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
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	orgs := NewOrganizationService(pool, q)
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

func TestSearchRoomMessages(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "Xin chào team UniWork"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, dm.ID, SendChatMessageInput{Body: "Hello world"}); err != nil {
		t.Fatal(err)
	}

	hits, err := s.SearchRoomMessages(ctx, ua.ID, w.ID, dm.ID, SearchChatMessagesInput{Query: "UniWork"})
	if err != nil || len(hits) != 1 || hits[0].Body != "Xin chào team UniWork" {
		t.Fatalf("search uniwork: err=%v hits=%+v", err, hits)
	}
	if _, err := s.SearchRoomMessages(ctx, ua.ID, w.ID, dm.ID, SearchChatMessagesInput{Query: "a"}); err == nil {
		t.Fatal("expected short query error")
	}

	around, err := s.ListRoomMessagesAround(ctx, ua.ID, w.ID, dm.ID, hits[0].ID, 50)
	if err != nil || len(around) < 2 {
		t.Fatalf("around: err=%v len=%d", err, len(around))
	}
}

func TestSendRoomMessageIdempotentClientMsgID(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	clientID := "550e8400-e29b-41d4-a716-446655440000"
	first, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{
		Body:        "once",
		ClientMsgID: clientID,
	})
	if err != nil || first.Body != "once" {
		t.Fatalf("first send: err=%v msg=%+v", err, first)
	}
	eventCount := len(pub.events)

	second, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{
		Body:        "once retry",
		ClientMsgID: clientID,
	})
	if err != nil {
		t.Fatalf("second send: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected same message id: first=%s second=%s", first.ID, second.ID)
	}
	if len(pub.events) != eventCount {
		t.Fatalf("duplicate send must not publish again: events=%+v", pub.events)
	}

	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	textCount := 0
	for _, m := range msgs {
		if m.Body == "once" {
			textCount++
		}
	}
	if textCount != 1 {
		t.Fatalf("expected one stored message, got %d in %+v", textCount, msgs)
	}
}

func TestSendRoomMessageRejectsLongBody(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}

	longBody := strings.Repeat("a", maxChatMessageBodyLen+1)
	_, err = s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: longBody})
	var ve ValidationError
	if !errors.As(err, &ve) || ve.Msg != "tin nhắn quá dài" {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestSendWorkspaceMessageRejectsLongBody(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()

	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}

	longBody := strings.Repeat("a", maxChatMessageBodyLen+1)
	_, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: longBody})
	var ve ValidationError
	if !errors.As(err, &ve) || ve.Msg != "tin nhắn quá dài" {
		t.Fatalf("expected validation error, got %v", err)
	}
}
