package office

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is how Go reaches the private engine service. The engine holds the
// same two secrets: the service token authenticates Go, the grant key signs
// per-job grants. They must differ, so the credential alone never mints a
// grant.
type Config struct {
	BaseURL      string
	ServiceToken string
	GrantKey     string
	// RequestTimeout bounds one HTTP call to the engine (not a job).
	RequestTimeout time.Duration
	// MaxJobDeadline caps the deadline a job may ask for.
	MaxJobDeadline time.Duration
	// ReconcileInterval is how often the reconciler sweeps live jobs.
	ReconcileInterval time.Duration
}

const (
	defaultRequestTimeout    = 10 * time.Second
	defaultMaxJobDeadline    = 2 * time.Minute
	defaultReconcileInterval = 5 * time.Second
	maxResponseBytes         = 1 << 20
)

// ConfigFromEnv reads the engine settings. An unset OFFICE_ENGINE_URL means
// the engine is not deployed: Enabled reports false and office jobs are
// refused, while every other feature (Documents list/download included) is
// untouched.
func ConfigFromEnv() Config {
	return Config{
		BaseURL:           strings.TrimSpace(os.Getenv("OFFICE_ENGINE_URL")),
		ServiceToken:      os.Getenv("OFFICE_ENGINE_SERVICE_TOKEN"),
		GrantKey:          os.Getenv("OFFICE_ENGINE_GRANT_KEY"),
		RequestTimeout:    envMillis("OFFICE_ENGINE_REQUEST_TIMEOUT_MS", defaultRequestTimeout),
		MaxJobDeadline:    envMillis("OFFICE_JOB_MAX_DEADLINE_MS", defaultMaxJobDeadline),
		ReconcileInterval: envMillis("OFFICE_JOB_RECONCILE_INTERVAL_MS", defaultReconcileInterval),
	}
}

func envMillis(key string, fallback time.Duration) time.Duration {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || n <= 0 {
		return fallback
	}
	return time.Duration(n) * time.Millisecond
}

// Enabled reports whether an engine URL is configured.
func (c Config) Enabled() bool { return c.BaseURL != "" }

// Client talks to the engine service. It never reads a database or storage;
// it carries envelopes and grants that internal/service built.
type Client struct {
	base     *url.URL
	token    string
	grantKey []byte
	http     *http.Client
	cfg      Config
}

