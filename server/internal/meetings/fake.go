package meetings

import (
	"context"
	"sync"
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
	// LastRecording captures the last StartRecordingRequest so tests can
	// assert the provider was given the FileService write target.
	LastRecording StartRecordingRequest
	// Permissions holds what UpdateParticipant last wrote per room and
	// identity, the way LiveKit keeps it; GetParticipantPermissions reads it.
	// GetPermissionsDelay holds the answer back after the read, so two
	// moderators acting at once both read before either writes.
	Permissions         map[string]MediaPermissions
	GetPermissionsCalls int
	GetPermissionsErr   error
	GetPermissionsDelay time.Duration
	// permMu guards the participant fields above for concurrent moderators.
	permMu sync.Mutex
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
	f.permMu.Lock()
	defer f.permMu.Unlock()
	f.UpdateCalls++
	f.LastUpdate = req
	if f.Permissions == nil {
		f.Permissions = map[string]MediaPermissions{}
	}
	f.Permissions[req.RoomName+"/"+req.Identity] = req.Permissions
	return nil
}

// GetParticipantPermissions answers a participant never updated with no locks,
// like a LiveKit participant still on the grants of their join token. The
// delay gives up when ctx does, like an RPC past its deadline.
func (f *FakeProvider) GetParticipantPermissions(ctx context.Context, req GetProviderParticipantRequest) (MediaPermissions, error) {
	f.permMu.Lock()
	f.GetPermissionsCalls++
	if f.GetPermissionsErr != nil {
		f.permMu.Unlock()
		return MediaPermissions{}, f.GetPermissionsErr
	}
	perms, delay := f.Permissions[req.RoomName+"/"+req.Identity], f.GetPermissionsDelay
	f.permMu.Unlock()
	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return MediaPermissions{}, ctx.Err()
		}
	}
	return perms, nil
}

func (f *FakeProvider) EndSession(_ context.Context, req EndProviderSessionRequest) error {
	f.EndCalls++
	f.LastEnd = req
	return f.EndErr
}

func (f *FakeProvider) StartRecording(_ context.Context, req StartRecordingRequest) (RecordingRef, error) {
	f.RecordCalls++
	f.LastRecording = req
	return RecordingRef{RecordingID: "fake-egress-" + req.RoomName}, nil
}

func (f *FakeProvider) StopRecording(context.Context, StopRecordingRequest) error {
	f.StopRecordCalls++
	return nil
}
