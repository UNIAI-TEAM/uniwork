package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingChatService is the fixture's chat service on a pool that counts
// statements, so a per-room loop shows up as a number instead of a hunch.
func countingChatService(t *testing.T, s *ChatService) (*ChatService, *queryCounter) {
	t.Helper()
	cpool, counter := countingPool(t, s.pool)
	cq := db.New(cpool)
	orgs := NewOrganizationService(cpool, cq)
	ws := NewWorkspaceService(cpool, cq, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	return NewChatService(cpool, cq, ws, &capturePublisher{}), counter
}

func mentionOf(u db.User) string {
	return fmt.Sprintf("[@%s](mention://member/%s) ", u.DisplayName, u.ID)
}

// The sidebar is a constant number of statements however many rooms the
// caller is in (C3), and its badges still count right: unread capped at 100
// (the client shows 99+), mentions by name and by @all, the DM peer joined in.
func TestListChatRoomsIsConstantStatements(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendWorkspaceMessage(ctx, ub.ID, w.ID, SendChatMessageInput{Body: mentionAllBody}); err != nil {
		t.Fatal(err)
	}

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The caller's own message is never unread (sending also moves their cursor).
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "mine"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, dm.ID, SendChatMessageInput{Body: fmt.Sprintf("dm %d", i)}); err != nil {
			t.Fatal(err)
		}
	}

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Trio", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{mentionOf(ua) + "xem giúp", mentionAllBody, mentionOf(uc) + "không phải A"} {
		if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, group.ID, SendChatMessageInput{Body: body}); err != nil {
			t.Fatal(err)
		}
	}

	var busy ChatRoomSummary
	for i := 0; i < 47; i++ {
		ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
			Name: fmt.Sprintf("kenh-%02d", i), Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
		})
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			busy = ch
		}
	}
	for i := 0; i < 105; i++ {
		if _, err := q.CreateChatMessage(ctx, db.CreateChatMessageParams{
			ID: util.NewID(), RoomID: busy.ID, WorkspaceID: w.ID, SenderID: ub.ID,
			SenderKind: "human", Body: fmt.Sprintf("m%d", i), OrganizationID: w.OrganizationID,
		}); err != nil {
			t.Fatal(err)
		}
	}

	cs, counter := countingChatService(t, s)
	before := counter.n.Load()
	rooms, err := cs.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	statements := counter.n.Load() - before
	t.Logf("ListChatRooms for %d rooms: %d statements", len(rooms), statements)
	if len(rooms) != 50 {
		t.Fatalf("sidebar rooms = %d, want 50 (default + dm + group + 47 channels)", len(rooms))
	}
	if statements > 10 {
		t.Fatalf("ListChatRooms ran %d statements for %d rooms, want <= 10", statements, len(rooms))
	}

	byID := map[string]ChatRoomSummary{}
	for _, r := range rooms {
		byID[r.ID] = r
	}
	if !rooms[0].IsDefault || rooms[0].UnreadCount != 1 || rooms[0].MentionUnreadCount != 1 {
		t.Fatalf("default channel first with unread 1 and @all mention 1: %+v", rooms[0])
	}
	gotDM := byID[dm.ID]
	if gotDM.UnreadCount != 3 || gotDM.MentionUnreadCount != 0 || gotDM.PeerUserID != ub.ID ||
		gotDM.PeerEmail != ub.Email || gotDM.PeerDisplayName != ub.DisplayName || gotDM.LastMessageBody != "dm 2" {
		t.Fatalf("dm row: %+v", gotDM)
	}
	gotGroup := byID[group.ID]
	if gotGroup.UnreadCount != 3 || gotGroup.MentionUnreadCount != 2 || len(gotGroup.MemberUserIDs) != 2 {
		t.Fatalf("group row: unread %d mentions %d members %v; want 3, 2 (named + @all), 2",
			gotGroup.UnreadCount, gotGroup.MentionUnreadCount, gotGroup.MemberUserIDs)
	}
	if got := byID[busy.ID]; got.UnreadCount != 100 || !strings.HasPrefix(got.LastMessageBody, "m") {
		t.Fatalf("busy channel unread = %d, want capped at 100", got.UnreadCount)
	}

	// Reading moves the cursor: the DM peer's read shows on the reader's side.
	if _, err := s.ListRoomMessages(ctx, ub.ID, w.ID, dm.ID, ListChatMessagesInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListRoomMessages(ctx, ua.ID, w.ID, group.ID, ListChatMessagesInput{}); err != nil {
		t.Fatal(err)
	}
	rooms, err = cs.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rooms {
		if r.ID == dm.ID && r.PeerLastReadAt == nil {
			t.Fatal("dm peer read cursor missing after the peer read")
		}
		if r.ID == group.ID && (r.UnreadCount != 0 || r.MentionUnreadCount != 0) {
			t.Fatalf("group after reading: %+v", r)
		}
	}
}

// Opening a room reads its main timeline, so a thread reply newer than the
// last main message must not keep the room unread after the open.
func TestThreadRepliesDoNotKeepARoomUnread(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	uc := chatTestUser(t, q, w, "thread-unread-c@example.com")
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "thread-unread", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, roomID := range []string{group.ID, ch.ID} {
		root, err := s.SendRoomMessage(ctx, ub.ID, w.ID, roomID, SendChatMessageInput{Body: "root"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, roomID, root.ID, SendChatMessageInput{Body: "reply"}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.ListRoomMessages(ctx, ua.ID, w.ID, roomID, ListChatMessagesInput{}); err != nil {
			t.Fatal(err)
		}
	}
	rooms, err := s.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rooms {
		if (r.ID == group.ID || r.ID == ch.ID) && r.UnreadCount != 0 {
			t.Fatalf("%s %s unread after opening = %d, want 0", r.Kind, r.ID, r.UnreadCount)
		}
	}
}

// A member who has never read a room counts from when they joined: history
// from before is not unread, and an old @all is not their mention.
func TestUnreadStartsAtJoinForAMemberWhoNeverRead(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	uc := chatTestUser(t, q, w, "late-joiner-c@example.com")
	ud := chatTestUser(t, q, w, "late-joiner-d@example.com")
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "late-joiner", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	for _, roomID := range []string{ch.ID, group.ID} {
		if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: mentionAllBody}); err != nil {
			t.Fatal(err)
		}
	}
	joined, err := s.JoinChannel(ctx, uc.ID, w.ID, ch.ID)
	if err != nil {
		t.Fatal(err)
	}
	if joined.MentionUnreadCount != 0 {
		t.Fatalf("join summary mentions = %d, want 0", joined.MentionUnreadCount)
	}
	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, []string{ud.ID}); err != nil {
		t.Fatal(err)
	}
	for _, u := range []db.User{uc, ud} {
		rooms, err := s.ListChatRooms(ctx, u.ID, w.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rooms {
			if (u.ID == uc.ID && r.ID == ch.ID) || (u.ID == ud.ID && r.ID == group.ID) {
				if r.UnreadCount != 0 || r.MentionUnreadCount != 0 {
					t.Fatalf("%s %s for a late joiner: unread %d mentions %d, want 0 and 0", r.Kind, r.ID, r.UnreadCount, r.MentionUnreadCount)
				}
			}
		}
	}
}
