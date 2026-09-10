package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestMeetingStateMachine(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "S", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err == nil {
		t.Fatal("end from scheduled")
	}
	started, err := s.Start(ctx, ua.ID, m.ID)
	if err != nil || started.Status != MeetingInProgress {
		t.Fatalf("start: %+v %v", started, err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err == nil {
		t.Fatal("double start")
	}
	var ce CodedError
	if err := s.Cancel(ctx, ua.ID, m.ID, "x"); !errors.As(err, &ce) || ce.Code != "invalid_meeting_state" {
		t.Fatalf("cancel in progress: %v", err)
	}
	ended, err := s.End(ctx, ua.ID, m.ID)
	if err != nil || ended.Status != MeetingEnded {
		t.Fatalf("end: %+v %v", ended, err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err == nil {
		t.Fatal("start ended")
	}

	m2, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "C", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err := s.Cancel(ctx, ua.ID, m2.ID, "nope"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(ctx, ua.ID, m2.ID); err == nil {
		t.Fatal("start canceled")
	}
	if _, err := s.Start(ctx, ub.ID, m.ID); err != ErrForbidden && !errors.As(err, &ce) {
		t.Fatalf("non-member start: %v", err)
	}
}

func TestInstantMeeting(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	m, err := s.CreateInstant(context.Background(), ua.ID, w.ID, "Now")
	if err != nil || m.Status != MeetingInProgress || m.MeetingType != MeetingTypeInstant {
		t.Fatalf("%+v %v", m, err)
	}
}

func TestHostTransferAndRemove(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "T", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal("invite", err)
	}
	ps, _ := s.ListParticipants(ctx, ua.ID, "", m.ID)
	var hostPID string
	for _, p := range ps {
		if p.UserID.String == ua.ID {
			hostPID = p.ID
		}
	}
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, hostPID); err == nil {
		t.Fatal("removed host")
	}
	up, err := s.TransferHost(ctx, ua.ID, m.ID, ub.ID)
	if err != nil || up.HostUserID != ub.ID {
		t.Fatalf("transfer: %+v %v", up, err)
	}
	if _, err := s.Start(ctx, ub.ID, m.ID); err != nil {
		t.Fatal("new host start", err)
	}
}

func TestInvitationRSVP(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "I", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	invs, err := s.ListInvitations(ctx, ua.ID, m.ID)
	if err != nil || len(invs) != 1 {
		t.Fatalf("invs %d %v", len(invs), err)
	}
	if _, err := s.RespondInvitation(ctx, ua.ID, m.ID, invs[0].ID, InviteAccepted); err == nil {
		t.Fatal("host responded as invitee")
	}
	got, err := s.RespondInvitation(ctx, ub.ID, m.ID, invs[0].ID, InviteAccepted)
	if err != nil || got.ResponseStatus != InviteAccepted {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestJoinRequestApproveReject(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "J", StartsAt: start, EndsAt: start.Add(time.Hour)})
	jr, err := s.RequestJoin(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID, DisplayName: "B"})
	if err != nil {
		t.Fatal(err)
	}
	jr2, err := s.RequestJoin(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID, DisplayName: "B"})
	if err != nil || jr2.ID != jr.ID {
		t.Fatalf("idempotent pending: %+v %v", jr2, err)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err == nil {
		t.Fatal("second approve")
	}
	ps, _ := s.ListParticipants(ctx, ua.ID, "", m.ID)
	found := false
	for _, p := range ps {
		if p.UserID.String == ub.ID && p.Status == ParticipantActive {
			found = true
			grants, _ := s.q.ListActiveGrantsForParticipant(ctx, p.ID)
			if len(grants) == 0 {
				t.Fatal("no grant after approve")
			}
		}
	}
	if !found {
		t.Fatal("no participant after approve")
	}
	m2, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "R", StartsAt: start, EndsAt: start.Add(time.Hour)})
	jr3, _ := s.RequestJoin(ctx, AdmissionContext{MeetingID: m2.ID, UserID: ub.ID, DisplayName: "B"})
	if err := s.RejectJoinRequest(ctx, ua.ID, jr3.ID, "no"); err != nil {
		t.Fatal(err)
	}
	ps2, _ := s.ListParticipants(ctx, ua.ID, "", m2.ID)
	for _, p := range ps2 {
		if p.UserID.String == ub.ID {
			t.Fatal("reject created participant")
		}
	}
}

