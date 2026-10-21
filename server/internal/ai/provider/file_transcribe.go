package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
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
	// Language is "vi" or "en".
	Language string
	Diarize  bool
}

type FileSegment struct {
	StartMs, EndMs int
	// SpeakerLabel is the vendor's diarization label ("A", "B", …), "" when
	// it gave none.
	SpeakerLabel string
	Text         string
}

type FileTranscribeResult struct {
	Done     bool
	Segments []FileSegment
	// Seconds is the audio duration the vendor reported; 0 when unknown.
	Seconds float64
	Model   string
	// Silent: the vendor found no speech at all (nothing to bill).
	Silent bool
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

// ---- AssemblyAI ----

// assemblyModel is the pre-recorded model that lists Vietnamese (Universal-3.5
// Pro, 18 languages, code switching among the ones the request names).
const assemblyModel = "universal-3-5-pro"

type AssemblyAIFileTranscriber struct {
	baseURL, apiKey string
	http            *http.Client
}

// NewAssemblyAIFileTranscriber talks to {baseURL}/v2/transcript; "" is the US
// host, https://api.eu.assemblyai.com keeps the audio in the EU.
func NewAssemblyAIFileTranscriber(baseURL, apiKey string) *AssemblyAIFileTranscriber {
	if baseURL = strings.TrimSuffix(strings.TrimSpace(baseURL), "/"); baseURL == "" {
		baseURL = "https://api.assemblyai.com"
	}
	return &AssemblyAIFileTranscriber{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: time.Minute}}
}

func (a *AssemblyAIFileTranscriber) Name() string  { return "assemblyai" }
func (a *AssemblyAIFileTranscriber) Model() string { return assemblyModel }

// assemblyTranscript is the part of the Transcript object the worker reads.
// The vendor's own error text is never kept: it can quote the audio URL.
type assemblyTranscript struct {
	ID            string   `json:"id"`
	Status        string   `json:"status"`
	AudioDuration *float64 `json:"audio_duration"` // seconds
	Utterances    []struct {
		Speaker string `json:"speaker"`
		Start   int    `json:"start"` // ms
		End     int    `json:"end"`
		Text    string `json:"text"`
	} `json:"utterances"`
	Words []struct {
		Start int `json:"start"`
		End   int `json:"end"`
	} `json:"words"`
	Text string `json:"text"`
}

// Submit sends one job. AssemblyAI takes no idempotency key: the caller
// stores the returned id and never resubmits a row that has one. The type is
// not checked here: the meeting_audio allowlist is a subset of the vendor's
// documented audio and video types.
func (a *AssemblyAIFileTranscriber) Submit(ctx context.Context, req FileTranscribeRequest) (string, error) {
	// Vietnamese meetings switch to English mid-sentence; the request's
	// language goes first, the other is allowed (as the live scribe does).
	langs := []string{"vi", "en"}
	if req.Language == "en" {
		langs = []string{"en", "vi"}
	}
	body := map[string]any{
		"audio_url": req.AudioURL, "speech_models": []string{assemblyModel},
		"language_codes": langs, "speaker_labels": req.Diarize,
	}
	var out assemblyTranscript
	code, err := a.call(ctx, http.MethodPost, "/v2/transcript", body, &out)
	switch {
	case err != nil:
		return "", err
	case code < 200 || code > 299:
		return "", fmt.Errorf("assemblyai submit → %d", code)
	case out.Status == "error":
		return "", &FileJobError{Code: "error"}
	case out.ID == "":
		return "", errors.New("assemblyai submit: answer without an id")
	}
	return out.ID, nil
}

