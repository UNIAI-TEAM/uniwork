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
	copy(b[12:], "fmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1) // PCM, 16-bit stereo at byteRate
	binary.LittleEndian.PutUint16(b[22:], 2)
	binary.LittleEndian.PutUint32(b[24:], byteRate/4)
	binary.LittleEndian.PutUint32(b[28:], byteRate)
	binary.LittleEndian.PutUint16(b[34:], 16)
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
	copy(wav[12:], "fmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint32(wav[28:32], 16000)
	if got := EstimateAudioSecondsFromHead(16000*90, "audio/wav", wav); got != 90 {
		t.Fatalf("wav header = %v, want 90", got)
	}
}

// A WAV header cannot shrink the estimate: PCM counts at its sample rate ×
// channels × sample size whatever byte rate it claims, and any other WAV
// codec at most at 320 kbit/s. The ceiling is the fastest a type may play.
func TestWAVByteRateIsClampedAndTheCeilingFollowsTheType(t *testing.T) {
	wav := func(format uint16, channels uint16, sampleRate, byteRate uint32, bits uint16) []byte {
		b := make([]byte, 44)
		copy(b, "RIFF")
		copy(b[8:], "WAVE")
		copy(b[12:], "fmt ")
		binary.LittleEndian.PutUint32(b[16:], 16)
		binary.LittleEndian.PutUint16(b[20:22], format)
		binary.LittleEndian.PutUint16(b[22:24], channels)
		binary.LittleEndian.PutUint32(b[24:28], sampleRate)
		binary.LittleEndian.PutUint32(b[28:32], byteRate)
		binary.LittleEndian.PutUint16(b[34:36], bits)
		return b
	}
	lying := wav(1, 1, 8000, 4_000_000, 16) // 8 kHz 16-bit mono claiming 4 MB/s
	if got := EstimateAudioSecondsFromHead(16000*90, "audio/wav", lying); got != 90 {
		t.Fatalf("lying PCM header = %v s, want 90", got)
	}
	cd := wav(1, 2, 44100, 176400, 16)
	if got := EstimateAudioSecondsFromHead(176400*60, "audio/wav", cd); got != 60 {
		t.Fatalf("CD-quality PCM = %v s, want 60", got)
	}
	mp3InWAV := wav(0x55, 2, 44100, 4_000_000, 0)
	if got := EstimateAudioSecondsFromHead(40000*60, "audio/wav", mp3InWAV); got != 60 {
		t.Fatalf("compressed WAV = %v s, want 60 (320 kbit/s at most)", got)
	}
	for _, tc := range []struct {
		mime string
		head []byte
		want int
	}{
		{"audio/mp4", nil, 40_000},
		{"audio/mpeg", nil, 40_000},
		{"audio/ogg", nil, 40_000},
		{"audio/wav", nil, 40_000},
		{"audio/wav", cd, 176400},
		{"video/mp4", nil, 2_500_000},
	} {
		if got := AudioByteRateCeiling(tc.mime, tc.head); got != tc.want {
			t.Errorf("ceiling %s = %d, want %d", tc.mime, got, tc.want)
		}
	}
}

// Field recorders (Zoom H-series, broadcast WAV) put a bext or JUNK chunk
// before "fmt "; the rate is read from wherever "fmt " sits, so an hour of
// 48 kHz 24-bit stereo is an hour, not the 40 kB/s fallback's nine.
func TestWAVByteRateFindsFmtAfterOtherChunks(t *testing.T) {
	const bext = 603 // odd: the chunk is padded to an even length
	b := make([]byte, 12+8+bext+1+8+16)
	copy(b, "RIFF")
	copy(b[8:], "WAVE")
	copy(b[12:], "bext")
	binary.LittleEndian.PutUint32(b[16:], bext)
	f := 12 + 8 + bext + 1
	copy(b[f:], "fmt ")
	binary.LittleEndian.PutUint32(b[f+4:], 16)
	binary.LittleEndian.PutUint16(b[f+8:], 1)
	binary.LittleEndian.PutUint16(b[f+10:], 2)
	binary.LittleEndian.PutUint32(b[f+12:], 48000)
	binary.LittleEndian.PutUint32(b[f+16:], 288000)
	binary.LittleEndian.PutUint16(b[f+22:], 24)
	if got := AudioByteRateCeiling("audio/wav", b); got != 288000 {
		t.Fatalf("ceiling = %d, want 288000", got)
	}
	if got := EstimateAudioSecondsFromHead(288000*3600, "audio/wav", b); got != 3600 {
		t.Fatalf("one hour = %v s, want 3600", got)
	}
}
