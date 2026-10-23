package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// writeRegistry is one read tool and one destructive write tool that record
// whether they ran and with which via.
func writeRegistry(ran *[]string, via *audit.Via) ai.Registry {
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	run := func(name string) func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
		return func(ctx context.Context, _ ai.ToolContext, _ json.RawMessage) (json.RawMessage, error) {
			*ran = append(*ran, name)
			if v := audit.RequestFromContext(ctx).Via; v != nil {
				*via = *v
			}
			return json.RawMessage(`{"ok":true}`), nil
		}
	}
	return ai.Registry{
		{Name: "peek", Title: "Peek", Description: "reads", Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: schema, Handle: run("peek")},
		{Name: "poke", Title: "Poke", Description: "writes", Kind: ai.ToolWrite, Risk: ai.RiskLow, Destructive: true, Undo: "poke back", Schema: schema, Handle: run("poke")},
	}
}

type fakeBudget struct{ left int }

func (b *fakeBudget) Allow(context.Context, string) bool {
	b.left--
	return b.left >= 0
}

func writer() service.McpPrincipal {
	return service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", ClientID: "c1", ClientName: "Claude", Scope: "read write", WriteOpen: true}
}

func listedTools(t *testing.T, h http.Handler) map[string]map[string]any {
	t.Helper()
	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	tools := map[string]map[string]any{}
	for _, raw := range out["result"].(map[string]any)["tools"].([]any) {
		tool := raw.(map[string]any)
		tools[tool["name"].(string)] = tool
	}
	return tools
}

// The annotations come from the tool: a write tool is not read-only and says
// whether it is destructive.
func TestMcpAnnotationsFollowTheTool(t *testing.T) {
	var ran []string
	var via audit.Via
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	tools := listedTools(t, h)
	peek := tools["peek"]["annotations"].(map[string]any)
	poke := tools["poke"]["annotations"].(map[string]any)
	if peek["readOnlyHint"] != true || peek["destructiveHint"] != false {
		t.Errorf("peek annotations = %v", peek)
	}
	if poke["readOnlyHint"] != false || poke["destructiveHint"] != true || poke["openWorldHint"] != false {
		t.Errorf("poke annotations = %v", poke)
	}
}

// TestMCPWriteToolsNeedScopeFlagAndPolicy holds ADR 0033: without the write
// scope, or with either write switch off, a write tool is not listed and a
// direct call is refused with its own code before the tool runs.
func TestMCPWriteToolsNeedScopeFlagAndPolicy(t *testing.T) {
	cases := []struct {
		name string
		p    service.McpPrincipal
		code string
	}{
		{"read grant", service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read", WriteOpen: true}, "insufficient_scope"},
		{"write closed", service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read write", WriteOpen: false}, "write_disabled"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var ran []string
			var via audit.Via
			h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), c.p)
			tools := listedTools(t, h)
			if _, ok := tools["poke"]; ok {
				t.Error("write tool listed")
			}
			if _, ok := tools["peek"]; !ok {
				t.Error("read tool missing")
			}
			out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"poke","arguments":{}}}`)
			result, _ := out["result"].(map[string]any)
			if result["isError"] != true || !strings.HasPrefix(resultText(result), c.code+":") {
				t.Errorf("direct call = %v, want %s", out, c.code)
			}
			if len(ran) != 0 {
				t.Errorf("tools ran: %v", ran)
			}
		})
	}
}

// A tool whose Kind is neither read nor write is hidden from tools/list, so
// the call gate must treat it as a write: refused without the write scope and
// spending the budget when it may run.
func TestMcpUnknownKindIsGatedLikeAWrite(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	var ran []string
	registry := ai.Registry{{Name: "mystery", Title: "Mystery", Description: "no kind", Risk: ai.RiskLow, Schema: schema,
		Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
			ran = append(ran, "mystery")
			return json.RawMessage(`{"ok":true}`), nil
		}}}
	call := func(h http.Handler) map[string]any {
		out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"mystery","arguments":{}}}`)
		res, _ := out["result"].(map[string]any)
		return res
	}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	reader := service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read", WriteOpen: true}
	if res := call(mcpServeAs(newMcpHandler(registry, &mcpToolCounts{}, nil, quiet), reader)); res["isError"] != true || !strings.HasPrefix(resultText(res), "insufficient_scope:") {
		t.Fatalf("read-only principal = %v, want insufficient_scope", res)
	}
	if len(ran) != 0 {
		t.Fatalf("tool ran for a read-only principal: %v", ran)
	}
	h := mcpServeAs(newMcpHandler(registry, &mcpToolCounts{}, &fakeBudget{left: 1}, quiet), writer())
	if res := call(h); res["isError"] == true {
		t.Fatalf("first call by a writer refused: %v", res)
	}
	if res := call(h); res["isError"] != true || !strings.HasPrefix(resultText(res), "write_rate_limited:") {
		t.Fatalf("second call = %v, want write_rate_limited", res)
	}
}

// Writes count against the grant's budget; reads never do.
func TestMcpWriteBudget(t *testing.T) {
	var ran []string
	var via audit.Via
	budget := &fakeBudget{left: 1}
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), counts, budget, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	call := func(tool string) map[string]any {
		out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"`+tool+`","arguments":{}}}`)
		res, _ := out["result"].(map[string]any)
		return res
	}
	if res := call("poke"); res["isError"] == true {
		t.Fatalf("first write refused: %v", res)
	}
	if res := call("poke"); res["isError"] != true || !strings.HasPrefix(resultText(res), "write_rate_limited:") {
		t.Fatalf("second write = %v, want write_rate_limited", res)
	}
	if res := call("peek"); res["isError"] == true {
		t.Fatalf("read refused by the write budget: %v", res)
	}
	if strings.Join(ran, ",") != "poke,peek" {
		t.Fatalf("ran = %v", ran)
	}
	if !strings.Contains(counts.joined(), "poke/refused") {
		t.Fatalf("metrics = %s, want poke/refused", counts.joined())
	}
}

// The tool runs with the app named on the audit provenance.
func TestMcpCallCarriesTheVia(t *testing.T) {
	var ran []string
	var via audit.Via
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"poke","arguments":{}}}`)
	if via != (audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"}) {
		t.Fatalf("via = %+v", via)
	}
}

// A refusal the service names (McpToolError) reaches the model as its code
// and message, never as "temporarily unavailable".
func TestMcpToolErrorsReachTheModel(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	registry := ai.Registry{{Name: "stale", Title: "Stale", Description: "x", Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: schema,
		Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
			return nil, service.McpToolError{Code: "revision_conflict", Msg: "someone changed it; current revision is 7"}
		}}}
	h := mcpServeAs(newMcpHandler(registry, &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"stale","arguments":{}}}`)
	res, _ := out["result"].(map[string]any)
	if res["isError"] != true || resultText(res) != "revision_conflict: someone changed it; current revision is 7" {
		t.Fatalf("result = %v", out)
	}
}
