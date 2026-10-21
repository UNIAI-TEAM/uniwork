package meetings

import (
	"context"
	"errors"
	"time"
)

// ConferenceProvider is the media-plane port. UniWork never treats provider
// room state as the source of truth for meeting lifecycle, host, or access.
type ConferenceProvider interface {
	Key() string
	Capabilities(ctx context.Context) ConferenceCapabilities
	EnsureSession(ctx context.Context, req EnsureSessionRequest) (ProviderSessionRef, error)
	IssueJoinCredential(ctx context.Context, req IssueJoinCredentialRequest) (JoinCredential, error)
	RemoveParticipant(ctx context.Context, req RemoveProviderParticipantRequest) error
	UpdateParticipant(ctx context.Context, req UpdateProviderParticipantRequest) error
	GetParticipantPermissions(ctx context.Context, req GetProviderParticipantRequest) (MediaPermissions, error)
	EndSession(ctx context.Context, req EndProviderSessionRequest) error
	StartRecording(ctx context.Context, req StartRecordingRequest) (RecordingRef, error)
	StopRecording(ctx context.Context, req StopRecordingRequest) error
	// DispatchScribe asks the provider to send the named agent into the room
	// (spec 2026-10-20-meeting-scribe-agent-design §4.1) and returns the
	// dispatch id; RemoveScribe cancels that dispatch and removes the agent.
	DispatchScribe(ctx context.Context, req DispatchScribeRequest) (string, error)
	RemoveScribe(ctx context.Context, req RemoveScribeRequest) error
	// CreateDialInRule routes callers who enter req.Pin into the room (spec
	// 2026-10-20-meeting-scribe-agent-design §5.4) and returns the rule id;
	// DeleteDialInRule removes it, a rule already gone included.
	CreateDialInRule(ctx context.Context, req DialInRuleRequest) (string, error)
	DeleteDialInRule(ctx context.Context, ruleID string) error
	// ListDialInRules lists the SIP dispatch rules (on the UniWork trunk when
	// one is set), so the sweep can find rules no meeting points at.
	ListDialInRules(ctx context.Context) ([]DialInRule, error)
	// ListParticipants lists who is connected to a room right now.
	ListParticipants(ctx context.Context, roomName string) ([]ProviderParticipant, error)
}

// ErrDialInRuleConflict: the provider refused the rule because another one
// already routes the same PIN on the trunk.
var ErrDialInRuleConflict = errors.New("dial-in rule conflicts with an existing rule")

// DialInRule is one SIP dispatch rule as the provider lists it; CreatedAt is
// zero when the provider does not say.
type DialInRule struct {
	ID        string
	Name      string
	CreatedAt time.Time
}

// ProviderParticipant is one live connection in a room. SIP marks a phone
// caller.
type ProviderParticipant struct {
	Identity    string
	SID         string
	Name        string
	SIP         bool
	Attributes  map[string]string
	Permissions MediaPermissions
}

// DialInRuleRequest is one PIN-gated route from the phone network into a
// room. TrunkID, when set, keeps the rule to the UniWork trunk: the LiveKit
// server is shared with lms-core.
type DialInRuleRequest struct {
	RoomName string
	Pin      string
	TrunkID  string
	Name     string
}

// ScribeIdentity is the LiveKit identity the scribe agent joins with. It is
// not uw_participant_, so attendance never counts it.
const ScribeIdentity = "uw_agent_scribe"

// DispatchScribeRequest carries the job metadata the agent validates
// (meeting id, token, locale); LiveKit caps it at 512 KiB.
type DispatchScribeRequest struct {
	RoomName  string
	AgentName string
	Metadata  string
}

type RemoveScribeRequest struct {
	RoomName   string
	DispatchID string
}

type ConferenceCapabilities struct {
	TokenizedJoin                bool
	RemoveParticipant            bool
	UpdateParticipantPermissions bool
	Webhooks                     bool
	Recording                    bool
	Transcription                bool
	DataChannel                  bool
}

type EnsureSessionRequest struct {
	MeetingID       string
	RoomName        string
	EmptyTimeout    time.Duration
	MaxParticipants uint32
}

type ProviderSessionRef struct {
	RoomName string
	RoomSID  string
}

type IssueJoinCredentialRequest struct {
	RoomName       string
	Identity       string
	DisplayName    string
	TTL            time.Duration
	CanSubscribe   bool
	CanPublish     bool
	CanPublishData bool
}

type JoinCredential struct {
	Token     string
	ExpiresAt time.Time
	ServerURL string
}

type RemoveProviderParticipantRequest struct {
	RoomName string
	Identity string
}

// UpdateProviderParticipantRequest sets a participant's whole permission set:
// providers replace it rather than merge, so every grant is spelled out.
// Name, when set, renames the participant; Attributes are merged into theirs
// (an empty value removes the key).
type UpdateProviderParticipantRequest struct {
	RoomName    string
	Identity    string
	Permissions MediaPermissions
	Name        string
	Attributes  map[string]string
}

// GetProviderParticipantRequest names a participant whose current
// permissions are read back. Locks live only on the provider, so changing one
// source reads the other's lock here first.
type GetProviderParticipantRequest struct {
	RoomName string
	Identity string
}

type EndProviderSessionRequest struct {
	RoomName string
}

// StartRecordingRequest asks the provider to record the whole room.
// FilePrefix is the object key prefix (no extension); the provider appends
// its own file name. Layout defaults to "speaker" when empty.
type StartRecordingRequest struct {
	RoomName   string
	FilePrefix string
	Layout     string
	// OutputTarget, when set, is the write target the storage layer reserved
	// for this recording (FileService provider output). The provider writes
	// exactly that object and FilePrefix is ignored; nil keeps the
	// provider-owned path. It mirrors files.WriteTarget without importing the
	// contract package — the arch test forbids internal/meetings importing
	// internal/files.
	OutputTarget *RecordingOutputTarget
}

// RecordingOutputTarget is the provider-facing view of a FileService write
// target: one object, one deadline, issued by the server. The provider never
// derives an object key from a webhook or event payload.
type RecordingOutputTarget struct {
	URL       string
	Method    string
	Headers   map[string]string
	ExpiresAt time.Time
}

type RecordingRef struct {
	RecordingID string
}

type StopRecordingRequest struct {
	RecordingID string
}

func RoomNameForMeeting(meetingID string) string {
	return "uw_mtg_" + meetingID
}

func IdentityForParticipant(participantID string) string {
	return "uw_participant_" + participantID
}
