package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// How a tool outcome becomes an MCP result, and which label the metrics count
// it under. No database: the mapping is the transport's own.
func TestMcpToolResultMapping(t *testing.T) {
	const notFound = "not found or not accessible"
	for name, c := range map[string]struct {
		out        string
		err        error
		outcome    string
		text       string
		structured map[string]any
		isError    bool
	}{
		"object":      {out: `{"a":1}`, outcome: "ok", text: `{"a":1}`, structured: map[string]any{"a": float64(1)}},
		"array":       {out: `[1,2]`, outcome: "ok", text: `[1,2]`, structured: map[string]any{"items": []any{float64(1), float64(2)}}},
		"empty array": {out: `[]`, outcome: "ok", text: `[]`, structured: map[string]any{"items": []any{}}},
		"null":        {out: `null`, outcome: "ok", text: `null`},
		"scalar":      {out: `"s"`, outcome: "ok", text: `"s"`},
		"not json":    {out: `not json`, outcome: "ok", text: `not json`},

		"invalid arguments":             {err: service.McpInvalidArgs{Msg: "x is required"}, outcome: "invalid", text: "invalid arguments: x is required", isError: true},
		"wrapped invalid arguments":     {err: fmt.Errorf("decode: %w", service.McpInvalidArgs{Msg: "y"}), outcome: "invalid", text: "invalid arguments: y", isError: true},
		"not found":                     {err: service.ErrNotFound, outcome: "not_found", text: notFound, isError: true},
		"forbidden":                     {err: service.ErrForbidden, outcome: "not_found", text: notFound, isError: true},
		"wrapped not found":             {err: fmt.Errorf("read: %w", service.ErrNotFound), outcome: "not_found", text: notFound, isError: true},
		"failure":                       {err: errors.New("pq: connection refused to 10.0.0.5"), outcome: "error", text: "temporarily unavailable", isError: true},
		"canceled under a live context": {err: context.Canceled, outcome: "error", text: "temporarily unavailable", isError: true},
	} {
		t.Run(name, func(t *testing.T) {
			outcome, res := mcpToolResult(context.Background(), json.RawMessage(c.out), c.err)
			if outcome != c.outcome || res.IsError != c.isError {
				t.Fatalf("outcome %q isError %v, want %q %v", outcome, res.IsError, c.outcome, c.isError)
			}
			raw, _ := json.Marshal(res)
			var wire struct {
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
				Structured map[string]any `json:"structuredContent"`
			}
			if err := json.Unmarshal(raw, &wire); err != nil || len(wire.Content) != 1 || wire.Content[0].Text != c.text {
				t.Fatalf("result = %s (%v), want one text %q", raw, err, c.text)
			}
			if fmt.Sprint(wire.Structured) != fmt.Sprint(c.structured) {
				t.Fatalf("structuredContent = %v, want %v", wire.Structured, c.structured)
			}
		})
	}
}

func mcpServeAs(h http.Handler, p service.McpPrincipal) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.ServeHTTP(w, r.WithContext(mcpCallContext(r, p)))
	})
}

func mcpDirectCall(t *testing.T, h http.Handler, body string) map[string]any {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	raw, _ := io.ReadAll(rec.Body)
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("%d %q: %v", rec.Code, raw, err)
	}
	return out
}

type mcpToolCounts struct {
	mu    sync.Mutex
	calls []string
}

func (m *mcpToolCounts) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.calls)
}

func (m *mcpToolCounts) joined() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return strings.Join(m.calls, ",")
}

func (m *mcpToolCounts) IncOAuth(string) {}
func (m *mcpToolCounts) ObserveTool(tool, outcome string, _ time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, tool+"/"+outcome)
}

