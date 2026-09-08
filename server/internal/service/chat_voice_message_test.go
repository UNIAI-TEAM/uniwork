package service

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateVoiceMessageInput(t *testing.T) {
	valid := PrepareVoiceMessageInput{
		DurationMS: 1, ContentType: "audio/webm", SizeBytes: 1,
		ClientMsgID: "voice-msg-123",
	}
	if err := validateVoiceMessageInput(valid); err != nil {
		t.Fatalf("valid input: %v", err)
	}
	tests := []struct {
		name string
		edit func(*PrepareVoiceMessageInput)
	}{
		{"zero duration", func(in *PrepareVoiceMessageInput) { in.DurationMS = 0 }},
		{"long duration", func(in *PrepareVoiceMessageInput) { in.DurationMS = 120_001 }},
		{"empty file", func(in *PrepareVoiceMessageInput) { in.SizeBytes = 0 }},
		{"large file", func(in *PrepareVoiceMessageInput) { in.SizeBytes = MaxChatVoiceMessageBytes + 1 }},
		{"unsupported type", func(in *PrepareVoiceMessageInput) { in.ContentType = "audio/mpeg" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := valid
			tt.edit(&in)
			var validationErr ValidationError
			if err := validateVoiceMessageInput(in); !errors.As(err, &validationErr) {
				t.Fatalf("error = %v, want ValidationError", err)
			}
		})
	}
}

func TestVoiceMessageFromMetadata(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"duration_ms":  12500,
		"object_key":   "chat/voice/org/room/message.webm",
		"content_type": "audio/webm",
		"size_bytes":   1234,
	})
	if err != nil {
		t.Fatal(err)
	}
	got := voiceMessageFromMetadata("voice", raw)
	if got == nil {
		t.Fatal("voice metadata was not mapped")
	}
	if got.DurationMS != 12500 || got.ContentType != "audio/webm" || got.SizeBytes != 1234 {
		t.Fatalf("mapped metadata = %#v", got)
	}
	if got := voiceMessageFromMetadata("text", raw); got != nil {
		t.Fatalf("text metadata mapped as voice: %#v", got)
	}
}
