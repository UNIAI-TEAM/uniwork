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
		ID: participantID, MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest A",
		Role: RoleAttendee, SourceType: GrantInviteLink, SourceID: strText("link1"), AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: participantID,
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

// A signed-in user from another workspace who walked in through an invite
// link is a participant like a guest is, not an outsider (UNI-901).
func TestLinkAdmittedOutsiderUserCanReadMeetingRoomData(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Outsider room")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.authorizeActiveParticipant(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("outsider before the link: %v", err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := s.Evaluate(ctx, AdmissionContext{
		MeetingID: m.ID, UserID: ub.ID,
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("outsider via link: %+v err=%v", dec, err)
	}

	ps, err := s.ListParticipants(ctx, ub.ID, "", m.ID)
	if err != nil || len(ps) < 2 {
		t.Fatalf("outsider list participants: len=%d err=%v", len(ps), err)
	}
	if _, err := s.AppendChatMessage(ctx, ub.ID, "", m.ID, "from outside"); err != nil {
		t.Fatalf("outsider append chat: %v", err)
	}
	msgs, err := s.ChatMessages(ctx, ub.ID, "", m.ID)
	if err != nil || len(msgs) != 1 {
		t.Fatalf("outsider list chat: len=%d err=%v", len(msgs), err)
	}
	// The participant row opens the room, never the workspace.
	if _, err := s.Get(ctx, ub.ID, m.ID); err == nil {
		t.Fatal("outsider read the meeting record")
	}

	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, dec.Participant.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("removed outsider chat: %v", err)
	}
}

// The same outsider admitted by a host who approved their link request.
func TestApprovedLinkRequestOutsiderCanReadMeetingRoomData(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Approval room")
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := s.Evaluate(ctx, AdmissionContext{
		MeetingID: m.ID, UserID: ub.ID,
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	})
	if err != nil || dec.Decision != DecisionWaitingApproval {
		t.Fatalf("outsider request via link: %+v err=%v", dec, err)
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("outsider before approval: %v", err)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, dec.JoinRequestID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != nil {
		t.Fatalf("approved outsider chat: %v", err)
	}
}

// Only the invite link stands in for membership. A row the person holds from
// their time in the workspace (a direct invite, say) is not a way back in once
// they have left it, been deactivated or seen their organization suspended.
func TestLeftoverParticipantRowDoesNotOpenTheRoom(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Former member")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalUser, UserID: strText(ub.ID),
		DisplayNameSnapshot: "Former", Role: RoleAttendee, SourceType: GrantDirectInvite, AddedBy: ua.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ChatMessages(ctx, ub.ID, "", m.ID); err != ErrForbidden {
		t.Fatalf("leftover direct-invite row: %v", err)
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
		ID: participantID, MeetingID: m.ID, OrganizationID: m.OrganizationID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest",
		Role: RoleAttendee, SourceType: GrantInviteLink, AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateAccessGrant(ctx, db.CreateAccessGrantParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: participantID,
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

// Spec D2 (update 2026-10-01): an account from outside the workspace that an
// invite link admits only observes — it is not on a vote's roll or counted for
// quorum — until the host makes it a member. A workspace member who uses the
// same link is a member as always.
func TestLinkAdmittedStanding(t *testing.T) {
	cases := []struct {
		name   string
		member bool
		mode   string
		want   string
	}{
		{"outsider auto-admit", false, LinkAutoAdmit, StandingObserver},
		{"outsider approved", false, LinkRequestApproval, StandingObserver},
		{"member auto-admit", true, LinkAutoAdmit, StandingMember},
		{"member approved", true, LinkRequestApproval, StandingMember},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s, ua, ub, w := meetingFixture(t)
			ctx := context.Background()
			if c.member {
				addMember(t, s, w.ID, ub.ID)
			}
			m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Họp HĐQT")
			if err != nil {
				t.Fatal(err)
			}
			created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", c.mode, time.Now().Add(time.Hour), nil)
			if err != nil {
				t.Fatal(err)
			}
			dec, err := s.Evaluate(ctx, AdmissionContext{
				MeetingID: m.ID, UserID: ub.ID,
				InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
			})
			if err != nil {
				t.Fatal(err)
			}
			if dec.Decision == DecisionWaitingApproval {
				if err := s.ApproveJoinRequest(ctx, ua.ID, dec.JoinRequestID); err != nil {
					t.Fatal(err)
				}
			}
			p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ub.ID)})
			if err != nil {
				t.Fatalf("participant row after admission (decision %s): %v", dec.Decision, err)
			}
			if p.Standing != c.want {
				t.Fatalf("standing = %s, want %s", p.Standing, c.want)
			}
		})
	}
}
