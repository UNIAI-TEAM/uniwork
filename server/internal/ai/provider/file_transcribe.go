package provider

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Long-file transcription (parent spec 2026-10-20-meeting-follow-through §7.4):
// a two-phase job, submit then poll, for an uploaded meeting recording. The
// vendor fetches the audio from a presigned URL, so the server never holds
// the file. Separate from Transcriber, which serves short voice notes in one
// call.

type FileTranscribeRequest struct {
	// AudioURL is a presigned read URL the vendor downloads from.
	AudioURL string
	MIME     string
	// Language is "vi" or "en".
	Language string
	Diarize  bool
}

type FileSegment struct {
	StartMs, EndMs int
	// SpeakerLabel is the vendor's diarization label, "" when it gave none.
	SpeakerLabel string
	Text         string
}

type FileTranscribeResult struct {
	Done     bool
	Segments []FileSegment
	// Seconds is the audio duration the vendor reported; 0 when unknown.
	Seconds float64
	Model   string
}

type FileTranscriber interface {
	Name() string
	Model() string
	Submit(ctx context.Context, req FileTranscribeRequest) (jobID string, err error)
	Poll(ctx context.Context, jobID string) (FileTranscribeResult, error)
}

// FileJobError is the vendor declaring the job failed (as opposed to a
// transport error, after which the job may still be running).
type FileJobError struct{ Code string }

func (e *FileJobError) Error() string { return "provider: transcription job failed (" + e.Code + ")" }

// ---- BytePlus ----

// BytePlus status codes, carried in the X-Api-Status-Code response header.
const (
	byteplusOK         = "20000000"
	byteplusProcessing = "20000001"
	byteplusQueued     = "20000002"
	byteplusSilence    = "20000003" // nothing was said: done, no utterances
)

// byteplusFormats is what the bigmodel file API is asked to decode, by the
// verified upload type. The documented formats are raw/wav/mp3/ogg; m4a and
// webm are what the reference integration (smart-commune-hub) sends in
// production. video/mp4 is not documented, so it is refused (§7.4).
var byteplusFormats = map[string]string{
	"audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/webm": "webm",
}

var byteplusLanguages = map[string]string{"vi": "vi-VN", "en": "en-US"}

type BytePlusFileTranscriber struct {
	baseURL, apiKey, resourceID string
	http                        *http.Client
}

// NewBytePlusFileTranscriber talks to {baseURL}/submit and {baseURL}/query.
func NewBytePlusFileTranscriber(baseURL, apiKey, resourceID string) *BytePlusFileTranscriber {
	return &BytePlusFileTranscriber{
		baseURL: strings.TrimSuffix(baseURL, "/"), apiKey: apiKey, resourceID: resourceID,
		http: &http.Client{Timeout: time.Minute},
	}
}

func (b *BytePlusFileTranscriber) Name() string  { return "byteplus" }
func (b *BytePlusFileTranscriber) Model() string { return "bigmodel" }

