package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
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
	ps, _ := s.ListParticipants(ctx, ua.ID, m.ID)
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
	ps, _ := s.ListParticipants(ctx, ua.ID, m.ID)
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
	ps2, _ := s.ListParticipants(ctx, ua.ID, m2.ID)
	for _, p := range ps2 {
		if p.UserID.String == ub.ID {
			t.Fatal("reject created participant")
		}
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
