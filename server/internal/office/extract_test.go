package office

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type extractFakeEngine struct {
	srv *httptest.Server
	cli *Client

	mu          sync.Mutex
	readyStatus int
	submitErr   int
	statusErr   int
	hangStatus  bool
	jobState    JobState
	jobResult   any
	jobError    *JobError
	pollsBefore int

	seenGrants    []ServiceGrant
	seenEnvelopes []Envelope
	seenInputs    [][]byte
	cancelCalls   atomic.Int32
	statusCalls   atomic.Int32
}

func newExtractFakeEngine(t *testing.T) *extractFakeEngine {
	t.Helper()
	e := &extractFakeEngine{
		readyStatus: http.StatusOK,
		jobState:    JobCompleted,
		jobResult: map[string]any{
			"text":      "Extracted paragraph\nCell A | Cell B",
			"truncated": false,
			"format":    "docx",
		},
	}
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testToken {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"code":"service_unauthenticated"}}`))
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/readyz":
			e.mu.Lock()
			st := e.readyStatus
			e.mu.Unlock()
			w.WriteHeader(st)
			if st == http.StatusOK {
				_, _ = w.Write([]byte(`{"status":"ready","queue_depth":0,"running":0,"max_workers":2,"max_queue":16}`))
			} else {
				_, _ = w.Write([]byte(`{"status":"draining"}`))
			}

		case r.Method == http.MethodPost && r.URL.Path == "/v1/jobs":
			e.mu.Lock()
			subErr := e.submitErr
			e.mu.Unlock()
			if subErr != 0 {
				w.WriteHeader(subErr)
				_, _ = w.Write([]byte(`{"error":{"code":"engine_overloaded","reason":"queue_full"}}`))
				return
			}
			grantTok := r.Header.Get("X-Office-Grant")
			g, err := VerifyGrant(grantTok, []byte(testKey))
			if err != nil {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":{"code":"grant_scope","reason":"invalid_grant"}}`))
				return
			}
			envLen, err := strconv.Atoi(r.Header.Get(EnvelopeLengthHeader))
			if err != nil || envLen < 1 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"code":"contract_violation","field_path":"header","rule":"framing"}}`))
				return
			}
			envBytes := make([]byte, envLen)
			if _, err := io.ReadFull(r.Body, envBytes); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			inputBytes, err := io.ReadAll(r.Body)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			var env Envelope
			if err := json.Unmarshal(envBytes, &env); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			e.mu.Lock()
			e.seenGrants = append(e.seenGrants, g)
			e.seenEnvelopes = append(e.seenEnvelopes, env)
			e.seenInputs = append(e.seenInputs, inputBytes)
			polls := e.pollsBefore
			e.mu.Unlock()

			state := JobRunning
			if polls < 0 {
				state = e.jobState
			}
			resp := map[string]any{
				"job_id":    g.JobID,
				"state":     state,
				"operation": g.Operation,
				"format":    g.Format,
			}
			if state == JobCompleted {
				resp["result"] = e.jobResult
			} else if state == JobFailed && e.jobError != nil {
				resp["error"] = e.jobError
			}
			raw, _ := json.Marshal(resp)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(raw)

		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/jobs/"):
			call := int(e.statusCalls.Add(1))
			jobID := strings.TrimPrefix(r.URL.Path, "/v1/jobs/")
			grantTok := r.Header.Get("X-Office-Grant")
			if _, err := VerifyGrant(grantTok, []byte(testKey)); err != nil {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":{"code":"grant_scope","reason":"invalid_grant"}}`))
				return
			}
			e.mu.Lock()
			stErr := e.statusErr
			hang := e.hangStatus
			polls := e.pollsBefore
			finalState := e.jobState
			res := e.jobResult
			jobErr := e.jobError
			e.mu.Unlock()

			if stErr != 0 {
				w.WriteHeader(stErr)
				_, _ = w.Write([]byte(`{"error":{"code":"engine_crashed","reason":"worker_died"}}`))
				return
			}
			state := finalState
			if hang || call <= polls {
				state = JobRunning
			}
			resp := map[string]any{
				"job_id":    jobID,
				"state":     state,
				"operation": OperationExtractText,
				"format":    FormatDOCX,
			}
			if state == JobCompleted {
				resp["result"] = res
			} else if state == JobFailed && jobErr != nil {
				resp["error"] = jobErr
			}
			raw, _ := json.Marshal(resp)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(raw)

		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/cancel"):
			e.cancelCalls.Add(1)
			jobID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/jobs/"), "/cancel")
			raw, _ := json.Marshal(map[string]any{
				"job_id": jobID,
				"state":  JobCancelled,
			})
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(raw)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(e.srv.Close)

	cli, err := NewClient(Config{
		BaseURL:        e.srv.URL,
		ServiceToken:   testToken,
		GrantKey:       testKey,
		RequestTimeout: 2 * time.Second,
	}, e.srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	e.cli = cli
	return e
}