func (a *AssemblyAIFileTranscriber) Poll(ctx context.Context, jobID string) (FileTranscribeResult, error) {
	var out assemblyTranscript
	code, err := a.call(ctx, http.MethodGet, "/v2/transcript/"+url.PathEscape(jobID), nil, &out)
	switch {
	case code == http.StatusBadRequest || code == http.StatusNotFound:
		// The vendor does not know this job: waiting will not bring it back.
		return FileTranscribeResult{}, &FileJobError{Code: strconv.Itoa(code)}
	case err != nil:
		return FileTranscribeResult{}, err
	case code < 200 || code > 299:
		return FileTranscribeResult{}, fmt.Errorf("assemblyai poll → %d", code)
	}
	switch out.Status {
	case "queued", "processing":
		return FileTranscribeResult{Model: assemblyModel}, nil
	case "error":
		return FileTranscribeResult{}, &FileJobError{Code: "error"}
	case "completed":
	default:
		return FileTranscribeResult{}, fmt.Errorf("assemblyai poll: unknown status %q", out.Status)
	}
	res := FileTranscribeResult{Done: true, Model: assemblyModel}
	if out.AudioDuration != nil {
		res.Seconds = *out.AudioDuration
	}
	for _, u := range out.Utterances {
		if text := strings.TrimSpace(u.Text); text != "" {
			res.Segments = append(res.Segments, FileSegment{StartMs: u.Start, EndMs: u.End, SpeakerLabel: strings.TrimSpace(u.Speaker), Text: text})
		}
	}
	// Diarization left out (utterances null) still keeps the words, as one
	// unlabelled segment rather than an empty transcript.
	if text := strings.TrimSpace(out.Text); len(res.Segments) == 0 && text != "" {
		seg := FileSegment{Text: text}
		if n := len(out.Words); n > 0 {
			seg.StartMs, seg.EndMs = out.Words[0].Start, out.Words[n-1].End
		}
		res.Segments = []FileSegment{seg}
	}
	res.Silent = len(res.Segments) == 0
	return res, nil
}

// call sends one request and decodes a 2xx body into out. It returns the
// HTTP status; errors carry the path and the status only, never the key or
// the audio URL.
func (a *AssemblyAIFileTranscriber) call(ctx context.Context, method, path string, body, out any) (int, error) {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rd)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", a.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	op := "submit"
	if method == http.MethodGet {
		op = "poll"
	}
	res, err := a.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("assemblyai %s: %s", op, transportReason(err))
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return res.StatusCode, fmt.Errorf("assemblyai %s: %s", op, transportReason(err))
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return res.StatusCode, nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return res.StatusCode, fmt.Errorf("assemblyai %s: unreadable answer", op)
	}
	return res.StatusCode, nil
}

// ---- Fake ----

// FakeFileTranscriber finishes every job on its first poll with Segments (two
// fixed lines when nil) and Seconds, or as silent audio. SubmitErr / PollErr
// fail those calls; Pending > 0 answers that many polls "still running"
// first; OnSubmit runs inside Submit (a test holds a worker there). Safe for
// concurrent workers.
type FakeFileTranscriber struct {
	Segments  []FileSegment
	Seconds   float64
	Silent    bool
	SubmitErr error
	PollErr   error
	Pending   int
	OnSubmit  func(FileTranscribeRequest)
	Submits   []FileTranscribeRequest
	Polls     int
	mu        sync.Mutex
}

func (f *FakeFileTranscriber) Name() string  { return "fake" }
func (f *FakeFileTranscriber) Model() string { return "fake-file-transcribe" }

func (f *FakeFileTranscriber) Submit(_ context.Context, req FileTranscribeRequest) (string, error) {
	if f.OnSubmit != nil {
		f.OnSubmit(req)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Submits = append(f.Submits, req)
	if f.SubmitErr != nil {
		return "", f.SubmitErr
	}
	return fmt.Sprintf("fake-job-%d", len(f.Submits)), nil
}

func (f *FakeFileTranscriber) Poll(_ context.Context, _ string) (FileTranscribeResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Polls++
	if f.PollErr != nil {
		return FileTranscribeResult{}, f.PollErr
	}
	if f.Pending > 0 {
		f.Pending--
		return FileTranscribeResult{Model: f.Model()}, nil
	}
	if f.Silent {
		return FileTranscribeResult{Done: true, Silent: true, Model: f.Model()}, nil
	}
	segs := f.Segments
	if segs == nil {
		segs = []FileSegment{
			{StartMs: 0, EndMs: 2000, SpeakerLabel: "A", Text: "Bản ghi thử nghiệm."},
			{StartMs: 2500, EndMs: 4000, SpeakerLabel: "B", Text: "Đã rõ."},
		}
	}
	return FileTranscribeResult{Done: true, Segments: segs, Seconds: f.Seconds, Model: f.Model()}, nil
}
