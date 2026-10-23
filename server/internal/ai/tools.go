package ai

import (
	"context"
	"encoding/json"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// Tool registry (spec §3.4). The registry is source code: no tool is loaded
// from the database. Ask UNI's tools only read (TestAskUniToolsAreReadOnly);
// the MCP connector's write tools run as the human who consented (ADR 0033).
type ToolKind string

const (
	ToolRead  ToolKind = "read"
	ToolWrite ToolKind = "write"
)

// RiskLevel is decided by the server per tool; the model never overrides it.
type RiskLevel string

const (
	RiskLow      RiskLevel = "low"
	RiskMedium   RiskLevel = "medium"
	RiskHigh     RiskLevel = "high"
	RiskCritical RiskLevel = "critical"
)

// ToolContext is the actor a tool handler runs as. Handlers call existing
// services with ActorID, so membership is checked by RequireMember exactly
// as it is for a person clicking the same screen.
type ToolContext struct {
	ActorID        string
	ActorKind      audit.Kind
	OrganizationID string
	WorkspaceID    string
}

type Tool struct {
	Name string
	// Title is the human-readable label an MCP client shows the person; Ask
	// UNI's tools leave it empty.
	Title       string
	Description string
	Kind        ToolKind
	Risk        RiskLevel
	Schema      json.RawMessage
	// Strict asks the vendor to hold the model to Schema, which must then be
	// strict-safe (every property required, no extras).
	Strict bool
	Handle func(ctx context.Context, tc ToolContext, input json.RawMessage) (json.RawMessage, error)
	// Destructive marks a write that overwrites or removes what was there
	// (MCP destructiveHint). Additive writes leave it false.
	Destructive bool
	// Undo says, in one sentence for the model, how a person reverses this
	// write. Every MCP write tool has one (TestMCPWriteToolsDeclareUndo).
	Undo string
}

type Registry []Tool

func (r Registry) Names() []string {
	out := make([]string, 0, len(r))
	for _, t := range r {
		out = append(out, t.Name)
	}
	return out
}

// MutationCount is what TestAskUniToolsAreReadOnly asserts to be zero.
func (r Registry) MutationCount() int {
	n := 0
	for _, t := range r {
		if t.Kind == ToolWrite {
			n++
		}
	}
	return n
}

func (r Registry) Get(name string) (Tool, bool) {
	for _, t := range r {
		if t.Name == name {
			return t, true
		}
	}
	return Tool{}, false
}
