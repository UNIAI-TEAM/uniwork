package office

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

// ExtractFormat is a document format supported by OperationExtractText.
type ExtractFormat string // "docx" | "xlsx" | "pptx"

const (
	ExtractFormatDOCX ExtractFormat = ExtractFormat(FormatDOCX)
	ExtractFormatXLSX ExtractFormat = ExtractFormat(FormatXLSX)
	ExtractFormatPPTX ExtractFormat = ExtractFormat(FormatPPTX)
)

// ExtractTextRequest asks the engine to extract plain text from an in-memory
// Office Open XML file linked from Google Drive (spec §8.3a, B11).
type ExtractTextRequest struct {
	Format                                            ExtractFormat
	Content                                           []byte // <= 20 MiB, in memory
	ActorID, OrganizationID, WorkspaceID, DriveFileID string // for the extract-only ServiceGrant (actor_kind "human")
}

// ExtractTextResult is the extracted text returned in the final job status.
type ExtractTextResult struct {
	Text      string
	Truncated bool // engine cut at 200,000 chars / 512 KiB
}

const (
	// MaxExtractInputBytes caps in-memory Drive OOXML inputs at 20 MiB (§8.3).
	MaxExtractInputBytes = 20 << 20
	// ExtractTimeout bounds one ExtractText call from submit through terminal status (§8.3a).
	ExtractTimeout = 60 * time.Second

	maxExtractStatusResponseBytes = 2 << 20
	extractGrantWindow            = 30 * time.Second
	extractCancelTimeout          = 2 * time.Second
)

// ErrExtractUnavailable reports that the engine is not ready, unreachable,
// timed out, or failed with an infrastructure error.
var ErrExtractUnavailable = errors.New("office: text extraction unavailable")

// ExtractUnreadableError reports that the file itself cannot be extracted
// (password_required, corrupted, or not_office_file).
type ExtractUnreadableError struct {
	Reason string
}

func (e *ExtractUnreadableError) Error() string {
	return "office: unreadable file for text extraction: " + e.Reason
}

var (
	extractEntropy  = sync.OnceValue(ulid.DefaultEntropy)
	extractTimeout  = ExtractTimeout
	extractPollWait = 50 * time.Millisecond
)

func newExtractID() string {
	return ulid.MustNew(ulid.Timestamp(time.Now()), extractEntropy()).String()
}

// ExtractText mints and signs an extract-only ServiceGrant, submits the
// in-memory bytes via framed/1, and polls status (with a 2 MiB response cap)
// until a terminal job state or the 60 s deadline.
func (c *Client) ExtractText(ctx context.Context, req ExtractTextRequest) (ExtractTextResult, error) {
	if c == nil {
		return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, ErrNotConfigured)
	}
	switch req.Format {
	case ExtractFormatDOCX, ExtractFormatXLSX, ExtractFormatPPTX:
	default:
		return ExtractTextResult{}, fmt.Errorf("office: unsupported extract_text format %q", req.Format)
	}
	if len(req.Content) > MaxExtractInputBytes {
		return ExtractTextResult{}, fmt.Errorf("office: extract_text content length %d exceeds max %d", len(req.Content), MaxExtractInputBytes)
	}
	if req.ActorID == "" || req.OrganizationID == "" || req.WorkspaceID == "" || req.DriveFileID == "" {
		return ExtractTextResult{}, errors.New("office: extract_text requires actor_id, organization_id, workspace_id, and drive_file_id")
	}

	if _, err := c.Ready(ctx); err != nil {
		return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, err)
	}

	timeout := extractTimeout
	if timeout <= 0 {
		timeout = ExtractTimeout
	}
	now := time.Now()
	deadline := now.Add(timeout)
	window := now.Add(extractGrantWindow)
	if deadline.Before(window) {
		window = deadline
	}

	sum := sha256.Sum256(req.Content)
	checksum := hex.EncodeToString(sum[:])
	length := int64(len(req.Content))

	grantID := newExtractID()
	jobID := newExtractID()
	grant, err := c.Sign(ServiceGrant{
		V:              1,
		GrantID:        grantID,
		JobID:          jobID,
		ActorID:        req.ActorID,
		ActorKind:      "human",
		OrganizationID: req.OrganizationID,
		WorkspaceID:    req.WorkspaceID,
		DocumentID:     "",
		DriveFileID:    req.DriveFileID,
		Operation:      OperationExtractText,
		Format:         Format(req.Format),
		BaseRevision:   0,
		BaseVersionID:  "",
		Input:          &GrantInput{Checksum: checksum, Length: length},
		Output:         nil,
		DeadlineAt:     deadline.UnixMilli(),
		IssuedAt:       now.UnixMilli(),
		ExpiresAt:      window.UnixMilli(),
	})
	if err != nil {
		return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, err)
	}

	deadlineMs := timeout.Milliseconds()
	if deadlineMs < 1 {
		deadlineMs = 1
	}
	payload, err := json.Marshal(InputTuple{
		InputChecksum: checksum,
		InputLength:   length,
	})
	if err != nil {
		return ExtractTextResult{}, err
	}
	env := Envelope{
		RequestID:           jobID,
		ContractVersion:     ContractVersion,
		ProtocolVersion:     ProtocolVersion,
		Operation:           OperationExtractText,
		Format:              Format(req.Format),
		DeadlineMs:          &deadlineMs,
		IdempotencyKey:      jobID,
		ClientEngineVersion: TrustedEngineVersion,
		GrantID:             grantID,
		Payload:             payload,
	}

	src := InputSource{
		Length:   length,
		Checksum: checksum,
		Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(req.Content)), nil
		},
	}

	runCtx, cancelRun := context.WithTimeout(ctx, timeout)
	defer cancelRun()

	js, err := c.Submit(runCtx, grant, env, src)
	if err != nil {
		c.cancelDetached(jobID, grant)
		if runCtx.Err() != nil {
			return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, runCtx.Err())
		}
		return ExtractTextResult{}, mapExtractCallError(err)
	}

	for !js.State.Terminal() {
		timer := time.NewTimer(extractPollWait)
		select {
		case <-runCtx.Done():
			timer.Stop()
			c.cancelDetached(jobID, grant)
			return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, runCtx.Err())
		case <-timer.C:
		}
		js, err = c.extractStatus(runCtx, jobID, grant)
		if err != nil {
			c.cancelDetached(jobID, grant)
			if runCtx.Err() != nil {
				return ExtractTextResult{}, fmt.Errorf("%w: %w", ErrExtractUnavailable, runCtx.Err())
			}
			return ExtractTextResult{}, mapExtractCallError(err)
		}
	}

	return decodeExtractOutcome(js)
}

