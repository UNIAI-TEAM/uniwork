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

	// Ceilings: the fastest a type may play, so a claimed length or a header
	// can never shrink an estimate below size ÷ ceiling. 320 kbit/s is the
	// top MP3/AAC rate; 20 Mbit/s is a 1080p phone video (4K is over-counted
	// about 2.5×, which only matters near the plan limit).
	audioBytesPerSecAudioCeiling = 40_000
	audioBytesPerSecVideoCeiling = 2_500_000
)

// AudioByteRateCeiling is the highest byte rate a recording of this type may
// claim: a WAV's own PCM rate when its head is known, else the type's
// ceiling above.
func AudioByteRateCeiling(mime string, head []byte) int {
	mime = strings.ToLower(mime)
	switch {
	case strings.HasPrefix(mime, "video/"):
		return audioBytesPerSecVideoCeiling
	case isWAV(mime):
		if r := wavByteRate(head); r > 0 {
			return r
		}
	}
	return audioBytesPerSecAudioCeiling
}

func isWAV(mime string) bool {
	return mime == "audio/wav" || mime == "audio/x-wav" || mime == "audio/wave"
}

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
	rate := audioByteRate(audio.MIME, audio.Data)
	return float64(len(audio.Data)) / float64(rate)
}

// EstimateAudioSecondsFromHead is EstimateAudioSeconds for a stored upload
// known by its size, its verified type and its first bytes (nil when they
// could not be read): a WAV header's byte rate or an MP3 frame header's
// bitrate wins over the per-container table.
func EstimateAudioSecondsFromHead(size int64, mime string, head []byte) float64 {
	if size <= 0 {
		return 0
	}
	return float64(size) / float64(audioByteRate(mime, head))
}

func audioByteRate(mime string, data []byte) int {
	mime = strings.ToLower(mime)
	switch {
	case isWAV(mime):
		if r := wavByteRate(data); r > 0 {
			return r
		}
		return audioBytesPerSecWAVFallback
	case mime == "audio/mpeg" || mime == "audio/mp3":
		if r := mp3ByteRate(data); r > 0 {
			return r
		}
		return audioBytesPerSecMP3
	case mime == "audio/mp4" || mime == "audio/m4a" || mime == "audio/x-m4a":
		return audioBytesPerSecMP4Audio
	case strings.HasPrefix(mime, "video/"):
		return audioBytesPerSecVideo
	}
	return audioBytesPerSecCompressedOth
}

// wavByteRate reads the byte rate of a RIFF/WAVE header; 0 when the header
// is not one or the value is implausible. The declared byte rate is not
// trusted on its own (decoders play PCM by its sample rate, channels and
// sample size): PCM counts at most at that product, any other codec at most
// at the audio ceiling.
func wavByteRate(b []byte) int {
	if len(b) < 44 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0
	}
	r := int(binary.LittleEndian.Uint32(b[28:32]))
	switch binary.LittleEndian.Uint16(b[20:22]) {
	case 1, 0xfffe: // PCM, WAVE_FORMAT_EXTENSIBLE
		pcm := int(binary.LittleEndian.Uint32(b[24:28])) * int(binary.LittleEndian.Uint16(b[22:24])) * int(binary.LittleEndian.Uint16(b[34:36])) / 8
		r = min(r, pcm)
	default:
		r = min(r, audioBytesPerSecAudioCeiling)
	}
	if r < 1000 || r > 4_000_000 {
		return 0
	}
	return r
}

// Layer III bitrates (kbit/s) by bitrate index: MPEG-1, then MPEG-2/2.5.
var (
	mp3Bitrates1 = [15]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}
	mp3Bitrates2 = [15]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160}
)

// mp3ByteRate reads the bitrate of the first MPEG Layer III frame after any
// ID3v2 tag; 0 when b holds none. A VBR file counts at its first frame's rate.
func mp3ByteRate(b []byte) int {
	i := 0
	if len(b) >= 10 && string(b[:3]) == "ID3" {
		i = 10 + (int(b[6]&0x7f)<<21 | int(b[7]&0x7f)<<14 | int(b[8]&0x7f)<<7 | int(b[9]&0x7f))
		if b[5]&0x10 != 0 {
			i += 10 // footer
		}
	}
	for ; i+2 < len(b); i++ {
		if b[i] != 0xff || b[i+1]&0xe0 != 0xe0 || (b[i+1]>>1)&3 != 1 {
			continue
		}
		idx := int(b[i+2] >> 4)
		if idx == 0 || idx == 15 {
			continue
		}
		kbps := mp3Bitrates2[idx]
		if (b[i+1]>>3)&3 == 3 {
			kbps = mp3Bitrates1[idx]
		}
		return kbps * 1000 / 8
	}
	return 0
}
