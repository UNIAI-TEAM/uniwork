package meetings

import (
	"context"
	"strconv"
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
	// Scribe dispatches, guarded by scribeMu: the sweep and Start may race.
	scribeMu          sync.Mutex
	ScribeDispatches  []DispatchScribeRequest
	ScribeRemovals    []RemoveScribeRequest
	ScribeDispatchErr error
	// Dial-in rules, guarded by scribeMu like the dispatches: DialInRules
	// holds the live ones by id, DialInRuleErr fails the next creates.
	DialInRules   map[string]DialInRuleRequest
	DialInCreates int
	DialInDeletes []string
	DialInRuleErr error
	// Updates keeps every UpdateParticipant call in order.
	Updates []UpdateProviderParticipantRequest
	// Removed keeps every RemoveParticipant call in order.
	Removed []RemoveProviderParticipantRequest
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
	f.permMu.Lock()
	defer f.permMu.Unlock()
	f.RemoveCalls++
	f.LastRemove = req
	f.Removed = append(f.Removed, req)
	return f.RemoveErr
}

func (f *FakeProvider) UpdateParticipant(_ context.Context, req UpdateProviderParticipantRequest) error {
	f.permMu.Lock()
	defer f.permMu.Unlock()
	f.UpdateCalls++
	f.LastUpdate = req
	f.Updates = append(f.Updates, req)
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

func (f *FakeProvider) DispatchScribe(_ context.Context, req DispatchScribeRequest) (string, error) {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	if f.ScribeDispatchErr != nil {
		return "", f.ScribeDispatchErr
	}
	f.ScribeDispatches = append(f.ScribeDispatches, req)
	return "fake-dispatch-" + strconv.Itoa(len(f.ScribeDispatches)), nil
}

func (f *FakeProvider) RemoveScribe(_ context.Context, req RemoveScribeRequest) error {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	f.ScribeRemovals = append(f.ScribeRemovals, req)
	return nil
}

// ScribeCalls reports how many dispatches and removals the fake saw.
func (f *FakeProvider) ScribeCalls() (dispatches, removals int) {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	return len(f.ScribeDispatches), len(f.ScribeRemovals)
}

// LastScribeDispatch is the latest dispatch request, zero when none.
func (f *FakeProvider) LastScribeDispatch() DispatchScribeRequest {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	if len(f.ScribeDispatches) == 0 {
		return DispatchScribeRequest{}
	}
	return f.ScribeDispatches[len(f.ScribeDispatches)-1]
}

func (f *FakeProvider) CreateDialInRule(_ context.Context, req DialInRuleRequest) (string, error) {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	if f.DialInRuleErr != nil {
		return "", f.DialInRuleErr
	}
	f.DialInCreates++
	if f.DialInRules == nil {
		f.DialInRules = map[string]DialInRuleRequest{}
	}
	id := "SDR_fake_" + strconv.Itoa(f.DialInCreates)
	f.DialInRules[id] = req
	return id, nil
}

func (f *FakeProvider) DeleteDialInRule(_ context.Context, ruleID string) error {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	f.DialInDeletes = append(f.DialInDeletes, ruleID)
	delete(f.DialInRules, ruleID)
	return nil
}

// LiveDialInRules is a copy of the rules created and not deleted.
func (f *FakeProvider) LiveDialInRules() map[string]DialInRuleRequest {
	f.scribeMu.Lock()
	defer f.scribeMu.Unlock()
	out := make(map[string]DialInRuleRequest, len(f.DialInRules))
	for k, v := range f.DialInRules {
		out[k] = v
	}
	return out
}

// Snapshot copies the participant calls, safe against a concurrent caller.
func (f *FakeProvider) Snapshot() (updates []UpdateProviderParticipantRequest, removed []RemoveProviderParticipantRequest) {
	f.permMu.Lock()
	defer f.permMu.Unlock()
	return append([]UpdateProviderParticipantRequest(nil), f.Updates...), append([]RemoveProviderParticipantRequest(nil), f.Removed...)
}
