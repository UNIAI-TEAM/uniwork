package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestGuestActiveParticipantCanReadMeetingRoomData(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Guest room")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, ua.ID, "", m.ID, "hello members"); err != nil {
		t.Fatal(err)
	}

	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	participantID := util.NewID()
	if _, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: participantID, MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest A",
		Role: RoleAttendee, SourceType: GrantInviteLink, SourceID: strText("link1"), AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: participantID,
		SourceType: GrantInviteLink, GrantedBy: ua.ID,
	}); err != nil {
		t.Fatal(err)
	}

	msgs, err := s.ChatMessages(ctx, "", guestID, m.ID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("guest list chat: len=%d err=%v", len(msgs), err)
	}
	ps, err := s.ListParticipants(ctx, "", guestID, m.ID)
	if err != nil || len(ps) < 2 {
		t.Fatalf("guest list participants: len=%d err=%v", len(ps), err)
	}

	msg, err := s.AppendChatMessage(ctx, "", guestID, m.ID, "from guest")
	if err != nil || msg.SenderName != "Guest A" {
		t.Fatalf("guest append chat: %+v err=%v", msg, err)
	}

	otherGuest := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, otherGuest); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChatMessages(ctx, "", otherGuest, m.ID); err != ErrForbidden {
		t.Fatalf("outsider guest chat: %v", err)
	}
}

func TestGuestChatBeforeMeetingStart(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Later", StartsAt: start, EndsAt: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	participantID := util.NewID()
	if _, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: participantID, MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest",
		Role: RoleAttendee, SourceType: GrantInviteLink, AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, ParticipantID: participantID,
		SourceType: GrantInviteLink, GrantedBy: ua.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AppendChatMessage(ctx, "", guestID, m.ID, "early"); err == nil {
		t.Fatal("guest chat before start accepted")
	}
	if _, err := s.ChatMessages(ctx, "", guestID, m.ID); err != nil {
		t.Fatalf("guest can read roster before start: %v", err)
	}
}

func TestMemberChatStillRequiresJoin(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Chat")
	if err != nil {
		t.Fatal(err)
	}
	var ve ValidationError
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "hi"); !errors.As(err, &ve) || ve.Msg != "chưa tham gia phòng họp" {
		t.Fatalf("want join validation, got %v", err)
	}
}

func TestAuthorizeActiveParticipant(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Access")
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.authorizeActiveParticipant(ctx, ua.ID, "", m.ID)
	if err != nil || got.ID != m.ID {
		t.Fatalf("member access: %+v err=%v", got, err)
	}
	if _, err := s.authorizeActiveParticipant(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("non-member user: %v", err)
	}
	if _, err := s.authorizeActiveParticipant(ctx, "", "", m.ID); err != ErrForbidden {
		t.Fatalf("missing principal: %v", err)
	}
	if _, err := s.authorizeActiveParticipant(ctx, ua.ID, "", util.NewID()); err != ErrNotFound {
		t.Fatalf("unknown meeting: %v", err)
	}

	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.authorizeActiveParticipant(ctx, "", guestID, m.ID); err != ErrForbidden {
		t.Fatalf("guest without participant row: %v", err)
	}
}
