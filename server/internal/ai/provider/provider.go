// Package provider is the transport tier of the AI gateway: one adapter per
// vendor, each a plain function from CompletionRequest to CompletionResponse.
// Adapters know nothing about tenants, actors, policy or cost — that is the
// gateway's job — and this is the only package in the server allowed to
// import a vendor SDK or open an HTTP connection to a model host
// (server/internal/arch_test.go, spec F-09 §2 #1).
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ErrUnsupported is returned by an adapter for an operation its vendor does
// not offer. ponytail: every adapter returns it from Embed until the A-phase
// RAG spec has a caller.
var ErrUnsupported = errors.New("ai: unsupported by provider")

// ErrRefused is returned when the model declined to answer.
var ErrRefused = errors.New("ai: request refused")

// ErrTruncated is returned when an answer that must be a JSON object stopped
// at the max_tokens ceiling: what came back cannot be parsed. The response
// returned with it still carries the usage, which was spent.
var ErrTruncated = errors.New("ai: output truncated at max_tokens")

// StatusError is a vendor's non-2xx answer: the HTTP status and the
// Retry-After it asked for (0 when absent or unreadable), so a caller can
// tell a rate limit from an outage with errors.As (spike G6-02 §4.5). Detail
// is the first bytes of the vendor's body, which is what an operator needs
// and nothing a log should not hold.
type StatusError struct {
	Status     int
	RetryAfter time.Duration
	URL        string // the endpoint, for HTTP adapters without an SDK
	Detail     string
	Err        error // the vendor SDK's own error, when there is one
}

func (e *StatusError) Error() string {
	if e.URL != "" {
		return fmt.Sprintf("provider: %s → %d: %s", e.URL, e.Status, e.Detail)
	}
	return fmt.Sprintf("provider: %d: %s", e.Status, e.Detail)
}

func (e *StatusError) Unwrap() error { return e.Err }

// retryAfter reads a Retry-After header in either RFC 7231 form: delay-seconds,
// or an HTTP-date whose wait lasts until that instant. Already past, negative,
// or unreadable is no wait at all.
func retryAfter(h http.Header, now time.Time) time.Duration {
	v := strings.TrimSpace(h.Get("Retry-After"))
	if n, err := strconv.Atoi(v); err == nil {
		if n < 0 {
			return 0
		}
		return time.Duration(n) * time.Second
	}
	when, err := http.ParseTime(v)
	if err != nil {
		return 0
	}
	if d := when.Sub(now); d > 0 {
		return d
	}
	return 0
}

// snippet caps a vendor body for an error message.
func snippet(b []byte) string {
	if len(b) > 200 {
		b = b[:200]
	}
	return string(b)
}

type Message struct {
	Role    string // "user" | "assistant" | "tool"
	Content string
	// Parts are media inputs sent before Content in a user message (media
	// analysis). An adapter that cannot send a part's type returns
	// ErrUnsupportedMedia rather than dropping it.
	Parts []Part
	// ToolCalls replays what the assistant asked for, on an assistant message
	// that precedes its result: the vendor needs the call and its id back
	// before it accepts the answer (spike G6-02, spec §6.2).
	ToolCalls []ToolCall
	// ToolCallID pairs a Role "tool" message with the call it answers;
	// Content is that call's result. Empty on every other role.
	ToolCallID string
}

// Part is one media input: raw bytes and their MIME type.
type Part struct {
	MIME string
	Data []byte
}

// ErrUnsupportedMedia is returned when a part's MIME type is not one the
// vendor accepts as model input.
var ErrUnsupportedMedia = errors.New("ai: media type unsupported by provider")

// ToolSpec is what the model is told it may call. Schema is a JSON Schema
// object for the tool input.
type ToolSpec struct {
	Name        string
	Description string
	Schema      json.RawMessage
}

// ToolCall is what the model asked for. The gateway validates it against
// the request's allowlist before anything runs.
type ToolCall struct {
	// ID is the vendor's handle for this call; the tool result is matched to
	// it on the next request. A vendor that sends none leaves it empty and
	// the adapter omits the field.
	ID    string
	Name  string
	Input json.RawMessage
}

type CompletionRequest struct {
	Model       string
	System      string
	Messages    []Message
	MaxTokens   int
	Temperature float64
	// JSONSchema, when set, asks the vendor for a JSON object of this shape.
	// Vendors that cannot enforce it are simply told so in the system prompt
	// by the caller; the gateway validates the output either way.
	JSONSchema json.RawMessage
	Tools      []ToolSpec
}

type CompletionResponse struct {
	Text      string
	ToolCalls []ToolCall
	// UsagePresent reports whether the vendor sent a usage block. A vendor
	// that omits it is unknown usage, not zero tokens: metering must treat it
	// as reconciliation instead of charging nothing (spec §8.2).
	UsagePresent bool
	InputTokens  int
	OutputTokens int
	Model        string
	StopReason   string
}

type EmbedRequest struct {
	Model string
	Input []string
}

type EmbedResponse struct {
	Vectors [][]float32
	Tokens  int
}

type Provider interface {
	Name() string
	Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
	Embed(ctx context.Context, req EmbedRequest) (EmbedResponse, error)
}

// schemaParts splits a JSON Schema object into the pieces vendor APIs ask
// for separately. A schema that is not an object yields empty parts.
func schemaParts(schema json.RawMessage) (properties map[string]any, required []string) {
	var s struct {
		Properties map[string]any `json:"properties"`
		Required   []string       `json:"required"`
	}
	_ = json.Unmarshal(schema, &s)
	if s.Properties == nil {
		s.Properties = map[string]any{}
	}
	return s.Properties, s.Required
}
