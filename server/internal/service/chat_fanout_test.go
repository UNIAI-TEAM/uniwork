package service

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatGroupOf creates a group of the fixture's owner and n new org members.
func chatGroupOf(t *testing.T, s *ChatService, q *db.Queries, ownerID string, w db.Workspace, n int) (ChatRoomSummary, []string) {
	t.Helper()
	ctx := context.Background()
	ids := make([]string, 0, n)
	for i := range n {
		u, err := q.CreateUser(ctx, db.CreateUserParams{
			ID: util.NewID(), Email: fmt.Sprintf("fanout-%d-%s@example.com", i, util.NewID()), DisplayName: fmt.Sprintf("F%d", i), Locale: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		addOrgMember(t, q, w.OrganizationID, u.ID)
		ids = append(ids, u.ID)
	}
	group, err := s.CreateGroup(ctx, ownerID, w.ID, CreateGroupInput{Name: "Fan-out", MemberUserIDs: ids})
	if err != nil {
		t.Fatal(err)
	}
	return group, ids
}

func countOf(xs []string, x string) int {
	return len(slices.DeleteFunc(slices.Clone(xs), func(s string) bool { return s != x }))
}

// C4: a message's activity frame and its @all mentions are each one batched
// publish for the whole room, which the realtime publisher hands off the
// request and sends only to members with a socket.
func TestRoomMessageFansOutAsOneBatch(t *testing.T) {
	s, pub, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	group, _ := chatGroupOf(t, s, q, ua.ID, w, 4)

	pub.sent, pub.batches = nil, nil
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: mentionAllBody}); err != nil {
		t.Fatal(err)
	}
	if n := countOf(pub.batches, "chat.room.activity"); n != 1 {
		t.Fatalf("activity batches = %d, want 1 (%v)", n, pub.batches)
	}
	if n := len(pub.sentTo("chat.room.activity")); n != 5 {
		t.Fatalf("activity reached %d members, want 5", n)
	}
	if n := countOf(pub.batches, "chat.mention.created"); n != 1 {
		t.Fatalf("mention batches = %d, want 1 (%v)", n, pub.batches)
	}
	if n := len(pub.sentTo("chat.mention.created")); n != 4 {
		t.Fatalf("@all reached %d members, want the 4 besides the sender", n)
	}
}
