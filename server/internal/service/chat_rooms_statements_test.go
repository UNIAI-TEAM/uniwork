package service

import (
	"context"
	"fmt"
	"testing"

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