func withShortExtractTimers(t *testing.T, timeout, poll time.Duration) {
	t.Helper()
	prevTimeout, prevPoll := extractTimeout, extractPollWait
	extractTimeout = timeout
	extractPollWait = poll
	t.Cleanup(func() {
		extractTimeout = prevTimeout
		extractPollWait = prevPoll
	})
}

func sampleExtractReq(content []byte) ExtractTextRequest {
	return ExtractTextRequest{
		Format:         ExtractFormatDOCX,
		Content:        content,
		ActorID:        "01USER00000000000000000001",
		OrganizationID: "01ORG000000000000000000001",
		WorkspaceID:    "01WS0000000000000000000001",
		DriveFileID:    "01DRIVEFILE000000000000001",
	}
}

func TestExtractTextSuccessAndGrantBindings(t *testing.T) {
	withShortExtractTimers(t, 2*time.Second, 5*time.Millisecond)
	e := newExtractFakeEngine(t)
	e.pollsBefore = 1
	e.jobResult = map[string]any{
		"text":      "Hello Drive World",
		"truncated": true,
		"format":    "docx",
	}

	input := []byte("PK\x03\x04fake-docx-bytes")
	sum := sha256.Sum256(input)
	wantChecksum := hex.EncodeToString(sum[:])

	res, err := e.cli.ExtractText(context.Background(), sampleExtractReq(input))
	if err != nil {
		t.Fatalf("ExtractText: %v", err)
	}
	if res.Text != "Hello Drive World" || !res.Truncated {
		t.Fatalf("unexpected result: %+v", res)
	}
	if e.statusCalls.Load() < 2 {
		t.Fatalf("expected at least 2 status polls, got %d", e.statusCalls.Load())
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.seenGrants) != 1 || len(e.seenEnvelopes) != 1 || len(e.seenInputs) != 1 {
		t.Fatalf("seen grants=%d envs=%d inputs=%d", len(e.seenGrants), len(e.seenEnvelopes), len(e.seenInputs))
	}
	g := e.seenGrants[0]
	if g.Operation != OperationExtractText || g.Format != FormatDOCX {
		t.Fatalf("grant op/format: %s/%s", g.Operation, g.Format)
	}
	if g.DocumentID != "" || g.BaseVersionID != "" || g.BaseRevision != 0 {
		t.Fatalf("grant must have empty document_id/base_version_id and 0 base_revision: %+v", g)
	}
	if g.DriveFileID != "01DRIVEFILE000000000000001" {
		t.Fatalf("grant drive_file_id = %q", g.DriveFileID)
	}
	if g.Output != nil {
		t.Fatalf("grant output must be nil, got %+v", g.Output)
	}
	if g.Input == nil || g.Input.Checksum != wantChecksum || g.Input.Length != int64(len(input)) {
		t.Fatalf("grant input = %+v, want checksum %s len %d", g.Input, wantChecksum, len(input))
	}
	if string(e.seenInputs[0]) != string(input) {
		t.Fatalf("framed input bytes mismatch")
	}
	env := e.seenEnvelopes[0]
	if env.Operation != OperationExtractText || env.GrantID != g.GrantID {
		t.Fatalf("envelope: %+v", env)
	}
}

func TestExtractTextMapsUnreadableReasons(t *testing.T) {
	withShortExtractTimers(t, 2*time.Second, 5*time.Millisecond)
	reasons := []string{
		string(OpenPasswordRequired),
		string(OpenCorrupted),
		string(OpenNotOfficeFile),
	}
	for _, reason := range reasons {
		e := newExtractFakeEngine(t)
		e.jobState = JobFailed
		e.jobError = &JobError{Code: "engine_result_invalid", Reason: reason}

		_, err := e.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes")))
		var ue *ExtractUnreadableError
		if !errors.As(err, &ue) || ue.Reason != reason {
			t.Fatalf("reason %q: got err=%v (unreadable=%+v)", reason, err, ue)
		}
		if errors.Is(err, ErrExtractUnavailable) {
			t.Fatalf("reason %q must not match ErrExtractUnavailable", reason)
		}
	}
}

func TestExtractTextTimeoutCancelsAndReturnsUnavailable(t *testing.T) {
	withShortExtractTimers(t, 40*time.Millisecond, 10*time.Millisecond)
	e := newExtractFakeEngine(t)
	e.hangStatus = true

	_, err := e.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes")))
	if !errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("expected ErrExtractUnavailable on timeout, got %v", err)
	}
	if e.cancelCalls.Load() == 0 {
		t.Fatalf("expected Cancel to be called on timeout")
	}
}

