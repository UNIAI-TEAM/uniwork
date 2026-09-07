package ai

import (
	"context"
	"encoding/json"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// Tool registry (spec §3.4). The registry is source code: no tool is loaded
// from the database, and a write tool is refused for any request that is
// not an agent run with AllowWrite — which no caller in phase F is.
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
	Name        string
	Description string
	Kind        ToolKind
	Risk        RiskLevel
	Schema      json.RawMessage
	Handle      func(ctx context.Context, tc ToolContext, input json.RawMessage) (json.RawMessage, error)
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
