package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/meetings"
)

func TestSetParticipantPublish(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Mute")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	dec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ub.ID})
	if err != nil || dec.Decision != DecisionAdmit {
		t.Fatalf("join: %+v %v", dec, err)
	}
	fp := s.provider.(*meetings.FakeProvider)

	if err := s.SetParticipantPublish(ctx, ua.ID, m.ID, dec.Participant.ID, false); err != nil {
		t.Fatal(err)
	}
	if fp.UpdateCalls != 1 || fp.LastUpdate.CanPublish == nil || *fp.LastUpdate.CanPublish {
		t.Fatalf("expected revoke publish, got %+v", fp.LastUpdate)
	}

	if err := s.SetParticipantPublish(ctx, ua.ID, m.ID, dec.Participant.ID, true); err != nil {
		t.Fatal(err)
	}
	if fp.UpdateCalls != 2 || fp.LastUpdate.CanPublish == nil || !*fp.LastUpdate.CanPublish {
		t.Fatalf("expected grant publish, got %+v", fp.LastUpdate)
	}

	hostDec, err := s.Join(ctx, AdmissionContext{MeetingID: m.ID, UserID: ua.ID})
	if err != nil || hostDec.Decision != DecisionAdmit {
		t.Fatalf("host join: %+v %v", hostDec, err)
	}
	hostErr := s.SetParticipantPublish(ctx, ua.ID, m.ID, hostDec.Participant.ID, false)
	if hostErr == nil {
		t.Fatal("expected cannot mute host")
	}
	var ce CodedError
	if !errors.As(hostErr, &ce) || ce.Code != "cannot_mute_host" {
		t.Fatalf("expected cannot_mute_host, got %v", hostErr)
	}
}
