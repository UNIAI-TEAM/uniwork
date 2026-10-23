package service

import (
	"context"
	"slices"
	"testing"
	"time"
)

// The thread pill's faces: a root carries its three latest distinct
// repliers, newest first, in the timeline and when fetched alone.
func TestThreadRootCarriesItsLatestDistinctRepliers(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "repliers-c@example.com")
	ud := chatTestUser(t, q, w, "repliers-d@example.com")
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Sự kiện", MemberUserIDs: []string{ub.ID, uc.ID, ud.ID}})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "danh sách khách mời"})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "không ai trả lời"})
	if err != nil {
		t.Fatal(err)
	}
	for i, replier := range []string{ud.ID, ub.ID, uc.ID, ub.ID, ua.ID, ub.ID} {
		reply, err := s.SendThreadReply(ctx, replier, w.ID, group.ID, root.ID, SendChatMessageInput{Body: "ok"})
		if err != nil {
			t.Fatal(err)
		}
		// One minute apart, whatever the database clock did between the sends.
		if _, err := pool.Exec(ctx, "UPDATE chat_messages SET created_at = $2 WHERE id = $1",
			reply.ID, root.CreatedAt.Add(time.Duration(i+1)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{ub.ID, ua.ID, uc.ID} // ud replied first and falls off the three

	rows, err := s.ListRoomMessages(ctx, ua.ID, w.ID, group.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		switch row.ID {
		case root.ID:
			if !slices.Equal(row.ThreadParticipantIDs, want) {
				t.Fatalf("root repliers = %v, want %v", row.ThreadParticipantIDs, want)
			}
		case plain.ID:
			if row.ThreadParticipantIDs != nil {
				t.Fatalf("a message without replies carries repliers %v", row.ThreadParticipantIDs)
			}
		}
	}
	one, err := s.GetRoomMessage(ctx, ub.ID, w.ID, group.ID, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(one.ThreadParticipantIDs, want) {
		t.Fatalf("fetched root repliers = %v, want %v", one.ThreadParticipantIDs, want)
	}
}
