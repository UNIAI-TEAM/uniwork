package meetings

import (
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
	for _, src := range got.CanPublishSources {
		if src == livekit.TrackSource_MICROPHONE {
			t.Fatalf("a locked mic still lists the microphone: %v", got.CanPublishSources)
		}
	}
	if len(got.CanPublishSources) != 3 {
		t.Fatalf("sources = %v, want camera and both share sources", got.CanPublishSources)
	}
	if open := participantPermission(MediaPermissions{CanPublish: true}); len(open.CanPublishSources) != 0 {
		t.Fatalf("an unlocked mic restricts sources: %v", open.CanPublishSources)
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