// NewClient validates the config. Secrets shorter than 32 characters, or the
// same value used twice, are refused at startup rather than at first job.
func NewClient(cfg Config, httpClient *http.Client) (*Client, error) {
	if !cfg.Enabled() {
		return nil, ErrNotConfigured
	}
	base, err := url.Parse(strings.TrimRight(cfg.BaseURL, "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return nil, fmt.Errorf("office: OFFICE_ENGINE_URL must be an absolute http(s) URL")
	}
	if len(cfg.ServiceToken) < 32 || len(cfg.GrantKey) < 32 {
		return nil, errors.New("office: OFFICE_ENGINE_SERVICE_TOKEN and OFFICE_ENGINE_GRANT_KEY must be at least 32 characters")
	}
	if cfg.ServiceToken == cfg.GrantKey {
		return nil, errors.New("office: OFFICE_ENGINE_GRANT_KEY must differ from OFFICE_ENGINE_SERVICE_TOKEN")
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = defaultRequestTimeout
	}
	if cfg.MaxJobDeadline <= 0 {
		cfg.MaxJobDeadline = defaultMaxJobDeadline
	}
	if cfg.ReconcileInterval <= 0 {
		cfg.ReconcileInterval = defaultReconcileInterval
	}
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	return &Client{base: base, token: cfg.ServiceToken, grantKey: []byte(cfg.GrantKey), http: httpClient, cfg: cfg}, nil
}

// Config returns the validated config.
func (c *Client) Config() Config { return c.cfg }

// Sign signs a grant with the configured grant key.
func (c *Client) Sign(g ServiceGrant) (string, error) { return SignGrant(g, c.grantKey) }

// JobError is the error body the engine attaches to a settled job.
type JobError struct {
	Code   string `json:"code"`
	Reason string `json:"reason"`
}

// JobStatus is the engine's view of one job. It carries ids, digests and
// codes only - never a path or a target URL.
type JobStatus struct {
	JobID              string    `json:"job_id"`
	RequestID          string    `json:"request_id"`
	State              JobState  `json:"state"`
	PreviousState      JobState  `json:"previous_state"`
	Operation          Operation `json:"operation"`
	Format             Format    `json:"format"`
	EngineVersion      string    `json:"engine_version"`
	OutputFileID       string    `json:"output_file_id"`
	OutputChecksum     string    `json:"output_checksum"`
	OutputLength       *int64    `json:"output_length"`
	Replay             bool      `json:"replay"`
	PayloadFingerprint string    `json:"payload_fingerprint"`
	Error              *JobError `json:"error"`
	// Warnings are the job's non-fatal fidelity notices (a lossy convert).
	Warnings []FidelityWarning `json:"warnings"`
	// Result is the operation result beyond the output bytes: a convert
	// job's fidelity and change list. Go stores it verbatim and never
	// interprets it beyond JSON validity.
	Result json.RawMessage `json:"result,omitempty"`
}

// Readiness is the engine's /readyz answer.
type Readiness struct {
	Status     string `json:"status"`
	QueueDepth int    `json:"queue_depth"`
	Running    int    `json:"running"`
	MaxWorkers int    `json:"max_workers"`
	MaxQueue   int    `json:"max_queue"`
}

// Ready probes the engine. It is the engine's own readiness, reported beside
// the API's /readyz, never inside it: an engine outage must not take the API
// out of rotation.
func (c *Client) Ready(ctx context.Context) (Readiness, error) {
	var r Readiness
	status, body, err := c.do(ctx, http.MethodGet, "/readyz", "", nil)
	if err != nil {
		return r, err
	}
	_ = json.Unmarshal(body, &r)
	if status != http.StatusOK {
		return r, NewEngineError("engine_crashed", "not_ready:"+r.Status)
	}
	return r, nil
}

// Capability reads the engine's capability answer for one format: the row set
// and the engine identity Negotiate checks before any mutation.
func (c *Client) Capability(ctx context.Context, format Format) (CapabilityResult, error) {
	status, body, err := c.do(ctx, http.MethodGet, "/v1/capability?format="+url.QueryEscape(string(format)), "", nil)
	if err != nil {
		return CapabilityResult{}, err
	}
	if status != http.StatusOK {
		return CapabilityResult{}, decodeFailure(status, body)
	}
	var out CapabilityResult
	if err := json.Unmarshal(body, &out); err != nil {
		return CapabilityResult{}, NewEngineError("engine_result_invalid", "capability_json")
	}
	if out.EngineVersion == "" && out.Capabilities == nil && out.Limits.MaxInputBytes == nil {
		// Valid JSON that carries no identity and no rows at all is drift,
		// not an empty capability set.
		return CapabilityResult{}, NewEngineError("engine_result_invalid", "capability_empty")
	}
	return out, nil
}

// InputSource is the raw input bytes of one job. Open is called once per
// attempt (and again if the transport replays the body): a consumed reader is
// never reused. Length and Checksum are the digest the envelope and the grant
// already carry; the engine verifies them against the bytes it receives.
type InputSource struct {
	Length   int64
	Checksum string
	Open     func() (io.ReadCloser, error)
}

// jobFrameType is the Content-Type of a framed job body (JobTransport): the JSON
// envelope (X-Office-Envelope-Length bytes) immediately followed by the raw
// input bytes, no separator.
const jobFrameType = "application/vnd.uniwork.office-job"

// Submit sends one job. A 2xx answer is a job (new or replayed); anything
// else is a typed error. The body is a frame (envelope + raw input streamed
// from input.Open, explicit Content-Length), so the input is never held in
// memory here. The request timeout grows with the input (+250 ms per MiB):
// the engine hashes the input before it answers. A source without Open sends
// the envelope alone as JSON.
func (c *Client) Submit(ctx context.Context, grant string, env Envelope, input InputSource) (JobStatus, error) {
	raw, err := json.Marshal(env)
	if err != nil {
		return JobStatus{}, err
	}
	if input.Open == nil {
		return c.jobWithin(ctx, c.cfg.RequestTimeout, http.MethodPost, "/v1/jobs", grant, raw)
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.RequestTimeout+time.Duration(input.Length>>20)*250*time.Millisecond)
	defer cancel()
	req, err := c.newRequest(ctx, http.MethodPost, "/v1/jobs", grant)
	if err != nil {
		return JobStatus{}, err
	}
	body, err := frameBody(raw, input)
	if err != nil {
		return JobStatus{}, err
	}
	req.Body = body
	req.ContentLength = int64(len(raw)) + input.Length
	req.GetBody = func() (io.ReadCloser, error) { return frameBody(raw, input) }
	req.Header.Set("Content-Type", jobFrameType)
	req.Header.Set("X-Office-Envelope-Length", strconv.Itoa(len(raw)))
	status, resp, err := c.roundTrip(req)
	if err != nil {
		return JobStatus{}, err
	}
	return parseJob(status, resp)
}

type frame struct {
	io.Reader
	io.Closer
}

func frameBody(envelope []byte, input InputSource) (io.ReadCloser, error) {
	src, err := input.Open()
	if err != nil {
		return nil, err
	}
	return frame{Reader: io.MultiReader(bytes.NewReader(envelope), io.LimitReader(src, input.Length)), Closer: src}, nil
}

// Status reads one job with its grant.
func (c *Client) Status(ctx context.Context, jobID, grant string) (JobStatus, error) {
	return c.job(ctx, http.MethodGet, "/v1/jobs/"+url.PathEscape(jobID), grant, nil)
}

// Cancel asks the engine to cancel one job. A job that already settled
// answers its outcome.
func (c *Client) Cancel(ctx context.Context, jobID, grant string) (JobStatus, error) {
	return c.job(ctx, http.MethodPost, "/v1/jobs/"+url.PathEscape(jobID)+"/cancel", grant, []byte("{}"))
}

func (c *Client) job(ctx context.Context, method, path, grant string, body []byte) (JobStatus, error) {
	return c.jobWithin(ctx, c.cfg.RequestTimeout, method, path, grant, body)
}

func (c *Client) jobWithin(ctx context.Context, timeout time.Duration, method, path, grant string, body []byte) (JobStatus, error) {
	status, raw, err := c.doWithin(ctx, timeout, method, path, grant, body)
	if err != nil {
		return JobStatus{}, err
	}
	return parseJob(status, raw)
}

func parseJob(status int, raw []byte) (JobStatus, error) {
	if status < 200 || status > 299 {
		return JobStatus{}, decodeFailure(status, raw)
	}
	var js JobStatus
	if err := json.Unmarshal(raw, &js); err != nil || js.JobID == "" {
		return JobStatus{}, NewEngineError("engine_result_invalid", "job_json")
	}
	switch js.State {
	case JobAccepted, JobRunning, JobCompleted, JobFailed, JobTimedOut, JobCancelled, JobCrashed:
	default:
		return JobStatus{}, NewEngineError("engine_result_invalid", "job_state")
	}
	return js, nil
}

func (c *Client) do(ctx context.Context, method, path, grant string, body []byte) (int, []byte, error) {
	return c.doWithin(ctx, c.cfg.RequestTimeout, method, path, grant, body)
}

func (c *Client) doWithin(ctx context.Context, timeout time.Duration, method, path, grant string, body []byte) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := c.newRequest(ctx, method, path, grant)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
		req.Header.Set("Content-Type", "application/json")
	}
	return c.roundTrip(req)
}

