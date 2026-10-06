package meetings

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
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

// controlPlaneEmptyTimeoutSeconds is used when EmptyTimeout is unset (0).
// LiveKit must not auto-close rooms; UniWork EndMeeting owns lifecycle.
const controlPlaneEmptyTimeoutSeconds uint32 = 86400

// Deadlines for one LiveKit RPC. The SDK builds its Twirp clients on a bare
// http.Client{} with no Timeout and no option to replace it, so the bound is
// carried by the context of every call instead. Room-service calls answer in
// milliseconds when LiveKit is healthy; starting egress waits for a recorder
// to launch, so it gets longer.
const (
	defaultRoomRPCTimeout   = 10 * time.Second
	defaultEgressRPCTimeout = 30 * time.Second
)

// LiveKitAdapter implements ConferenceProvider. LiveKit protobuf types stay here.
type LiveKitAdapter struct {
	URL, APIKey, APISecret string
	TokenTTL               time.Duration
	EmptyTimeout           time.Duration
	// RPCTimeout, when positive, replaces the default deadline of every
	// LiveKit RPC (room service and egress alike).
	RPCTimeout time.Duration
	// Recording is nil when no S3 bucket is configured; recording is then
	// reported as unavailable instead of failing at start time.
	Recording *RecordingS3

	// The adapter is shared by every request goroutine, so the clients are
	// built exactly once and reused.
	roomOnce   sync.Once
	roomClient *lksdk.RoomServiceClient
	egressOnce sync.Once
	egressCl   *lksdk.EgressClient
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
	a.roomOnce.Do(func() { a.roomClient = lksdk.NewRoomServiceClient(a.URL, a.APIKey, a.APISecret) })
	return a.roomClient
}

func (a *LiveKitAdapter) egress() *lksdk.EgressClient {
	a.egressOnce.Do(func() { a.egressCl = lksdk.NewEgressClient(a.URL, a.APIKey, a.APISecret) })
	return a.egressCl
}

func (a *LiveKitAdapter) rpcTimeout(def time.Duration) time.Duration {
	if a.RPCTimeout > 0 {
		return a.RPCTimeout
	}
	return def
}

// roomCtx and egressCtx bound one RPC. Each RPC gets its own deadline, so a
// fallback call after a timed-out one is not born already expired.
func (a *LiveKitAdapter) roomCtx(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, a.rpcTimeout(defaultRoomRPCTimeout))
}

func (a *LiveKitAdapter) egressCtx(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, a.rpcTimeout(defaultEgressRPCTimeout))
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
	cctx, cancel := a.roomCtx(ctx)
	res, err := a.client().CreateRoom(cctx, &livekit.CreateRoomRequest{
		Name: req.RoomName, EmptyTimeout: empty, MaxParticipants: req.MaxParticipants,
	})
	cancel()
	if err != nil {
		// Idempotent: a room that already exists is fine.
		lctx, lcancel := a.roomCtx(ctx)
		rooms, listErr := a.client().ListRooms(lctx, &livekit.ListRoomsRequest{Names: []string{req.RoomName}})
		lcancel()
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
	ctx, cancel := a.roomCtx(ctx)
	defer cancel()
	_, err := a.client().RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{Room: req.RoomName, Identity: req.Identity})
	return err
}

func (a *LiveKitAdapter) UpdateParticipant(ctx context.Context, req UpdateProviderParticipantRequest) error {
	ctx, cancel := a.roomCtx(ctx)
	defer cancel()
	_, err := a.client().UpdateParticipant(ctx, &livekit.UpdateParticipantRequest{
		Room: req.RoomName, Identity: req.Identity, Permission: participantPermission(req.Permissions),
	})
	return err
}

func (a *LiveKitAdapter) GetParticipantPermissions(ctx context.Context, req GetProviderParticipantRequest) (MediaPermissions, error) {
	ctx, cancel := a.roomCtx(ctx)
	defer cancel()
	info, err := a.client().GetParticipant(ctx, &livekit.RoomParticipantIdentity{Room: req.RoomName, Identity: req.Identity})
	if err != nil {
		return MediaPermissions{}, err
	}
	return mediaPermissions(info.GetPermission()), nil
}

// participantPermission is the full set LiveKit stores: a field left false
// here is a grant taken away, not one left alone.
func participantPermission(p MediaPermissions) *livekit.ParticipantPermission {
	perm := &livekit.ParticipantPermission{
		CanSubscribe: p.CanSubscribe, CanPublish: p.CanPublish, CanPublishData: p.CanPublishData,
	}
	// An empty source list means every source; a lock lists what is left.
	// Shared-tab audio needs both the voice and the share open, so either lock
	// takes it.
	if p.MicrophoneLocked || p.ScreenShareLocked {
		sources := []livekit.TrackSource{livekit.TrackSource_CAMERA}
		if !p.MicrophoneLocked {
			sources = append(sources, livekit.TrackSource_MICROPHONE)
		}
		if !p.ScreenShareLocked {
			sources = append(sources, livekit.TrackSource_SCREEN_SHARE)
		}
		perm.CanPublishSources = sources
	}
	return perm
}

// mediaPermissions reads back the locks participantPermission wrote: a
// restricted source list without the mic is a locked mic, one without the
// screen share a locked share. A join token sets no list, so no locks.
func mediaPermissions(p *livekit.ParticipantPermission) MediaPermissions {
	m := MediaPermissions{CanSubscribe: p.GetCanSubscribe(), CanPublish: p.GetCanPublish(), CanPublishData: p.GetCanPublishData()}
	if sources := p.GetCanPublishSources(); len(sources) > 0 {
		m.MicrophoneLocked = !slices.Contains(sources, livekit.TrackSource_MICROPHONE)
		m.ScreenShareLocked = !slices.Contains(sources, livekit.TrackSource_SCREEN_SHARE)
	}
	return m
}