// The principal the gate put on the context is the actor the tool runs as, and
// a failure the model cannot fix is logged with ids and the error, never with
// the arguments the model sent.
func TestMcpHandlerRunsToolsAsThePrincipalAndLogsFailuresWithoutArguments(t *testing.T) {
	var seen ai.ToolContext
	var seenArgs string
	registry := ai.Registry{{
		Name: "boom", Description: "fails", Kind: ai.ToolRead, Risk: ai.RiskLow,
		Schema: json.RawMessage(`{"type":"object","properties":{"secret":{"type":"string"}}}`),
		Handle: func(_ context.Context, tc ai.ToolContext, input json.RawMessage) (json.RawMessage, error) {
			seen, seenArgs = tc, string(input)
			return nil, errors.New("db down")
		},
	}}
	var logs bytes.Buffer
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(registry, counts, slog.New(slog.NewTextHandler(&logs, nil))),
		service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", ClientID: "c1"})

	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"boom","arguments":{"secret":"hunter2"}}}`)
	result, _ := out["result"].(map[string]any)
	if result["isError"] != true || resultText(result) != "temporarily unavailable" {
		t.Fatalf("result = %v", out)
	}
	if seen.ActorID != "u1" || seen.OrganizationID != "o1" || seen.ActorKind != "human" || seen.WorkspaceID != "" {
		t.Errorf("tool ran as %+v", seen)
	}
	if !strings.Contains(seenArgs, "hunter2") {
		t.Errorf("tool received %q, want the model's arguments", seenArgs)
	}
	line := logs.String()
	for _, want := range []string{"mcp tool", "tool=boom", "grant_id=g1", "db down"} {
		if !strings.Contains(line, want) {
			t.Errorf("log %q lacks %q", line, want)
		}
	}
	for _, leak := range []string{"hunter2", "secret"} {
		if strings.Contains(line, leak) {
			t.Errorf("log carries the arguments (%q): %s", leak, line)
		}
	}
	if strings.Join(counts.calls, ",") != "boom/error" {
		t.Errorf("metrics = %v", counts.calls)
	}
}

// A model's mistake and a missing item are results the model reads; neither is
// an error line in the log nor a failure in the metrics.
func TestMcpHandlerDoesNotLogWhatTheModelCanFix(t *testing.T) {
	registry := ai.Registry{
		{Name: "bad", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
			return nil, service.McpInvalidArgs{Msg: "nope"}
		}},
		{Name: "gone", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
			return nil, service.ErrNotFound
		}},
	}
	var logs bytes.Buffer
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(registry, counts, slog.New(slog.NewTextHandler(&logs, nil))), service.McpPrincipal{UserID: "u1", OrganizationID: "o1"})
	mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"bad","arguments":{}}}`)
	mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gone","arguments":{}}}`)
	if logs.Len() != 0 {
		t.Errorf("log = %q, want nothing", logs.String())
	}
	if got := strings.Join(counts.calls, ","); got != "bad/invalid,gone/not_found" {
		t.Errorf("metrics = %s", got)
	}
}

// Without a principal on the context (a wiring bug, never a client's doing)
// the call runs nothing: it fails closed instead of running as nobody.
func TestMcpHandlerWithoutAPrincipalRunsNothing(t *testing.T) {
	ran := false
	registry := ai.Registry{{Name: "who", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
		ran = true
		return json.RawMessage(`{}`), nil
	}}}
	var logs bytes.Buffer
	counts := &mcpToolCounts{}
	h := newMcpHandler(registry, counts, slog.New(slog.NewTextHandler(&logs, nil)))
	for name, handler := range map[string]http.Handler{
		"no principal":           h,
		"principal without user": mcpServeAs(h, service.McpPrincipal{OrganizationID: "o1"}),
		"principal without org":  mcpServeAs(h, service.McpPrincipal{UserID: "u1"}),
	} {
		out := mcpDirectCall(t, handler, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"who","arguments":{}}}`)
		result, _ := out["result"].(map[string]any)
		if result["isError"] != true || resultText(result) != "temporarily unavailable" {
			t.Errorf("%s: result = %v", name, out)
		}
	}
	if ran {
		t.Fatal("a tool ran without a principal")
	}
	if !strings.Contains(logs.String(), "mcp tool without a principal") || strings.Join(counts.calls, ",") != "who/error,who/error,who/error" {
		t.Errorf("log %q, metrics %v", logs.String(), counts.calls)
	}
}

func TestMcpHandlerRefusesAToolWithABrokenSchema(t *testing.T) {
	defer func() {
		if r := recover(); r == nil || !strings.Contains(fmt.Sprint(r), "broken") {
			t.Fatalf("recover = %v, want a panic naming the tool", r)
		}
	}()
	newMcpHandler(ai.Registry{{Name: "broken", Schema: json.RawMessage(`{`)}}, &mcpToolCounts{}, nil)
}

// The SDK runs a tool on a goroutine of its own, outside the HTTP middleware
// that recovers panics for every other route: a panic in a tool would end the
// process for every tenant. The transport turns it into the "temporarily
// unavailable" result and logs it with the tool's name and a stack.
func TestMcpHandlerSurvivesAPanickingTool(t *testing.T) {
	registry := ai.Registry{{Name: "panics", Kind: ai.ToolRead, Schema: json.RawMessage(`{"type":"object"}`), Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
		panic("tool bug hunter2")
	}}}
	var logs bytes.Buffer
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(registry, counts, slog.New(slog.NewTextHandler(&logs, nil))), service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1"})
	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"panics","arguments":{"secret":"hunter2"}}}`)
	result, _ := out["result"].(map[string]any)
	if result["isError"] != true || resultText(result) != "temporarily unavailable" {
		t.Fatalf("result = %v", out)
	}
	for _, want := range []string{"mcp tool panic", "tool=panics", "grant_id=g1", "panic=string", "mcp_transport"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log lacks %q: %s", want, logs.String())
		}
	}
	if strings.Contains(logs.String(), "hunter2") {
		t.Error("the log carries the arguments")
	}
	if strings.Join(counts.calls, ",") != "panics/error" {
		t.Errorf("metrics = %v", counts.calls)
	}
	// The server still answers.
	mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":2,"method":"ping"}`)
}
