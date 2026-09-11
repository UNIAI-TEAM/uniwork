package meetings

import (
	"context"
	"time"
)

// FakeProvider is an in-memory ConferenceProvider for tests. It never talks
// to LiveKit and never issues a real media JWT.
type FakeProvider struct {
	EnsureCalls int
	RemoveCalls int
	UpdateCalls int
	EndCalls    int
	LastRemove  RemoveProviderParticipantRequest
	LastUpdate  UpdateProviderParticipantRequest
	LastEnd     EndProviderSessionRequest
	EnsureErr   error
	RemoveErr   error
	EndErr      error
	JoinErr     error
	ServerURL   string
	// RecordingEnabled flips the Recording capability on; StartRecording
	// then returns a deterministic id.
	RecordingEnabled bool
	RecordCalls      int
	StopRecordCalls  int
}

func (f *FakeProvider) Key() string { return "fake" }

func (f *FakeProvider) Capabilities(context.Context) ConferenceCapabilities {
	return ConferenceCapabilities{
		TokenizedJoin: true, RemoveParticipant: true, UpdateParticipantPermissions: true,
		Webhooks: true, DataChannel: true, Recording: f.RecordingEnabled,
	}
}

func (f *FakeProvider) EnsureSession(_ context.Context, req EnsureSessionRequest) (ProviderSessionRef, error) {
	f.EnsureCalls++
	if f.EnsureErr != nil {
		return ProviderSessionRef{}, f.EnsureErr
	}
	return ProviderSessionRef{RoomName: req.RoomName, RoomSID: "fake-sid"}, nil
}

func (f *FakeProvider) IssueJoinCredential(_ context.Context, req IssueJoinCredentialRequest) (JoinCredential, error) {
	if f.JoinErr != nil {
		return JoinCredential{}, f.JoinErr
	}
	url := f.ServerURL
	if url == "" {
		url = "wss://fake.livekit.local"
	}
	ttl := req.TTL
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	return JoinCredential{
		Token:     "fake." + req.Identity,
		ExpiresAt: time.Now().Add(ttl),
		ServerURL: url,
	}, nil
}

func (f *FakeProvider) RemoveParticipant(_ context.Context, req RemoveProviderParticipantRequest) error {
	f.RemoveCalls++
	f.LastRemove = req
	return f.RemoveErr
}

func (f *FakeProvider) UpdateParticipant(_ context.Context, req UpdateProviderParticipantRequest) error {
	f.UpdateCalls++
	f.LastUpdate = req
	return nil
}

func (f *FakeProvider) EndSession(_ context.Context, req EndProviderSessionRequest) error {
	f.EndCalls++
	f.LastEnd = req
	return f.EndErr
}

func (f *FakeProvider) StartRecording(_ context.Context, req StartRecordingRequest) (RecordingRef, error) {
	f.RecordCalls++
	return RecordingRef{RecordingID: "fake-egress-" + req.RoomName}, nil
}

func (f *FakeProvider) StopRecording(context.Context, StopRecordingRequest) error {
	f.StopRecordCalls++
	return nil
}