func (b *BytePlusFileTranscriber) Submit(ctx context.Context, req FileTranscribeRequest) (string, error) {
	format, ok := byteplusFormats[req.MIME]
	if !ok {
		return "", fmt.Errorf("byteplus: unsupported audio type %q", req.MIME)
	}
	lang := byteplusLanguages[req.Language]
	if lang == "" {
		lang = byteplusLanguages["vi"]
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	jobID := hex.EncodeToString(id[:])
	body := map[string]any{
		"audio": map[string]any{"url": req.AudioURL, "format": format, "language": lang},
		"request": map[string]any{
			"model_name": "bigmodel", "enable_itn": true, "enable_punc": true,
			"enable_speaker_info": req.Diarize, "show_utterances": true,
		},
	}
	status, _, err := b.call(ctx, "/submit", jobID, body)
	if err != nil {
		return "", err
	}
	if status != byteplusOK {
		return "", &FileJobError{Code: status}
	}
	return jobID, nil
}

func (b *BytePlusFileTranscriber) Poll(ctx context.Context, jobID string) (FileTranscribeResult, error) {
	status, data, err := b.call(ctx, "/query", jobID, map[string]any{})
	if err != nil {
		return FileTranscribeResult{}, err
	}
	switch status {
	case byteplusProcessing, byteplusQueued:
		return FileTranscribeResult{Model: b.Model()}, nil
	case byteplusSilence:
		return FileTranscribeResult{Done: true, Model: b.Model()}, nil
	case byteplusOK:
	default:
		return FileTranscribeResult{}, &FileJobError{Code: status}
	}
	var out struct {
		AudioInfo struct {
			Duration float64 `json:"duration"` // ms
		} `json:"audio_info"`
		Result struct {
			Utterances []struct {
				Text      string `json:"text"`
				StartTime int    `json:"start_time"`
				EndTime   int    `json:"end_time"`
				Additions struct {
					Speaker string `json:"speaker"`
				} `json:"additions"`
			} `json:"utterances"`
		} `json:"result"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return FileTranscribeResult{}, fmt.Errorf("byteplus: unreadable query answer")
	}
	res := FileTranscribeResult{Done: true, Seconds: out.AudioInfo.Duration / 1000, Model: b.Model()}
	for _, u := range out.Result.Utterances {
		text := strings.TrimSpace(u.Text)
		if text == "" {
			continue
		}
		res.Segments = append(res.Segments, FileSegment{
			StartMs: u.StartTime, EndMs: u.EndTime, SpeakerLabel: strings.TrimSpace(u.Additions.Speaker), Text: text,
		})
	}
	return res, nil
}

// call posts one request and returns the X-Api-Status-Code header and the
// body. A missing header is an error: the reference integration read an
// empty one as success, which turned vendor faults into empty transcripts.
// Errors carry the path and the status only, never the key or the URL.
func (b *BytePlusFileTranscriber) call(ctx context.Context, path, jobID string, body any) (string, []byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return "", nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return "", nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", b.apiKey)
	req.Header.Set("X-Api-Resource-Id", b.resourceID)
	req.Header.Set("X-Api-Request-Id", jobID)
	req.Header.Set("X-Api-Sequence", "-1")
	res, err := b.http.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("byteplus %s: %s", path, transportReason(err))
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return "", nil, fmt.Errorf("byteplus %s: %s", path, transportReason(err))
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return "", nil, fmt.Errorf("byteplus %s → %d", path, res.StatusCode)
	}
	status := strings.TrimSpace(res.Header.Get("X-Api-Status-Code"))
	if status == "" {
		return "", nil, fmt.Errorf("byteplus %s: answer without X-Api-Status-Code", path)
	}
	return status, data, nil
}

// ---- Fake ----

// FakeFileTranscriber finishes every job on its first poll with Segments (two
// fixed lines when nil) and Seconds. SubmitErr / PollErr fail those calls;
// Pending > 0 answers that many polls "still running" first.
type FakeFileTranscriber struct {
	Segments  []FileSegment
	Seconds   float64
	SubmitErr error
	PollErr   error
	Pending   int
	Submits   []FileTranscribeRequest
	Polls     int
}

func (f *FakeFileTranscriber) Name() string  { return "fake" }
func (f *FakeFileTranscriber) Model() string { return "fake-file-transcribe" }

func (f *FakeFileTranscriber) Submit(_ context.Context, req FileTranscribeRequest) (string, error) {
	f.Submits = append(f.Submits, req)
	if f.SubmitErr != nil {
		return "", f.SubmitErr
	}
	return fmt.Sprintf("fake-job-%d", len(f.Submits)), nil
}

func (f *FakeFileTranscriber) Poll(_ context.Context, _ string) (FileTranscribeResult, error) {
	f.Polls++
	if f.PollErr != nil {
		return FileTranscribeResult{}, f.PollErr
	}
	if f.Pending > 0 {
		f.Pending--
		return FileTranscribeResult{Model: f.Model()}, nil
	}
	segs := f.Segments
	if segs == nil {
		segs = []FileSegment{
			{StartMs: 0, EndMs: 2000, SpeakerLabel: "1", Text: "Bản ghi thử nghiệm."},
			{StartMs: 2500, EndMs: 4000, SpeakerLabel: "2", Text: "Đã rõ."},
		}
	}
	return FileTranscribeResult{Done: true, Segments: segs, Seconds: f.Seconds, Model: f.Model()}, nil
}
