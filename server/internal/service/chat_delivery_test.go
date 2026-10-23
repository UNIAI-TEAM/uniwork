package service

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"
)

func memberDeliveredAt(t *testing.T, s *ChatService, viewerID, workspaceID, roomID, userID string) *time.Time {
	t.Helper()
	members, err := s.ListChatRoomMembers(context.Background(), viewerID, workspaceID, roomID)
	if err != nil {
		t.Fatalf("list members: %v", err)
	}
	for _, m := range members {
		if m.UserID == userID {
			return m.LastDeliveredAt
		}
	}
	t.Fatalf("%s is not a member of %s", userID, roomID)
	return nil
}

// ✓✓ grey: the delivered cursor only moves forward, never past now, and the
// sockets holding the room open hear it only when it moved.
func TestAckChatDeliveredMovesForwardOnly(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "tới chưa?"})
	if err != nil {
		t.Fatal(err)
	}
	if got := memberDeliveredAt(t, s, ua.ID, w.ID, dm.ID, ub.ID); got != nil {
		t.Fatalf("before any ack the peer's cursor is %v, want none", got)
	}

	pub.sent, pub.events = nil, nil
	if err := s.AckChatDelivered(ctx, ub.ID, w.ID, []ChatDeliveredAck{{RoomID: dm.ID, UpTo: msg.CreatedAt}}); err != nil {
		t.Fatal(err)
	}
	if got := memberDeliveredAt(t, s, ua.ID, w.ID, dm.ID, ub.ID); got == nil || !got.Equal(msg.CreatedAt) {
		t.Fatalf("delivered = %v, want the message time %v", got, msg.CreatedAt)
	}
	if got := pub.sentTo("chat.room.member_delivered"); !slices.Equal(got, []string{"chat:" + dm.ID}) {
		t.Fatalf("delivered went to %v, want the room scope", got)
	}
	for _, ev := range pub.events {
		if ev.Type == "chat.room.member_delivered" && (len(ev.Payload) != 2 || ev.Payload["room_id"] != dm.ID || ev.Payload["user_id"] != ub.ID) {
			t.Fatalf("payload = %v, want ids only", ev.Payload)
		}
	}

	pub.sent = nil
	if err := s.AckChatDelivered(ctx, ub.ID, w.ID, []ChatDeliveredAck{{RoomID: dm.ID, UpTo: msg.CreatedAt.Add(-time.Minute)}}); err != nil {
		t.Fatal(err)
	}
	if got := memberDeliveredAt(t, s, ua.ID, w.ID, dm.ID, ub.ID); got == nil || !got.Equal(msg.CreatedAt) {
		t.Fatalf("an older ack moved the cursor back to %v", got)
	}
	if got := pub.sentTo("chat.room.member_delivered"); len(got) != 0 {
		t.Fatalf("an ack that moved nothing was published to %v", got)
	}

	// A clock ahead of the server's stops at now; two entries for one room keep the furthest.
	if err := s.AckChatDelivered(ctx, ub.ID, w.ID, []ChatDeliveredAck{
		{RoomID: dm.ID, UpTo: time.Now().Add(time.Hour)}, {RoomID: dm.ID, UpTo: msg.CreatedAt},
	}); err != nil {
		t.Fatal(err)
	}
	got := memberDeliveredAt(t, s, ua.ID, w.ID, dm.ID, ub.ID)
	// A minute of slack: the database clock is not the test's.
	if got == nil || !got.After(msg.CreatedAt) || got.After(time.Now().Add(time.Minute)) {
		t.Fatalf("a future ack left the cursor at %v, want the server's now", got)
	}
}

// A read implies delivered: reading moves the delivered cursor with it.
func TestReadMovesTheDeliveredCursorToo(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "delivered-read-c@example.com")
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Kho", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "xem nhé"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkRoomRead(ctx, ub.ID, w.ID, group.ID); err != nil {
		t.Fatal(err)
	}
	if got := memberDeliveredAt(t, s, ua.ID, w.ID, group.ID, ub.ID); got == nil || !got.Equal(msg.CreatedAt) {
		t.Fatalf("after the read delivered = %v, want the read time %v", got, msg.CreatedAt)
	}
}

// A room the caller is not in is skipped without a word: the answer is the
// same as for one that does not exist, and nothing moves or is published.
func TestAckChatDeliveredSkipsRoomsTheCallerIsNotIn(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	outsider := chatTestUser(t, q, w, "delivered-outsider@example.com")
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "riêng"}); err != nil {
		t.Fatal(err)
	}
	pub.sent = nil
	if err := s.AckChatDelivered(ctx, outsider.ID, w.ID, []ChatDeliveredAck{
		{RoomID: dm.ID, UpTo: time.Now()}, {RoomID: "01NOSUCHROOM000000000000000", UpTo: time.Now()},
	}); err != nil {
		t.Fatalf("an outsider's ack = %v, want the same quiet answer as any", err)
	}
	if got := memberDeliveredAt(t, s, ua.ID, w.ID, dm.ID, ub.ID); got != nil {
		t.Fatalf("an outsider's ack moved a member's cursor to %v", got)
	}
	if got := pub.sentTo("chat.room.member_delivered"); len(got) != 0 {
		t.Fatalf("an outsider's ack was published to %v", got)
	}
	tooMany := make([]ChatDeliveredAck, MaxChatDeliveredAcks+1)
	if err := s.AckChatDelivered(ctx, ub.ID, w.ID, tooMany); !errors.As(err, new(ValidationError)) {
		t.Fatalf("%d rooms in one ack = %v, want a validation error", len(tooMany), err)
	}
}
