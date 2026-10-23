package meetings

import (
	"slices"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/livekit/protocol/livekit"
)

func TestMintChatVoiceTokenDisablesDataChannel(t *testing.T) {
	tok, err := MintChatVoiceToken("api-key", "api-secret-at-least-32-characters!!", "uw-voice-room", "user_1", "Hà", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(*jwt.Token) (any, error) {
		return []byte("api-secret-at-least-32-characters!!"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatal("token does not verify:", err)
	}
	video, ok := parsed.Claims.(jwt.MapClaims)["video"].(map[string]any)
	if !ok {
		t.Fatal("missing video grant")
	}
	if video["canPublishData"] != false {
		t.Fatalf("canPublishData = %v, want false", video["canPublishData"])
	}
}

func TestParticipantPermissionCarriesEveryGrant(t *testing.T) {
	// UpdateParticipant replaces the permission set, so a field left out is a
	// grant revoked: locking someone's mic must not also deafen them, nor take
	// their camera or screen share.
	got := participantPermission(MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true, MicrophoneLocked: true})
	if !got.CanPublish || !got.CanSubscribe || !got.CanPublishData {
		t.Fatalf("permission = %+v", got)
	}
}

// Each lock removes its own sources and nothing else. Shared-tab audio is
// sound from the person: it goes with a locked mic as well as with a locked
// share, or a muted participant could still talk through a shared tab.
func TestParticipantPermissionSourcesPerLock(t *testing.T) {
	cases := []struct {
		name       string
		mic, share bool
		want       []livekit.TrackSource
	}{
		{"nothing locked", false, false, nil},
		{"mic locked", true, false, []livekit.TrackSource{livekit.TrackSource_CAMERA, livekit.TrackSource_SCREEN_SHARE}},
		{"share locked", false, true, []livekit.TrackSource{livekit.TrackSource_CAMERA, livekit.TrackSource_MICROPHONE}},
		{"both locked", true, true, []livekit.TrackSource{livekit.TrackSource_CAMERA}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			perms := MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true, MicrophoneLocked: tc.mic, ScreenShareLocked: tc.share}
			got := participantPermission(perms)
			// An empty list means every source.
			if !slices.Equal(got.CanPublishSources, tc.want) {
				t.Fatalf("sources = %v, want %v", got.CanPublishSources, tc.want)
			}
			// Reading the permission back yields the same locks, which is how a
			// lock on one source survives a later change to the other.
			if back := mediaPermissions(got); back != perms {
				t.Fatalf("read back %+v, want %+v", back, perms)
			}
		})
	}
}

// A permission LiveKit stored before shared-tab audio went with the mic lock
// still reads as a locked mic and an open share.
func TestMediaPermissionsReadsLegacyMicLock(t *testing.T) {
	legacy := &livekit.ParticipantPermission{CanPublish: true, CanPublishSources: []livekit.TrackSource{
		livekit.TrackSource_CAMERA, livekit.TrackSource_SCREEN_SHARE, livekit.TrackSource_SCREEN_SHARE_AUDIO,
	}}
	if got := mediaPermissions(legacy); !got.MicrophoneLocked || got.ScreenShareLocked {
		t.Fatalf("legacy lock = %+v", got)
	}
	if got := mediaPermissions(nil); got != (MediaPermissions{}) {
		t.Fatalf("nil permission = %+v", got)
	}
}

// Recordings are composed at 1080p: egress's default 720p shrinks a shared
// screen to unreadable text inside the speaker layout.
func TestRoomCompositeRequestRecordsAt1080p(t *testing.T) {
	a := &LiveKitAdapter{Recording: &RecordingS3{Bucket: "recordings"}}
	req := a.roomCompositeRequest(StartRecordingRequest{RoomName: "r"}, "p.mp4")
	preset, ok := req.GetOptions().(*livekit.RoomCompositeEgressRequest_Preset)
	if !ok || preset.Preset != livekit.EncodingOptionsPreset_H264_1080P_30 {
		t.Fatalf("options = %#v, want the H264 1080p30 preset", req.GetOptions())
	}
	if req.RoomName != "r" || req.Layout != "speaker" || len(req.FileOutputs) != 1 || req.FileOutputs[0].Filepath != "p.mp4" {
		t.Fatalf("request = %+v", req)
	}
}

func TestRecordingLayout(t *testing.T) {
	if got := recordingLayout(""); got != "speaker" {
		t.Fatalf("empty = %q, want speaker", got)
	}
	if got := recordingLayout("grid"); got != "grid" {
		t.Fatalf("grid = %q", got)
	}
}

func TestMintToken(t *testing.T) {
	tok, err := MintToken("api-key", "api-secret-at-least-32-characters!!", "uniwork-room1", "user_1", "Hà", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(*jwt.Token) (any, error) {
		return []byte("api-secret-at-least-32-characters!!"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatal("token does not verify:", err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["sub"] != "user_1" {
		t.Fatalf("sub = %v", claims["sub"])
	}
	video, ok := claims["video"].(map[string]any)
	if !ok || video["room"] != "uniwork-room1" || video["roomJoin"] != true {
		t.Fatalf("video grant = %v", claims["video"])
	}
	if video["roomAdmin"] == true {
		t.Fatal("roomAdmin must not be set")
	}
}
