package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestListChatRoomsStatementCount counts every statement GET /chat/rooms
// costs, the workspace gate included, for a person in sidebarRooms groups
// that each hold an unread message (H19, chat assessment §3.2 E).
func TestListChatRoomsStatementCount(t *testing.T) {
	const sidebarRooms = 20
	// shortcut: 66 statements today (about three per room); this bound only
	// stops it getting worse. The target is ≤ 10 for any room count once the
	// sidebar query rewrite (UNI-1066) lands: lower it then.
	const maxStatements = 70

	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	for i := range sidebarRooms {
		uc, err := q.CreateUser(ctx, db.CreateUserParams{
			ID: util.NewID(), Email: fmt.Sprintf("sidebar-%d@example.com", i), DisplayName: fmt.Sprintf("S%d", i), Locale: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		addOrgMember(t, q, w.OrganizationID, uc.ID)
		group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: fmt.Sprintf("G%d", i), MemberUserIDs: []string{ub.ID, uc.ID}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.SendRoomMessage(ctx, ub.ID, w.ID, group.ID, SendChatMessageInput{Body: "hi"}); err != nil {
			t.Fatal(err)
		}
	}

	counted, counter := countingPool(t, pool)
	cq := db.New(counted)
	ws := NewWorkspaceService(counted, cq, NewOrganizationService(counted, cq), mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	cs := NewChatService(counted, cq, ws, &capturePublisher{})
	rooms, err := cs.ListChatRooms(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rooms) < sidebarRooms {
		t.Fatalf("sidebar has %d rooms, want ≥ %d", len(rooms), sidebarRooms)
	}
	n := counter.n.Load()
	t.Logf("GET /chat/rooms with %d rooms: %d statements", len(rooms), n)
	if n > maxStatements {
		t.Fatalf("GET /chat/rooms with %d rooms ran %d statements, bound is %d", len(rooms), n, maxStatements)
	}
}

// TestSendRoomMessageStatementCount bounds how many DB round-trips one text
// send with @mention and priority costs (UNI-1746).
func TestSendRoomMessageStatementCount(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	// A group needs two members besides its creator (CreateGroup).
	uc := registerVerified(t, q, NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "chat-c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "send-perf", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	cs, counter := countingChatService(t, s)
	body := mentionOf(ub) + "xem giúp"
	if _, err := cs.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{
		Body: body, Priority: chatMessagePriorityUrgent,
	}); err != nil {
		t.Fatal(err)
	}
	n := int(counter.n.Load())
	t.Logf("SendRoomMessage with @mention and priority: %d statements", n)
	// One fewer GetActiveChatRoomMember and two metadata UPDATEs removed (UNI-1746).
	const maxStatements = 18
	if n > maxStatements {
		t.Fatalf("send ran %d statements, want ≤ %d", n, maxStatements)
	}
}

// TestAuthorizeChatScopeStatementCount bounds WS chat:{roomId} subscribe checks
// (UNI-1711): one workspace gate, room load, membership — not GetWorkspaceByID.
func TestAuthorizeChatScopeStatementCount(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "ws-scope", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	counted, counter := countingPool(t, pool)
	cq := db.New(counted)
	ws := NewWorkspaceService(counted, cq, NewOrganizationService(counted, cq), mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	cs := NewChatService(counted, cq, ws, &capturePublisher{})
	ok, err := cs.AuthorizeChatScope(ctx, ua.ID, w.ID, ch.ID)
	if err != nil || !ok {
		t.Fatalf("AuthorizeChatScope ok=%v err=%v", ok, err)
	}
	n := counter.n.Load()
	t.Logf("AuthorizeChatScope: %d statements", n)
	const maxStatements = 3
	if n > maxStatements {
		t.Fatalf("AuthorizeChatScope ran %d statements, want ≤ %d", n, maxStatements)
	}
}
