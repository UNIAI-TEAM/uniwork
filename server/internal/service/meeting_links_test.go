package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func TestMeetingLinkResolveReportsRevokedDistinctly(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "R", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret, AdmissionContext{})
	if err != nil || v.LinkState != InviteLinkActive || v.MeetingState != InviteMeetingOpen || v.Expired {
		t.Fatalf("active link: %+v %v", v, err)
	}
	if err := s.RevokeInviteLink(ctx, ua.ID, m.ID, created.Link.ID); err != nil {
		t.Fatal(err)
	}
	v, err = s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret, AdmissionContext{})
	if err != nil || v.LinkState != InviteLinkRevoked || !v.Expired {
		t.Fatalf("revoked link: %+v %v", v, err)
	}
}

func TestMeetingLinkResolveReportsExhaustedExceptToAdmittedGuest(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Full")
	if err != nil {
		t.Fatal(err)
	}
	one := int32(1)
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "one", LinkAutoAdmit, time.Now().Add(time.Hour), &one)
	if err != nil {
		t.Fatal(err)
	}
	guestID := util.NewID()
	if _, err := s.q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Evaluate(ctx, AdmissionContext{
		MeetingID: m.ID, GuestID: guestID, DisplayName: "First",
		InviteLinkID: created.Link.ID, InviteSecret: created.RawSecret,
	}); err != nil {
		t.Fatalf("first guest: %v", err)
	}
	v, err := s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret, AdmissionContext{GuestID: util.NewID()})
	if err != nil || v.LinkState != InviteLinkExhausted || v.Expired {
		t.Fatalf("stranger on a spent link: %+v %v", v, err)
	}
	v, err = s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret, AdmissionContext{GuestID: guestID})
	if err != nil || v.LinkState != InviteLinkActive {
		t.Fatalf("admitted guest coming back: %+v %v", v, err)
	}
}

func TestMeetingLinkResolveReportsMeetingState(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)

	canceled, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "C", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	cl, err := s.CreateInviteLink(ctx, ua.ID, canceled.ID, "c", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Cancel(ctx, ua.ID, canceled.ID, "x"); err != nil {
		t.Fatal(err)
	}
	v, err := s.ResolveInviteLink(ctx, cl.Link.ID, cl.RawSecret, AdmissionContext{})
	if err != nil || v.MeetingState != InviteMeetingCanceled {
		t.Fatalf("canceled meeting: %+v %v", v, err)
	}

	ended, err := s.CreateInstant(ctx, ua.ID, w.ID, "E")
	if err != nil {
		t.Fatal(err)
	}
	el, err := s.CreateInviteLink(ctx, ua.ID, ended.ID, "e", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.End(ctx, ua.ID, ended.ID); err != nil {
		t.Fatal(err)
	}
	v, err = s.ResolveInviteLink(ctx, el.Link.ID, el.RawSecret, AdmissionContext{})
	if err != nil || v.MeetingState != InviteMeetingEnded {
		t.Fatalf("ended meeting: %+v %v", v, err)
	}
}
