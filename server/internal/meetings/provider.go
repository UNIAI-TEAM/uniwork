package meetings

import (
	"context"
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
	// SetParticipantAttributes writes server-owned attributes on a
	// participant in the room (an empty value deletes one) and leaves its
	// permissions alone.
	SetParticipantAttributes(ctx context.Context, req SetParticipantAttributesRequest) error
}

// ScribeIdentity is the LiveKit identity the scribe agent joins with. It is
// not uw_participant_, so attendance never counts it.
const ScribeIdentity = "uw_agent_scribe"

// AttrSharedMic marks the participant whose microphone is the room's shared
// one (spec §4.3): the scribe diarizes that track. Only the server sets it,
// through SetParticipantAttributes and the join token (D11).
const AttrSharedMic = "uw.shared_mic"

// AttrCaptionLang is the caption language a participant picked (spec §5.3):
// vi or en, absent for the original. Only the server sets it (D11); the
// scribe translates for it.
const AttrCaptionLang = "uw.caption_lang"

type SetParticipantAttributesRequest struct {
	RoomName   string
	Identity   string
	Attributes map[string]string
}

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
	// Attributes are set by the server in the token; the token never grants
	// canUpdateOwnMetadata, so the participant cannot change them.
	Attributes map[string]string
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
type UpdateProviderParticipantRequest struct {
	RoomName    string
	Identity    string
	Permissions MediaPermissions
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
