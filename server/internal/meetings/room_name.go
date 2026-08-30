package meetings

import (
	"strings"
	"unicode"
)

const liveKitVoicePrefix = "uw-voice-"

// LiveKitRoomFromMatrixID maps a Matrix room id to a stable LiveKit room name.
func LiveKitRoomFromMatrixID(matrixRoomID string) string {
	matrixRoomID = strings.TrimSpace(matrixRoomID)
	if matrixRoomID == "" {
		return liveKitVoicePrefix + "unknown"
	}
	var b strings.Builder
	b.WriteString(liveKitVoicePrefix)
	for _, r := range matrixRoomID {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteRune('-')
		}
	}
	out := b.String()
	if len(out) > 240 {
		return out[:240]
	}
	return out
}