func (a *LiveKitAdapter) EndSession(ctx context.Context, req EndProviderSessionRequest) error {
	ctx, cancel := a.roomCtx(ctx)
	defer cancel()
	_, err := a.client().DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: req.RoomName})
	return err
}

func recordingLayout(layout string) string {
	if layout == "" {
		return "speaker"
	}
	return layout
}

// ErrRecordingOutputTarget reports a write target this adapter cannot honor:
// the URL does not point at the configured recording storage, or the object
// key is not one egress can write. The service maps it to
// recording_not_configured — the deployment cannot take provider output.
var ErrRecordingOutputTarget = errors.New("recording output target does not match the configured storage")

// outputTargetKey translates a FileService write target into the egress file
// path: the URL's object key, extracted only after the target is proven to
// point at the configured recording endpoint and bucket. The signature and
// headers in the target authorize a single PUT, which egress cannot make —
// the egress writes the same object with its configured credentials instead.
//
// Egress appends the correct file extension when the path lacks one, so a
// key that does not end in .mp4 would land the bytes outside the reserved
// object; fail here rather than at verification.
func (a *LiveKitAdapter) outputTargetKey(t *RecordingOutputTarget) (string, error) {
	if t.Method != "" && !strings.EqualFold(t.Method, http.MethodPut) {
		return "", fmt.Errorf("%w: unsupported method %q", ErrRecordingOutputTarget, t.Method)
	}
	if !t.ExpiresAt.IsZero() && !t.ExpiresAt.After(time.Now()) {
		return "", fmt.Errorf("%w: target already expired", ErrRecordingOutputTarget)
	}
	u, err := url.Parse(t.URL)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return "", fmt.Errorf("%w: malformed target URL", ErrRecordingOutputTarget)
	}
	bucket := a.Recording.Bucket
	if ep := a.Recording.Endpoint; ep != "" {
		epu, eerr := url.Parse(ep)
		if eerr != nil || epu.Host == "" {
			return "", fmt.Errorf("%w: recording endpoint %q is not a URL", ErrRecordingOutputTarget, ep)
		}
		if u.Host != epu.Host && u.Host != bucket+"."+epu.Host {
			return "", fmt.Errorf("%w: target host %q is not the recording endpoint %q", ErrRecordingOutputTarget, u.Host, epu.Host)
		}
	}
	var key string
	switch {
	case strings.HasPrefix(u.Path, "/"+bucket+"/"):
		// Path-style: /<bucket>/<key>.
		key = u.Path[len(bucket)+2:]
	case strings.HasPrefix(u.Hostname(), bucket+"."):
		// Virtual-hosted: <bucket>.<host>/<key>.
		key = strings.TrimPrefix(u.Path, "/")
	default:
		return "", fmt.Errorf("%w: target %q carries no object under bucket %q", ErrRecordingOutputTarget, u.Host+u.Path, bucket)
	}
	if key == "" {
		return "", fmt.Errorf("%w: empty object key", ErrRecordingOutputTarget)
	}
	if !strings.HasSuffix(key, ".mp4") {
		return "", fmt.Errorf("%w: object key %q lacks .mp4 - egress would write a different object", ErrRecordingOutputTarget, key)
	}
	return key, nil
}

func (a *LiveKitAdapter) StartRecording(ctx context.Context, req StartRecordingRequest) (RecordingRef, error) {
	if a.Recording == nil || a.Recording.Bucket == "" {
		return RecordingRef{}, fmt.Errorf("livekit recording: no S3 bucket configured")
	}
	filepath := req.FilePrefix + "-{time}.mp4"
	if req.OutputTarget != nil {
		key, err := a.outputTargetKey(req.OutputTarget)
		if err != nil {
			return RecordingRef{}, err
		}
		filepath = key
	}
	ctx, cancel := a.egressCtx(ctx)
	defer cancel()
	info, err := a.egress().StartRoomCompositeEgress(ctx, a.roomCompositeRequest(req, filepath))
	if err != nil {
		return RecordingRef{}, fmt.Errorf("livekit start recording: %w", err)
	}
	return RecordingRef{RecordingID: info.EgressId}, nil
}

// roomCompositeRequest records the room at 1920x1080, 30 fps, 4.5 Mbps H.264.
// Without Options egress picks its 1280x720 default, and a shared screen in
// the speaker layout (5/6 of the width) comes out too small to read (UNI-943).
func (a *LiveKitAdapter) roomCompositeRequest(req StartRecordingRequest, filepath string) *livekit.RoomCompositeEgressRequest {
	return &livekit.RoomCompositeEgressRequest{
		RoomName: req.RoomName,
		Layout:   recordingLayout(req.Layout),
		Options:  &livekit.RoomCompositeEgressRequest_Preset{Preset: livekit.EncodingOptionsPreset_H264_1080P_30},
		FileOutputs: []*livekit.EncodedFileOutput{{
			FileType: livekit.EncodedFileType_MP4,
			Filepath: filepath,
			Output: &livekit.EncodedFileOutput_S3{S3: &livekit.S3Upload{
				AccessKey: a.Recording.AccessKey, Secret: a.Recording.Secret, Region: a.Recording.Region,
				Endpoint: a.Recording.Endpoint, Bucket: a.Recording.Bucket, ForcePathStyle: a.Recording.Endpoint != "",
			}},
		}},
	}
}

func (a *LiveKitAdapter) StopRecording(ctx context.Context, req StopRecordingRequest) error {
	ctx, cancel := a.egressCtx(ctx)
	defer cancel()
	_, err := a.egress().StopEgress(ctx, &livekit.StopEgressRequest{EgressId: req.RecordingID})
	return err
}
