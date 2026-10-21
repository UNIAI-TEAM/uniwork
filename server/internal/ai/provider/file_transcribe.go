package provider

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
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
	// Model is the model that transcribed the audio (a fallback shows here).
	Model string
	// Silent: the vendor found no speech at all (nothing to bill).
	Silent bool
}

type FileTranscriber interface {
	Name() string
	Model() string
	Submit(ctx context.Context, req FileTranscribeRequest) (jobID string, err error)
	Poll(ctx context.Context, jobID string) (FileTranscribeResult, error)
	// Delete removes the vendor's copy of a finished job's transcript.
	Delete(ctx context.Context, jobID string) error
}

// FileJobError is the vendor refusing or failing the job (as opposed to a
// transport error, after which the job may still be running). Permanent:
// sending it again cannot help. Reason is the vendor's message with every
// URL replaced, for the log only.
type FileJobError struct {
	Code      string
	Permanent bool
	Reason    string
}

func (e *FileJobError) Error() string { return "provider: transcription job failed (" + e.Code + ")" }

// RetryAfterError is the vendor's rate limit: ask again after After.
type RetryAfterError struct{ After time.Duration }

func (e *RetryAfterError) Error() string { return "provider: rate limited for " + e.After.String() }

// ---- AssemblyAI ----

// assemblyModels: Universal-3.5 Pro lists Vietnamese and code-switches among
// the request's languages; Universal-2 takes over what it cannot do.
var assemblyModels = []string{"universal-3-5-pro", "universal-2"}

// assemblyLanguages: Vietnamese meetings switch to English mid-sentence.
// Universal-2 takes at most two codes, one of them en.
var assemblyLanguages = []string{"vi", "en"}

var urlPattern = regexp.MustCompile(`https?://\S+`)

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
func (a *AssemblyAIFileTranscriber) Model() string { return assemblyModels[0] }

// assemblyTranscript is the part of the Transcript object the worker reads.
type assemblyTranscript struct {
	ID              string   `json:"id"`
	Status          string   `json:"status"`
	Error           string   `json:"error"`
	SpeechModelUsed string   `json:"speech_model_used"`
	AudioDuration   *float64 `json:"audio_duration"` // seconds
	Utterances      []struct {
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

// jobError reads a transcript in status "error". The vendor could not fetch
// the audio: a later job may (the URL is re-signed); anything else is the
// audio or the request, and sending it again cannot help.
func (t assemblyTranscript) jobError() *FileJobError {
	reason := strings.Join(strings.Fields(urlPattern.ReplaceAllString(t.Error, "<url>")), " ")
	lower := strings.ToLower(reason)
	download := strings.Contains(lower, "download") || strings.Contains(lower, "fetch")
	return &FileJobError{Code: "error", Permanent: !download, Reason: reason}
}

// Submit sends one job. AssemblyAI takes no idempotency key: the caller
// stores the returned id and never resubmits a row that has one. The type is
// not checked here: the meeting_audio allowlist is a subset of the vendor's
// documented audio and video types.
func (a *AssemblyAIFileTranscriber) Submit(ctx context.Context, req FileTranscribeRequest) (string, error) {
	body := map[string]any{
		"audio_url": req.AudioURL, "speech_models": assemblyModels,
		"language_codes": assemblyLanguages, "speaker_labels": req.Diarize,
	}
	var out assemblyTranscript
	code, header, err := a.call(ctx, http.MethodPost, "/v2/transcript", body, &out)
	switch {
	case err != nil:
		return "", err
	case code == http.StatusBadRequest || code == http.StatusUnauthorized || code == http.StatusForbidden || code == http.StatusUnprocessableEntity:
		// The request, the key or the account: the same submit fails again.
		return "", &FileJobError{Code: strconv.Itoa(code), Permanent: true}
	case code == http.StatusTooManyRequests:
		after := time.Minute
		if n, err := strconv.Atoi(strings.TrimSpace(header.Get("Retry-After"))); err == nil && n > 0 {
			after = time.Duration(n) * time.Second
		}
		return "", &RetryAfterError{After: after}
	case code < 200 || code > 299:
		return "", fmt.Errorf("assemblyai submit → %d", code)
	case out.Status == "error":
		return "", out.jobError()
	case out.ID == "":
		return "", errors.New("assemblyai submit: answer without an id")
	}
	return out.ID, nil
}

func (a *AssemblyAIFileTranscriber) Poll(ctx context.Context, jobID string) (FileTranscribeResult, error) {
	var out assemblyTranscript
	code, _, err := a.call(ctx, http.MethodGet, "/v2/transcript/"+url.PathEscape(jobID), nil, &out)
	switch {
	case code == http.StatusBadRequest || code == http.StatusNotFound:
		// The vendor does not know this job: waiting will not bring it back,
		// a new job may.
		return FileTranscribeResult{}, &FileJobError{Code: strconv.Itoa(code)}
	case err != nil:
		return FileTranscribeResult{}, err
	case code < 200 || code > 299:
		return FileTranscribeResult{}, fmt.Errorf("assemblyai poll → %d", code)
	}
	model := cmp.Or(strings.TrimSpace(out.SpeechModelUsed), assemblyModels[0])
	switch out.Status {
	case "queued", "processing":
		return FileTranscribeResult{Model: model}, nil
	case "error":
		return FileTranscribeResult{}, out.jobError()
	case "completed":
	default:
		return FileTranscribeResult{}, fmt.Errorf("assemblyai poll: unknown status %q", out.Status)
	}
	res := FileTranscribeResult{Done: true, Model: model}
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

// Delete removes the transcript (text, words, utterances) at AssemblyAI.
func (a *AssemblyAIFileTranscriber) Delete(ctx context.Context, jobID string) error {
	var out assemblyTranscript
	code, _, err := a.call(ctx, http.MethodDelete, "/v2/transcript/"+url.PathEscape(jobID), nil, &out)
	if err == nil && (code < 200 || code > 299) {
		err = fmt.Errorf("assemblyai delete → %d", code)
	}
	return err
}

// call sends one request and decodes a 2xx body into out. It returns the
// HTTP status and headers; errors carry the operation and the status only,
// never the key or the audio URL.
func (a *AssemblyAIFileTranscriber) call(ctx context.Context, method, path string, body, out any) (int, http.Header, error) {
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", a.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	op := map[string]string{http.MethodPost: "submit", http.MethodGet: "poll", http.MethodDelete: "delete"}[method]
	res, err := a.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("assemblyai %s: %s", op, transportReason(err))
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return res.StatusCode, res.Header, fmt.Errorf("assemblyai %s: %s", op, transportReason(err))
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return res.StatusCode, res.Header, nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return res.StatusCode, res.Header, fmt.Errorf("assemblyai %s: unreadable answer", op)
	}
	return res.StatusCode, res.Header, nil
}

// ---- Fake ----

// FakeFileTranscriber finishes every job on its first poll with Segments (two
// fixed lines when nil) and Seconds, or as silent audio. SubmitErr / PollErr
// / DeleteErr fail those calls (Deletes records the ids asked); Pending > 0 answers that many polls "still running"
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
	DeleteErr error
	Submits   []FileTranscribeRequest
	Polls     int
	Deletes   []string
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

func (f *FakeFileTranscriber) Delete(_ context.Context, jobID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Deletes = append(f.Deletes, jobID)
	return f.DeleteErr
}
