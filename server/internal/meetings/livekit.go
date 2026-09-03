package meetings

import (
	"context"
	"fmt"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

func MintToken(apiKey, apiSecret, room, identity, name string, ttl time.Duration) (string, error) {
	return mintToken(apiKey, apiSecret, IssueJoinCredentialRequest{
		RoomName: room, Identity: identity, DisplayName: name, TTL: ttl,
		CanSubscribe: true, CanPublish: true, CanPublishData: true,
	})
}

// MintChatVoiceToken issues a LiveKit JWT for native chat voice/video without data channels.
func MintChatVoiceToken(apiKey, apiSecret, room, identity, name string, ttl time.Duration) (string, error) {
	return mintToken(apiKey, apiSecret, IssueJoinCredentialRequest{
		RoomName: room, Identity: identity, DisplayName: name, TTL: ttl,
		CanSubscribe: true, CanPublish: true, CanPublishData: false,
	})
}

func mintToken(apiKey, apiSecret string, req IssueJoinCredentialRequest) (string, error) {
	at := auth.NewAccessToken(apiKey, apiSecret)
	canSub, canPub, canData := req.CanSubscribe, req.CanPublish, req.CanPublishData
	grant := &auth.VideoGrant{
		RoomJoin: true, Room: req.RoomName,
		CanSubscribe: &canSub, CanPublish: &canPub, CanPublishData: &canData,
	}
	ttl := req.TTL
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	at.SetVideoGrant(grant).SetIdentity(req.Identity).SetName(req.DisplayName).SetValidFor(ttl)
	return at.ToJWT()
}

// LiveKitAdapter implements ConferenceProvider. LiveKit protobuf types stay here.
type LiveKitAdapter struct {
	URL, APIKey, APISecret string
	TokenTTL               time.Duration
	EmptyTimeout           time.Duration
	// Recording is nil when no S3 bucket is configured; recording is then
	// reported as unavailable instead of failing at start time.
	Recording *RecordingS3
}

// RecordingS3 is where LiveKit Egress uploads room composite recordings.
type RecordingS3 struct {
	AccessKey, Secret, Region, Endpoint, Bucket string
}

func (a *LiveKitAdapter) Key() string { return "livekit" }

func (a *LiveKitAdapter) Capabilities(context.Context) ConferenceCapabilities {
	return ConferenceCapabilities{
		TokenizedJoin: true, RemoveParticipant: true, UpdateParticipantPermissions: true,
		Webhooks: true, DataChannel: true, Recording: a.Recording != nil && a.Recording.Bucket != "",
	}
}

func (a *LiveKitAdapter) client() *lksdk.RoomServiceClient {
	return lksdk.NewRoomServiceClient(a.URL, a.APIKey, a.APISecret)
}

func (a *LiveKitAdapter) EnsureSession(ctx context.Context, req EnsureSessionRequest) (ProviderSessionRef, error) {
	empty := uint32(req.EmptyTimeout.Seconds())
	if empty == 0 {
		empty = uint32(a.EmptyTimeout.Seconds())
	}
	if empty == 0 {
		empty = 300
	}
	res, err := a.client().CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name: req.RoomName, EmptyTimeout: empty, MaxParticipants: req.MaxParticipants,
	})
	if err != nil {
		// Idempotent: a room that already exists is fine.
		rooms, listErr := a.client().ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{req.RoomName}})
		if listErr == nil && len(rooms.GetRooms()) > 0 {
			r := rooms.Rooms[0]
			return ProviderSessionRef{RoomName: r.Name, RoomSID: r.Sid}, nil
		}
		return ProviderSessionRef{}, fmt.Errorf("livekit ensure session: %w", err)
	}
	return ProviderSessionRef{RoomName: res.Name, RoomSID: res.Sid}, nil
}

func (a *LiveKitAdapter) IssueJoinCredential(_ context.Context, req IssueJoinCredentialRequest) (JoinCredential, error) {
	ttl := req.TTL
	if ttl <= 0 {
		ttl = a.TokenTTL
	}
	if ttl <= 0 {
		ttl = 2 * time.Minute
	}
	req.TTL = ttl
	tok, err := mintToken(a.APIKey, a.APISecret, req)
	if err != nil {
		return JoinCredential{}, err
	}
	return JoinCredential{Token: tok, ExpiresAt: time.Now().Add(ttl), ServerURL: a.URL}, nil
}

func (a *LiveKitAdapter) RemoveParticipant(ctx context.Context, req RemoveProviderParticipantRequest) error {
	_, err := a.client().RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{Room: req.RoomName, Identity: req.Identity})
	return err
}

func (a *LiveKitAdapter) UpdateParticipant(ctx context.Context, req UpdateProviderParticipantRequest) error {
	perm := &livekit.ParticipantPermission{}
	if req.CanPublish != nil {
		perm.CanPublish = *req.CanPublish
	}
	_, err := a.client().UpdateParticipant(ctx, &livekit.UpdateParticipantRequest{
		Room: req.RoomName, Identity: req.Identity, Permission: perm,
	})
	return err
}

func (a *LiveKitAdapter) EndSession(ctx context.Context, req EndProviderSessionRequest) error {
	_, err := a.client().DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: req.RoomName})
	return err
}

func (a *LiveKitAdapter) egress() *lksdk.EgressClient {
	return lksdk.NewEgressClient(a.URL, a.APIKey, a.APISecret)
}

func (a *LiveKitAdapter) StartRecording(ctx context.Context, req StartRecordingRequest) (RecordingRef, error) {
	if a.Recording == nil || a.Recording.Bucket == "" {
		return RecordingRef{}, fmt.Errorf("livekit recording: no S3 bucket configured")
	}
	info, err := a.egress().StartRoomCompositeEgress(ctx, &livekit.RoomCompositeEgressRequest{
		RoomName: req.RoomName,
		Layout:   "speaker",
		FileOutputs: []*livekit.EncodedFileOutput{{
			FileType: livekit.EncodedFileType_MP4,
			Filepath: req.FilePrefix + "-{time}.mp4",
			Output: &livekit.EncodedFileOutput_S3{S3: &livekit.S3Upload{
				AccessKey: a.Recording.AccessKey, Secret: a.Recording.Secret, Region: a.Recording.Region,
				Endpoint: a.Recording.Endpoint, Bucket: a.Recording.Bucket, ForcePathStyle: a.Recording.Endpoint != "",
			}},
		}},
	})
	if err != nil {
		return RecordingRef{}, fmt.Errorf("livekit start recording: %w", err)
	}
	return RecordingRef{RecordingID: info.EgressId}, nil
}

func (a *LiveKitAdapter) StopRecording(ctx context.Context, req StopRecordingRequest) error {
	_, err := a.egress().StopEgress(ctx, &livekit.StopEgressRequest{EgressId: req.RecordingID})
	return err
}
