package meetings

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestFakeProviderCoversConferenceSurface(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	fp := &FakeProvider{RecordingEnabled: true, ServerURL: "wss://custom.example"}

	if fp.Key() != "fake" {
		t.Fatalf("Key=%q", fp.Key())
	}
	caps := fp.Capabilities(ctx)
	if !caps.TokenizedJoin || !caps.Recording {
		t.Fatalf("capabilities %+v", caps)
	}

	ref, err := fp.EnsureSession(ctx, EnsureSessionRequest{RoomName: "uw_mtg_1"})
	if err != nil || ref.RoomName != "uw_mtg_1" || ref.RoomSID != "fake-sid" || fp.EnsureCalls != 1 {
		t.Fatalf("EnsureSession %+v %v calls=%d", ref, err, fp.EnsureCalls)
	}
	fp.EnsureErr = errors.New("ensure boom")
	if _, err := fp.EnsureSession(ctx, EnsureSessionRequest{RoomName: "x"}); err == nil {
		t.Fatal("expected EnsureErr")
	}

	cred, err := fp.IssueJoinCredential(ctx, IssueJoinCredentialRequest{Identity: "u1", TTL: time.Minute})
	if err != nil || cred.Token != "fake.u1" || cred.ServerURL != "wss://custom.example" {
		t.Fatalf("IssueJoinCredential %+v %v", cred, err)
	}
	fp.ServerURL = ""
	cred, err = fp.IssueJoinCredential(ctx, IssueJoinCredentialRequest{Identity: "u2", TTL: 0})
	if err != nil || cred.ServerURL != "wss://fake.livekit.local" {
		t.Fatalf("default server URL %+v %v", cred, err)
	}
	fp.JoinErr = errors.New("join boom")
	if _, err := fp.IssueJoinCredential(ctx, IssueJoinCredentialRequest{Identity: "u3"}); err == nil {
		t.Fatal("expected JoinErr")
	}

	if err := fp.RemoveParticipant(ctx, RemoveProviderParticipantRequest{RoomName: "r", Identity: "u"}); err != nil {
		t.Fatal(err)
	}
	if fp.RemoveCalls != 1 || fp.LastRemove.Identity != "u" {
		t.Fatalf("RemoveParticipant calls=%d last=%+v", fp.RemoveCalls, fp.LastRemove)
	}
	fp.RemoveErr = errors.New("remove boom")
	if err := fp.RemoveParticipant(ctx, RemoveProviderParticipantRequest{}); err == nil {
		t.Fatal("expected RemoveErr")
	}

	if err := fp.UpdateParticipant(ctx, UpdateProviderParticipantRequest{RoomName: "r", Identity: "u"}); err != nil {
		t.Fatal(err)
	}
	if fp.UpdateCalls != 1 || fp.LastUpdate.Identity != "u" {
		t.Fatalf("UpdateParticipant calls=%d last=%+v", fp.UpdateCalls, fp.LastUpdate)
	}

	if err := fp.EndSession(ctx, EndProviderSessionRequest{RoomName: "r"}); err != nil {
		t.Fatal(err)
	}
	if fp.EndCalls != 1 || fp.LastEnd.RoomName != "r" {
		t.Fatalf("EndSession calls=%d last=%+v", fp.EndCalls, fp.LastEnd)
	}
	fp.EndErr = errors.New("end boom")
	if err := fp.EndSession(ctx, EndProviderSessionRequest{}); err == nil {
		t.Fatal("expected EndErr")
	}

	rec, err := fp.StartRecording(ctx, StartRecordingRequest{RoomName: "room-a"})
	if err != nil || rec.RecordingID != "fake-egress-room-a" || fp.RecordCalls != 1 {
		t.Fatalf("StartRecording %+v %v calls=%d", rec, err, fp.RecordCalls)
	}
	if err := fp.StopRecording(ctx, StopRecordingRequest{}); err != nil || fp.StopRecordCalls != 1 {
		t.Fatalf("StopRecording %v calls=%d", err, fp.StopRecordCalls)
	}
}
