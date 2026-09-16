package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func chatVoiceRecordingFixture(t *testing.T) (*ChatService, *meetings.FakeProvider, *db.Queries, db.User, db.User, db.Workspace) {
	t.Helper()
	s, _, q, ua, ub, w := chatFixture(t)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	fp := &meetings.FakeProvider{RecordingEnabled: true}
	s.SetConference(fp)
	return s, fp, q, ua, ub, w
}

func acceptDMVoiceCall(
	t *testing.T, s *ChatService, ua, ub db.User, w db.Workspace, roomID, callID string,
) {
	t.Helper()
	ctx := context.Background()
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, roomID, callID); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, roomID, callID); err != nil {
		t.Fatalf("accept: %v", err)
	}
}

func TestChatVoiceRecordingLifecycle(t *testing.T) {
	s, fp, _, ua, ub, w := chatVoiceRecordingFixture(t)
	ctx := context.Background()
	if !s.VoiceRecordingEnabled(ctx) {
		t.Fatal("recording should be enabled with fake provider")
	}

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "rec-call-1"
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, callID)

	rec, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil || rec.EgressID == "" || fp.RecordCalls != 1 {
		t.Fatalf("start: %+v err=%v calls=%d", rec, err, fp.RecordCalls)
	}

	again, err := s.StartVoiceRecording(ctx, ub.ID, w.ID, dm.ID, callID)
	if err != nil || again.ID != rec.ID {
		t.Fatalf("idempotent start: %+v err=%v", again, err)
	}

	active, err := s.ActiveVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil || active.ID != rec.ID {
		t.Fatalf("active: %+v err=%v", active, err)
	}

	list, err := s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || len(list) != 1 || list[0].ID != rec.ID {
		t.Fatalf("list: %+v err=%v", list, err)
	}

	stopped, err := s.StopVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil || stopped.Status != RecordingProcessing || fp.StopRecordCalls != 1 {
		t.Fatalf("stop: %+v err=%v stopCalls=%d", stopped, err, fp.StopRecordCalls)
	}

	var ce CodedError
	if _, err := s.GetVoiceRecordingForPlayback(ctx, ua.ID, w.ID, dm.ID, rec.ID); !errors.As(err, &ce) || ce.Code != "recording_not_ready" {
		t.Fatalf("playback before complete: %v", err)
	}

	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type:         "conference.recording_ended",
		RecordingID:  rec.EgressID,
		RecordingURL: "https://bucket/chat-voice.mp4",
	})
	playback, err := s.GetVoiceRecordingForPlayback(ctx, ua.ID, w.ID, dm.ID, rec.ID)
	if err != nil || playback.FileUrl.String != "https://bucket/chat-voice.mp4" {
		t.Fatalf("playback: %+v err=%v", playback, err)
	}
}

func TestChatVoiceRecordingHangupStopsEgress(t *testing.T) {
	s, fp, _, ua, ub, w := chatVoiceRecordingFixture(t)
	ctx := context.Background()

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "rec-call-hangup"
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, callID)

	rec, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	duration := 12
	if err := s.SignalVoiceHangup(ctx, ub.ID, w.ID, dm.ID, callID, &duration); err != nil {
		t.Fatalf("hangup: %v", err)
	}
	if fp.StopRecordCalls != 1 {
		t.Fatalf("stop calls = %d", fp.StopRecordCalls)
	}

	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type:         "conference.recording_ended",
		RecordingID:  rec.EgressID,
		RecordingURL: "https://bucket/chat-voice-hangup.mp4",
	})
	msgs, err := s.ListRoomMessages(ctx, ua.ID, w.ID, dm.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, msg := range msgs {
		if msg.Kind != "voice_call_log" {
			continue
		}
		found = true
		if msg.VoiceCall == nil || msg.VoiceCall.RecordingID != rec.ID {
			t.Fatalf("call log recording: %+v", msg.VoiceCall)
		}
		if msg.VoiceCall.RecordingURL != "https://bucket/chat-voice-hangup.mp4" {
			t.Fatalf("recording url not patched: %+v", msg.VoiceCall)
		}
	}
	if !found {
		t.Fatal("voice call log missing")
	}
}

func TestChatVoiceRecordingGuards(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "rec-guards"

	var ce CodedError
	if _, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, ""); err == nil {
		t.Fatal("empty call_id accepted")
	}
	if _, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); !errors.As(err, &ce) || ce.Code != "recording_not_configured" {
		t.Fatalf("unconfigured: %v", err)
	}

	fp := &meetings.FakeProvider{RecordingEnabled: true}
	s.SetConference(fp)
	if err := s.SignalVoiceInvite(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("invite: %v", err)
	}
	if _, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); !errors.As(err, &ce) || ce.Code != "call_not_connected" {
		t.Fatalf("before accept: %v", err)
	}
	if err := s.SignalVoiceAccept(ctx, ub.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if _, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := s.StopVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if _, err := s.StopVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); !errors.As(err, &ce) || ce.Code != "recording_not_active" {
		t.Fatalf("double stop: %v", err)
	}
	if _, err := s.ActiveVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("active after stop: %v", err)
	}
	if _, err := s.GetVoiceRecordingForPlayback(ctx, ua.ID, w.ID, dm.ID, "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing playback: %v", err)
	}
}

func TestFinishVoiceRecordingByEgressFailed(t *testing.T) {
	s, _, _, ua, ub, w := chatVoiceRecordingFixture(t)
	ctx := context.Background()

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("resolve dm: %v", err)
	}
	callID := "rec-failed"
	acceptDMVoiceCall(t, s, ua, ub, w, dm.ID, callID)

	rec, err := s.StartVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if _, err := s.StopVoiceRecording(ctx, ua.ID, w.ID, dm.ID, callID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	var ce CodedError
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{
		Type:            "conference.recording_ended",
		RecordingID:     rec.EgressID,
		RecordingFailed: true,
	})
	rows, err := s.ListVoiceRecordings(ctx, ua.ID, w.ID, dm.ID, 10)
	if err != nil || len(rows) != 1 || rows[0].Status != RecordingFailed {
		t.Fatalf("rows: %+v err=%v", rows, err)
	}
	if _, err := s.GetVoiceRecordingForPlayback(ctx, ua.ID, w.ID, dm.ID, rec.ID); !errors.As(err, &ce) || ce.Code != "recording_not_ready" {
		t.Fatalf("failed recording playback: %v", err)
	}
	// Unknown egress is a no-op.
	s.FinishVoiceRecordingByEgress(ctx, ProviderNeutralEvent{RecordingID: "unknown-egress"})
}