func (c *Client) extractStatus(ctx context.Context, jobID, grant string) (JobStatus, error) {
	return c.jobWithinLimit(ctx, c.cfg.RequestTimeout, http.MethodGet, "/v1/jobs/"+url.PathEscape(jobID), grant, nil, maxExtractStatusResponseBytes)
}

func (c *Client) cancelDetached(jobID, grant string) {
	timeout := min(c.cfg.RequestTimeout, extractCancelTimeout)
	if timeout <= 0 {
		timeout = extractCancelTimeout
	}
	go func() {
		cancelCtx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		_, _ = c.Cancel(cancelCtx, jobID, grant)
	}()
}

func mapExtractCallError(err error) error {
	var ee *EngineError
	if errors.As(err, &ee) && ee.Code == "engine_result_invalid" {
		switch ee.Reason {
		case string(OpenPasswordRequired), string(OpenCorrupted), string(OpenNotOfficeFile):
			return &ExtractUnreadableError{Reason: ee.Reason}
		}
	}
	return fmt.Errorf("%w: %w", ErrExtractUnavailable, err)
}

func decodeExtractOutcome(js JobStatus) (ExtractTextResult, error) {
	switch js.State {
	case JobCompleted:
		if len(js.Result) == 0 {
			return ExtractTextResult{}, fmt.Errorf("%w: missing extract_text result", ErrExtractUnavailable)
		}
		var out struct {
			Text      *string `json:"text"`
			Truncated *bool   `json:"truncated"`
		}
		if err := json.Unmarshal(js.Result, &out); err != nil || out.Text == nil || out.Truncated == nil {
			return ExtractTextResult{}, fmt.Errorf("%w: invalid extract_text result", ErrExtractUnavailable)
		}
		return ExtractTextResult{Text: *out.Text, Truncated: *out.Truncated}, nil
	case JobFailed:
		if js.Error != nil && js.Error.Code == "engine_result_invalid" {
			switch js.Error.Reason {
			case string(OpenPasswordRequired), string(OpenCorrupted), string(OpenNotOfficeFile):
				return ExtractTextResult{}, &ExtractUnreadableError{Reason: js.Error.Reason}
			}
		}
		if js.Error != nil {
			return ExtractTextResult{}, fmt.Errorf("%w: %s (%s)", ErrExtractUnavailable, js.Error.Code, js.Error.Reason)
		}
		return ExtractTextResult{}, fmt.Errorf("%w: job failed", ErrExtractUnavailable)
	default:
		if js.Error != nil {
			return ExtractTextResult{}, fmt.Errorf("%w: state %s (%s: %s)", ErrExtractUnavailable, js.State, js.Error.Code, js.Error.Reason)
		}
		return ExtractTextResult{}, fmt.Errorf("%w: state %s", ErrExtractUnavailable, js.State)
	}
}