func TestGuestJoinRequestApproveWithExistingParticipant(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Guest approve", StartsAt: start, EndsAt: start.Add(time.Hour)})

	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	participantID := util.NewID()
	if _, err := s.q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: participantID, MeetingID: m.ID, PrincipalType: PrincipalGuest,
		GuestID: strText(guestID), DisplayNameSnapshot: "Guest",
		Role: RoleAttendee, SourceType: GrantInviteLink, SourceID: strText("link1"), AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}

	jr, err := s.q.CreateJoinRequest(ctx, db.CreateJoinRequestParams{
		ID: util.NewID(), MeetingID: m.ID, RequesterGuestID: strText(guestID),
		DisplayNameSnapshot: "Guest", ExpiresAt: pgtype.Timestamptz{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err != nil {
		t.Fatalf("approve guest with existing participant: %v", err)
	}
	grants, err := s.q.ListActiveGrantsForParticipant(ctx, participantID)
	if err != nil || len(grants) == 0 {
		t.Fatalf("expected grant after approve, grants=%d err=%v", len(grants), err)
	}
	ps, _ := s.ListParticipants(ctx, ua.ID, "", m.ID)
	active := 0
	for _, p := range ps {
		if p.GuestID.String == guestID && p.Status == ParticipantActive {
			active++
		}
	}
	if active != 1 {
		t.Fatalf("expected one active guest participant, got %d", active)
	}
}

func TestInviteLinkRequestApprovalAdmitsAfterApprove(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(-time.Minute)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Approval link", StartsAt: start, EndsAt: start.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "guest", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}

	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	in := AdmissionContext{
		MeetingID: m.ID, GuestID: guestID, DisplayName: "Guest",
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	}

	dec, err := s.Evaluate(ctx, in)
	if err != nil || dec.Decision != DecisionWaitingApproval {
		t.Fatalf("first evaluate: %+v %v", dec, err)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, dec.JoinRequestID); err != nil {
		t.Fatal(err)
	}

	dec, err = s.Evaluate(ctx, in)
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("after approve: %+v %v", dec, err)
	}
	join, err := s.Join(ctx, in)
	if err != nil || join.Decision != DecisionAdmit || join.Credential == nil {
		t.Fatalf("join after approve: %+v %v", join, err)
	}
}

func TestInviteLinkHashAndRevoke(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "L", StartsAt: start, EndsAt: start.Add(time.Hour)})
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	if created.RawSecret == "" || created.Link.SecretHash == created.RawSecret {
		t.Fatal("raw secret stored")
	}
	if created.Link.SecretHash != hashInviteSecret(created.RawSecret) {
		t.Fatal("hash mismatch")
	}
	logs, _ := s.Activity(ctx, ua.ID, m.ID, 50, 0)
	for _, l := range logs {
		if l.Payload == created.RawSecret {
			t.Fatal("secret in audit")
		}
	}
	v, err := s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret)
	if err != nil || v.Expired {
		t.Fatalf("resolve %v %+v", err, v)
	}
	if _, err := s.ResolveInviteLink(ctx, created.Link.ID, "wrong"); err == nil {
		t.Fatal("wrong secret")
	}
	if err := s.RevokeInviteLink(ctx, ua.ID, m.ID, created.Link.ID); err != nil {
		t.Fatal(err)
	}
	dec, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID, InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret})
	if err == nil && dec.Decision == DecisionAdmit {
		t.Fatal("revoked link admitted")
	}
}