func TestExtractTextUnavailableOnEngineDownNotReadyOr5xx(t *testing.T) {
	withShortExtractTimers(t, 500*time.Millisecond, 5*time.Millisecond)

	// Not ready (503 draining)
	notReady := newExtractFakeEngine(t)
	notReady.readyStatus = http.StatusServiceUnavailable
	if _, err := notReady.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes"))); !errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("not ready: got %v, want ErrExtractUnavailable", err)
	}

	// Submit 503
	sub503 := newExtractFakeEngine(t)
	sub503.submitErr = http.StatusServiceUnavailable
	if _, err := sub503.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes"))); !errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("submit 503: got %v, want ErrExtractUnavailable", err)
	}

	// Status 502
	st502 := newExtractFakeEngine(t)
	st502.statusErr = http.StatusBadGateway
	if _, err := st502.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes"))); !errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("status 502: got %v, want ErrExtractUnavailable", err)
	}

	// Engine down (closed server)
	down := newExtractFakeEngine(t)
	down.srv.Close()
	if _, err := down.cli.ExtractText(context.Background(), sampleExtractReq([]byte("bytes"))); !errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("engine down: got %v, want ErrExtractUnavailable", err)
	}
}

func TestExtractTextCallerValidation(t *testing.T) {
	e := newExtractFakeEngine(t)

	// Bad format -> plain error, not ErrExtractUnavailable.
	badFmt := sampleExtractReq([]byte("x"))
	badFmt.Format = "pdf"
	if _, err := e.cli.ExtractText(context.Background(), badFmt); err == nil || errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("bad format: got %v, want plain error (not ErrExtractUnavailable)", err)
	}

	// Oversized content (> 20 MiB) -> plain error, not ErrExtractUnavailable.
	oversized := sampleExtractReq(make([]byte, MaxExtractInputBytes+1))
	if _, err := e.cli.ExtractText(context.Background(), oversized); err == nil || errors.Is(err, ErrExtractUnavailable) {
		t.Fatalf("oversized content: got %v, want plain error (not ErrExtractUnavailable)", err)
	}
}

func TestExtractTextS6StatusCapCases(t *testing.T) {
	withShortExtractTimers(t, 5*time.Second, 5*time.Millisecond)

	cases := []struct {
		name           string
		text           string
		wantOver1MiB   bool
		nonExtractFail bool
	}{
		{
			name:         "200k_ascii_chars",
			text:         strings.Repeat("A", 200_000),
			wantOver1MiB: false,
		},
		{
			name:         "512kib_utf8_text",
			text:         strings.Repeat("B", 512<<10),
			wantOver1MiB: false,
		},
		{
			name:           "heavy_escape_quotes_and_newlines_over_1mib_json",
			text:           strings.Repeat("\"\n", 280_000), // 560,000 raw bytes -> 1,120,000 escaped JSON bytes (> 1 MiB, < 2 MiB)
			wantOver1MiB:   true,
			nonExtractFail: true,
		},
		{
			name:           "heavy_escape_control_u0001_200k_chars_over_1mib_json",
			text:           strings.Repeat("\x01", 200_000), // 200,000 chars / bytes -> 1,200,000 escaped JSON bytes (\u0001)
			wantOver1MiB:   true,
			nonExtractFail: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newExtractFakeEngine(t)
			e.jobResult = map[string]any{
				"text":      tc.text,
				"truncated": true,
				"format":    "xlsx",
			}

			// Measure full JSON status size produced by the fake engine.
			probeBody, err := json.Marshal(map[string]any{
				"job_id":    "01JOB00000000000000000000P",
				"state":     JobCompleted,
				"operation": OperationExtractText,
				"format":    FormatXLSX,
				"result":    e.jobResult,
			})
			if err != nil {
				t.Fatal(err)
			}
			if tc.wantOver1MiB && (len(probeBody) <= maxResponseBytes || len(probeBody) >= maxExtractStatusResponseBytes) {
				t.Fatalf("expected JSON status size between 1 MiB and 2 MiB, got %d", len(probeBody))
			}

			req := sampleExtractReq([]byte("xlsx-bytes"))
			req.Format = ExtractFormatXLSX
			got, err := e.cli.ExtractText(context.Background(), req)
			if err != nil {
				t.Fatalf("ExtractText failed on %s (%d JSON bytes): %v", tc.name, len(probeBody), err)
			}
			if got.Text != tc.text || !got.Truncated {
				t.Fatalf("ExtractText text length = %d (want %d), truncated = %v", len(got.Text), len(tc.text), got.Truncated)
			}

			if tc.nonExtractFail {
				// Verify that a non-extract Status call on the exact same >1 MiB payload still fails at 1 MiB.
				grant, err := e.cli.Sign(extractParityGrant())
				if err != nil {
					t.Fatal(err)
				}
				_, statusErr := e.cli.Status(context.Background(), "01JOB00000000000000000000E", grant)
				if ErrorCode(statusErr) != "engine_result_invalid" {
					t.Fatalf("expected non-extract Status over 1 MiB to fail with engine_result_invalid, got %v", statusErr)
				}
			}
		})
	}
}
