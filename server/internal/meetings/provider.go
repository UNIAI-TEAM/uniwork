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
	EndSession(ctx context.Context, req EndProviderSessionRequest) error
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

type UpdateProviderParticipantRequest struct {
	RoomName   string
	Identity   string
	CanPublish *bool
}

type EndProviderSessionRequest struct {
	RoomName string
}

func RoomNameForMeeting(meetingID string) string {
	return "uw_mtg_" + meetingID
}

func IdentityForParticipant(participantID string) string {
	return "uw_participant_" + participantID
}