func TestAdmissionMatrix(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "A", StartsAt: start, EndsAt: start.Add(time.Hour)})
	dec, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID})
	if err != nil || dec.Decision != DecisionWaitingForHost {
		t.Fatalf("host scheduled: %+v %v", dec, err)
	}
	if _, err := s.Start(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	dec, err = s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("host live: %+v %v", dec, err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	dec, err = s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("invited live: %+v %v", dec, err)
	}
	join, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil || join.Credential == nil || join.Credential.Token == "" {
		t.Fatalf("join %+v %v", join, err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Evaluate(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID}); err == nil {
		t.Fatal("ended admitted")
	}
}

func TestWebhookDoesNotChangeMeetingStatus(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, _ := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "W", StartsAt: start, EndsAt: start.Add(time.Hour)})
	_, _ = s.Start(ctx, ua.ID, m.ID)
	before, _ := s.Get(ctx, ua.ID, m.ID)
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.room_finished", RoomName: meetings.RoomNameForMeeting(m.ID), ProviderEventID: "e1",
	}); err != nil {
		t.Fatal(err)
	}
	after, _ := s.Get(ctx, ua.ID, m.ID)
	if after.Status != before.Status {
		t.Fatalf("status %s -> %s", before.Status, after.Status)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.room_finished", RoomName: meetings.RoomNameForMeeting(m.ID), ProviderEventID: "e1",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestWebhookEndsOverdueEmptyRoom(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	pastStart := time.Now().Add(-2 * time.Hour)
	pastEnd := time.Now().Add(-5 * time.Minute)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Overdue empty", StartsAt: pastStart, EndsAt: pastEnd,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.StartMeeting(ctx, db.StartMeetingParams{
		UpdatedBy: strText(ua.ID), ID: m.ID, Version: m.Version,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.CreateConferenceSession(ctx, db.CreateConferenceSessionParams{
		ID: util.NewID(), MeetingID: m.ID, ProviderKey: s.rt.ProviderKey,
		ProviderRoomName: meetings.RoomNameForMeeting(m.ID),
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, ProviderNeutralEvent{
		Type: "conference.room_finished", RoomName: meetings.RoomNameForMeeting(m.ID), ProviderEventID: "e-overdue",
	}); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, ua.ID, m.ID)
	if got.Status != MeetingEnded {
		t.Fatalf("status %s", got.Status)
	}
}

func TestGuestAutoAdmitViaInviteLink(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Guest auto")
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "guest", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}

	dec, err := s.Evaluate(ctx, AdmissionContext{
		MeetingID: m.ID, DisplayName: "Guest Visitor",
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	})
	if err != nil || dec.Decision != DecisionAdmit || dec.Participant.ID == "" {
		t.Fatalf("auto admit guest: %+v err=%v", dec, err)
	}
	if !dec.Participant.GuestID.Valid {
		t.Fatalf("expected guest participant, got %+v", dec.Participant)
	}
}

func TestListJoinRequests(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	addMember(t, s, w.ID, ub.ID)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "List JR", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RequestJoin(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID, DisplayName: "B"}); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListJoinRequests(ctx, ua.ID, m.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("host list: len=%d err=%v", len(list), err)
	}
	if _, err := s.ListJoinRequests(ctx, ub.ID, m.ID); err == nil {
		t.Fatal("non-host list accepted")
	}
}

func TestCancelJoinRequest(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Cancel JR", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "guest", LinkRequestApproval, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	in := AdmissionContext{
		MeetingID: m.ID, GuestID: guestID, DisplayName: "Guest",
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	}
	dec, err := s.Evaluate(ctx, in)
	if err != nil || dec.Decision != DecisionWaitingApproval {
		t.Fatalf("pending request: %+v err=%v", dec, err)
	}
	if err := s.CancelJoinRequest(ctx, in, dec.JoinRequestID); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelJoinRequest(ctx, in, dec.JoinRequestID); err == nil {
		t.Fatal("second cancel accepted")
	}
	other := AdmissionContext{MeetingID: m.ID, GuestID: util.NewID(), DisplayName: "Other"}
	if err := s.CancelJoinRequest(ctx, other, dec.JoinRequestID); err != ErrForbidden {
		t.Fatalf("outsider cancel: %v", err)
	}
}
