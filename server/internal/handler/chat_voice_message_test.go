package handler

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestSniffChatVoiceContentType(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
		ok   bool
	}{
		{"webm", []byte{0x1a, 0x45, 0xdf, 0xa3, 0x00}, "audio/webm", true},
		{"ogg", []byte("OggS\x00"), "audio/ogg", true},
		{"mp4", []byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '}, "audio/mp4", true},
		// UniChat mobile records AAC in MPEG-4 (expo-audio's m4a): iOS writes the
		// M4A brand above, Android MediaRecorder an isom/mp42 one.
		{"mp4 from android", []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'p', '4', '2'}, "audio/mp4", true},
		{"declared audio without magic", []byte("not audio"), "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := sniffChatVoiceContentType(tt.data)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("sniff = (%q, %t), want (%q, %t)", got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestToChatMessageDTOMapsVoiceWithoutObjectKey(t *testing.T) {
	dto := toChatMessageDTO(service.ChatMessageRow{
		Kind: "voice",
		Voice: &service.VoiceMessageInfo{
			DurationMS: 12500, ObjectKey: "private/object.webm",
			ContentType: "audio/webm", SizeBytes: 1234,
		},
	})
	if dto.Voice == nil {
		t.Fatal("voice DTO is nil")
	}
	if dto.Voice.DurationMS != 12500 || dto.Voice.ContentType != "audio/webm" || dto.Voice.SizeBytes != 1234 {
		t.Fatalf("voice DTO = %#v", dto.Voice)
	}
}