func (c *Client) newRequest(ctx context.Context, method, path, grant string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base.String()+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if grant != "" {
		req.Header.Set("X-Office-Grant", grant)
	}
	return req, nil
}

func (c *Client) roundTrip(req *http.Request) (int, []byte, error) {
	res, err := c.http.Do(req)
	if err != nil {
		// Unreachable, reset or timed out: the engine may or may not have the
		// job. Retryable, and the reconciler settles what the engine did.
		return 0, nil, NewEngineError("engine_crashed", "unreachable")
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return 0, nil, NewEngineError("engine_crashed", "response_read")
	}
	return res.StatusCode, raw, nil
}

func decodeFailure(status int, raw []byte) error {
	var body struct {
		Error struct {
			Code      string `json:"code"`
			Reason    string `json:"reason"`
			FieldPath string `json:"field_path"`
			Rule      string `json:"rule"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &body)
	switch body.Error.Code {
	case "service_unauthenticated":
		return ErrServiceAuth
	case "contract_violation":
		return &ContractViolationError{FieldPath: body.Error.FieldPath, Rule: body.Error.Rule}
	case "":
		return NewEngineError("engine_result_invalid", "status_"+strconv.Itoa(status))
	}
	return NewEngineError(body.Error.Code, body.Error.Reason)
}
