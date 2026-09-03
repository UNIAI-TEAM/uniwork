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

// controlPlaneEmptyTimeoutSeconds is used when EmptyTimeout is unset (0).
// LiveKit must not auto-close rooms; UniWork EndMeeting owns lifecycle.
const controlPlaneEmptyTimeoutSeconds uint32 = 86400

// LiveKitAdapter implements ConferenceProvider. LiveKit protobuf types stay here.
type LiveKitAdapter struct {
	URL, APIKey, APISecret string
	TokenTTL               time.Duration
	EmptyTimeout           time.Duration
	roomClient             *lksdk.RoomServiceClient
}

func (a *LiveKitAdapter) Key() string { return "livekit" }

func (a *LiveKitAdapter) Capabilities(context.Context) ConferenceCapabilities {
	return ConferenceCapabilities{
		TokenizedJoin: true, RemoveParticipant: true, UpdateParticipantPermissions: true,
		Webhooks: true, DataChannel: true,
	}
}

func (a *LiveKitAdapter) client() *lksdk.RoomServiceClient {
	if a.roomClient != nil {
		return a.roomClient
	}
	a.roomClient = lksdk.NewRoomServiceClient(a.URL, a.APIKey, a.APISecret)
	return a.roomClient
}

func roomEmptyTimeoutSeconds(requested, adapterDefault time.Duration) uint32 {
	if requested > 0 {
		return uint32(requested.Seconds())
	}
	if adapterDefault > 0 {
		return uint32(adapterDefault.Seconds())
	}
	return controlPlaneEmptyTimeoutSeconds
}

func (a *LiveKitAdapter) EnsureSession(ctx context.Context, req EnsureSessionRequest) (ProviderSessionRef, error) {
	empty := roomEmptyTimeoutSeconds(req.EmptyTimeout, a.EmptyTimeout)
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
