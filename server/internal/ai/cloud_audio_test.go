package ai

import (
	"encoding/binary"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

func wavBytes(byteRate uint32, seconds int) []byte {
	b := make([]byte, 44+int(byteRate)*seconds)
	copy(b[0:], "RIFF")
	copy(b[8:], "WAVE")
	binary.LittleEndian.PutUint32(b[28:], byteRate)
	return b
}

// m9: a vendor that reports no duration is billed from the size of the audio,
// never as one minute.
func TestBilledAudioSeconds(t *testing.T) {
	mp3 := provider.Part{MIME: "audio/mpeg", Data: make([]byte, audioBytesPerSecMP3*600)} // 10 min at 128 kbit/s
	if got := BilledAudioSeconds(0, mp3); got != 600 {
		t.Fatalf("mp3 estimate: %v", got)
	}
	if got := TranscribeCharge(BilledAudioSeconds(0, mp3)); got != 10*CloudTranscribeTokensPerMinute {
		t.Fatalf("10 minutes of mp3 charged %d", got)
	}
	// A reported duration wins over the estimate.
	if got := BilledAudioSeconds(61.5, mp3); got != 61.5 {
		t.Fatalf("reported: %v", got)
	}
	// A WAV states its own byte rate (44.1 kHz stereo 16-bit = 176400 B/s).
	wav := provider.Part{MIME: "audio/wav", Data: wavBytes(176400, 30)}
	if got := BilledAudioSeconds(0, wav); got < 30 || got > 30.1 {
		t.Fatalf("wav estimate: %v", got)
	}
	// A WAV with no usable header falls back to 16 kHz mono.
	if got := BilledAudioSeconds(0, provider.Part{MIME: "audio/wav", Data: make([]byte, audioBytesPerSecWAVFallback*20)}); got != 20 {
		t.Fatalf("wav fallback: %v", got)
	}
	// 25 MiB of opus/webm is far more than one minute.
	webm := provider.Part{MIME: "audio/webm", Data: make([]byte, 25<<20)}
	if got := TranscribeCharge(BilledAudioSeconds(0, webm)); got < 60*CloudTranscribeTokensPerMinute {
		t.Fatalf("25 MiB webm charged only %d", got)
	}
	// Nothing to bill for no audio; the one-minute floor still applies.
	if BilledAudioSeconds(0, provider.Part{}) != 0 || TranscribeCharge(0) != CloudTranscribeTokensPerMinute {
		t.Fatal("floor")
	}
}
