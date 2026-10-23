package service

import (
	"context"
	"os"
	"strings"
	"testing"
)

// The gate answers a code, in the order open, scoped, budget, and spends the
// budget only when the command would otherwise run.
func TestAIWriteGateIsShared(t *testing.T) {
	spent := 0
	budget := func(ok bool) func(context.Context) bool {
		return func(context.Context) bool { spent++; return ok }
	}
	for _, c := range []struct {
		name      string
		g         AIWriteGate
		want      string
		wantSpent int
	}{
		{"closed", AIWriteGate{Open: false, OpenCode: "closed_code", Scoped: true, ScopeCode: "scope_code", Budget: budget(true)}, "closed_code", 0},
		{"open but not scoped", AIWriteGate{Open: true, OpenCode: "closed_code", Scoped: false, ScopeCode: "scope_code", Budget: budget(true)}, "scope_code", 0},
		{"budget spent", AIWriteGate{Open: true, Scoped: true, Budget: budget(false)}, "write_rate_limited", 1},
		{"own budget code", AIWriteGate{Open: true, Scoped: true, Budget: budget(false), BudgetCode: "ai_write_rate_limited"}, "ai_write_rate_limited", 1},
		{"allowed", AIWriteGate{Open: true, Scoped: true, Budget: budget(true)}, "", 1},
		{"no budget", AIWriteGate{Open: true, Scoped: true}, "", 0},
	} {
		spent = 0
		if got := c.g.Refusal(context.Background()); got != c.want {
			t.Errorf("%s: refusal %q, want %q", c.name, got, c.want)
		}
		if spent != c.wantSpent {
			t.Errorf("%s: budget called %d times, want %d", c.name, spent, c.wantSpent)
		}
	}
	// Ask UNI's executor asks the same gate askWriteGate builds: it neither
	// builds a gate of its own nor spells the refusal codes itself.
	b, err := os.ReadFile("askuni_proposals.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	if !strings.Contains(src, "askWriteGate(") || !strings.Contains(src, ".Refusal(") {
		t.Error("askuni_proposals.go does not ask the shared gate (askWriteGate, Refusal)")
	}
	for _, file := range []string{"askuni_proposals.go", "askuni_proposals_edit.go", "askuni_proposals_document.go"} {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, own := range []string{"AIWriteGate{", `"ai_actions_disabled"`, `"ai_write_rate_limited"`, "askCount("} {
			if strings.Contains(string(b), own) {
				t.Errorf("%s has its own refusal: %s", file, own)
			}
		}
	}
}

// MCP goes through the shared gate; its own copy of the order is gone.
func TestAIWriteGateIsUsedByMCP(t *testing.T) {
	b, err := os.ReadFile("../handler/mcp_transport.go")
	if err != nil {
		t.Fatal(err)
	}
	src := string(b)
	if strings.Contains(src, "func mcpWriteRefusal") {
		t.Error("mcp_transport.go still defines mcpWriteRefusal")
	}
	if !strings.Contains(src, ".Refusal(") {
		t.Error("mcp_transport.go does not call the shared gate's Refusal")
	}
}
