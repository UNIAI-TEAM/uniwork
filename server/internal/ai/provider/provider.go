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
)

// ErrUnsupported is returned by an adapter for an operation its vendor does
// not offer. ponytail: every adapter returns it from Embed until the A-phase
// RAG spec has a caller.
var ErrUnsupported = errors.New("ai: unsupported by provider")

// ErrRefused is returned when the model declined to answer.
var ErrRefused = errors.New("ai: request refused")

type Message struct {
	Role    string // "user" | "assistant"
	Content string
}

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
	Text         string
	ToolCalls    []ToolCall
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
