package ai

import (
	"encoding/binary"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
)

// Billing rule for transcription (ADR 0029): seconds of audio come from the
// vendor's own report (whisper's duration, a usage.seconds block) and
// otherwise from the size of the upload at the byte rate below, so a model
// that reports no duration cannot turn hours of audio into one minute. The
// rates are typical bitrates per container (a WAV header states its own);
// the charge is per started minute, at least one.
const (
	audioBytesPerSecWAVFallback   = 32000 // 16 kHz, 16-bit, mono
	audioBytesPerSecMP3           = 16000 // 128 kbit/s
	audioBytesPerSecMP4Audio      = 12000 // 96 kbit/s AAC
	audioBytesPerSecVideo         = 125000
	audioBytesPerSecCompressedOth = 6000 // opus/ogg/webm/flac-ish, 48 kbit/s
)

// BilledAudioSeconds is the duration a transcription is charged for:
// the vendor's reported seconds when it gave any, else the size estimate.
func BilledAudioSeconds(reported float64, audio provider.Part) float64 {
	if reported > 0 {
		return reported
	}
	return EstimateAudioSeconds(audio)
}

// EstimateAudioSeconds guesses the duration of audio from its size.
func EstimateAudioSeconds(audio provider.Part) float64 {
	if len(audio.Data) == 0 {
		return 0
	}
	rate := audioByteRate(audio)
	return float64(len(audio.Data)) / float64(rate)
}

func audioByteRate(audio provider.Part) int {
	mime := strings.ToLower(audio.MIME)
	switch {
	case mime == "audio/wav" || mime == "audio/x-wav" || mime == "audio/wave":
		if r := wavByteRate(audio.Data); r > 0 {
			return r
		}
		return audioBytesPerSecWAVFallback
	case mime == "audio/mpeg" || mime == "audio/mp3":
		return audioBytesPerSecMP3
	case mime == "audio/mp4" || mime == "audio/m4a" || mime == "audio/x-m4a":
		return audioBytesPerSecMP4Audio
	case strings.HasPrefix(mime, "video/"):
		return audioBytesPerSecVideo
	}
	return audioBytesPerSecCompressedOth
}

// wavByteRate reads the byte rate a RIFF/WAVE header declares; 0 when the
// header is not one or the value is implausible.
func wavByteRate(b []byte) int {
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0
	}
	r := int(binary.LittleEndian.Uint32(b[28:32]))
	if r < 1000 || r > 4_000_000 {
		return 0
	}
	return r
}
