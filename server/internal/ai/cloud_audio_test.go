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

// An upload is estimated from its stored size and verified type alone: one
// hour of 128 kbit/s MP3 is 3600 s, a WAV counts at the 16 kHz mono rate.
func TestEstimateAudioSecondsFromSize(t *testing.T) {
	if got := EstimateAudioSecondsFromHead(3600*16000, "audio/mpeg", nil); got != 3600 {
		t.Fatalf("mp3 = %v", got)
	}
	if got := EstimateAudioSecondsFromHead(32000*10, "audio/wav", nil); got != 10 {
		t.Fatalf("wav = %v", got)
	}
	if got := EstimateAudioSecondsFromHead(0, "audio/mpeg", nil); got != 0 {
		t.Fatalf("empty = %v", got)
	}
	// The head knows better than the table: a 32 kbit/s MPEG-1 Layer III
	// frame after an ID3 tag is 4000 bytes a second...
	id3 := append([]byte("ID3\x04\x00\x00\x00\x00\x00\x05"), make([]byte, 5)...)
	mp3 := append(id3, 0xff, 0xfb, 0x10, 0x64)
	if got := EstimateAudioSecondsFromHead(4000*600, "audio/mpeg", mp3); got != 600 {
		t.Fatalf("32 kbit/s mp3 = %v, want 600", got)
	}
	// ...and a WAV header states its own byte rate (8 kHz 16-bit mono).
	wav := make([]byte, 44)
	copy(wav, "RIFF")
	copy(wav[8:], "WAVE")
	binary.LittleEndian.PutUint32(wav[28:32], 16000)
	if got := EstimateAudioSecondsFromHead(16000*90, "audio/wav", wav); got != 90 {
		t.Fatalf("wav header = %v, want 90", got)
	}
}
