package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const summarySchema = `{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}`

// anthropicStub answers every Messages call with reply and keeps each body.
func anthropicStub(t *testing.T, reply string) (*Anthropic, *[]map[string]any) {
	t.Helper()
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(srv.Close)
	return &Anthropic{client: anthropic.NewClient(option.WithAPIKey("k"), option.WithBaseURL(srv.URL), option.WithMaxRetries(0))}, &bodies
}

const endTurnReply = `{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[{"type":"text","text":"{\"summary\":\"S\"}"}],"stop_reason":"end_turn","usage":{"input_tokens":5,"output_tokens":2}}`

// TestAnthropicSendsTemperatureZero (M10): a policy temperature of 0 reaches
// a model that takes sampling parameters, and is left out for one that
// rejects them; a pinned schema is sent as a structured-output format.
func TestAnthropicSendsTemperatureZero(t *testing.T) {
	a, bodies := anthropicStub(t, endTurnReply)
	req := CompletionRequest{
		MaxTokens: 64, Temperature: 0, JSONSchema: json.RawMessage(summarySchema),
		Messages: []Message{{Role: "user", Content: "q"}},
	}
	for _, model := range []string{"claude-haiku-4-5-20251001", "claude-opus-5"} {
		req.Model = model
		if _, err := a.Complete(context.Background(), req); err != nil {
			t.Fatalf("%s: %v", model, err)
		}
	}
	haiku, opus := (*bodies)[0], (*bodies)[1]
	if temp, ok := haiku["temperature"]; !ok || temp != float64(0) {
		t.Fatalf("haiku temperature = %v (present %v), want 0", temp, ok)
	}
	if _, ok := opus["temperature"]; ok {
		t.Fatalf("claude-opus-5 rejects sampling parameters; temperature was sent: %v", opus["temperature"])
	}
	for name, body := range map[string]map[string]any{"haiku": haiku, "opus": opus} {
		cfg, _ := body["output_config"].(map[string]any)
		format, _ := cfg["format"].(map[string]any)
		schema, _ := format["schema"].(map[string]any)
		if format["type"] != "json_schema" || schema["additionalProperties"] != false {
			t.Fatalf("%s: output_config = %v", name, body["output_config"])
		}
	}
	// No schema, no output format: the free-text agent loop is unchanged.
	req.JSONSchema, req.Model = nil, "claude-opus-5"
	if _, err := a.Complete(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if _, ok := (*bodies)[2]["output_config"]; ok {
		t.Fatalf("free-text request carried output_config: %v", (*bodies)[2])
	}
}

// TestAnthropicMaxTokensIsTruncated: a structured answer stopped at the
// ceiling is ErrTruncated with its usage kept; a free-text one still returns.
func TestAnthropicMaxTokensIsTruncated(t *testing.T) {
	a, _ := anthropicStub(t, `{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[{"type":"text","text":"{\"summary\":\"cut"}],"stop_reason":"max_tokens","usage":{"input_tokens":5,"output_tokens":64}}`)
	req := CompletionRequest{Model: "claude-opus-5", MaxTokens: 64, JSONSchema: json.RawMessage(summarySchema), Messages: []Message{{Role: "user", Content: "q"}}}
	resp, err := a.Complete(context.Background(), req)
	if !errors.Is(err, ErrTruncated) || resp.OutputTokens != 64 || !resp.UsagePresent {
		t.Fatalf("resp %+v err %v", resp, err)
	}
	req.JSONSchema = nil
	if resp, err := a.Complete(context.Background(), req); err != nil || resp.StopReason != "max_tokens" {
		t.Fatalf("free text: %+v %v", resp, err)
	}
}

func TestAnthropicModelCapabilities(t *testing.T) {
	for model, want := range map[string]bool{
		"claude-haiku-4-5-20251001": true, "claude-sonnet-4-6": true, "claude-opus-4-6": true, "claude-3-5-haiku-latest": true,
		"claude-opus-5": false, "claude-sonnet-5": false, "claude-opus-4-7": false, "claude-opus-5-5": false, "claude-fable-5-1": false,
	} {
		if got := anthropicAcceptsSampling(model); got != want {
			t.Errorf("anthropicAcceptsSampling(%q) = %v, want %v", model, got, want)
		}
	}
	schema := json.RawMessage(summarySchema)
	for model, want := range map[string]bool{"claude-opus-5": true, "claude-haiku-4-5-20251001": true, "claude-3-5-haiku-latest": false, "claude-sonnet-4-20250514": false} {
		if _, got := anthropicOutputFormat(model, schema); got != want {
			t.Errorf("anthropicOutputFormat(%q) = %v, want %v", model, got, want)
		}
	}
	if _, ok := anthropicOutputFormat("claude-opus-5", json.RawMessage(`[]`)); ok {
		t.Error("a schema that is not an object must not be sent")
	}
}

// anthropicSeqStub answers the n-th call with replies[n] (the last one repeats).
func anthropicSeqStub(t *testing.T, replies ...string) (*Anthropic, *[]map[string]any) {
	t.Helper()
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		i := min(len(bodies), len(replies)-1)
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(replies[i]))
	}))
	t.Cleanup(srv.Close)
	return &Anthropic{client: anthropic.NewClient(option.WithAPIKey("k"), option.WithBaseURL(srv.URL), option.WithMaxRetries(0))}, &bodies
}

func TestAnthropicSendsEffortOnlyToModelsThatTakeIt(t *testing.T) {
	a, bodies := anthropicStub(t, endTurnReply)
	for _, c := range []struct{ model, effort string }{
		{"claude-sonnet-5-5", "medium"}, {"claude-haiku-4-5-20251001", "medium"}, {"claude-sonnet-5-5", ""},
	} {
		req := CompletionRequest{Model: c.model, Effort: c.effort, MaxTokens: 64, Messages: []Message{{Role: "user", Content: "q"}}}
		if _, err := a.Complete(context.Background(), req); err != nil {
			t.Fatal(err)
		}
	}
	cfg, _ := (*bodies)[0]["output_config"].(map[string]any)
	if cfg["effort"] != "medium" {
		t.Fatalf("sonnet-5-5 output_config = %v", (*bodies)[0]["output_config"])
	}
	for i, name := range map[int]string{1: "haiku-4-5", 2: "empty effort"} {
		cfg, _ := (*bodies)[i]["output_config"].(map[string]any)
		if _, ok := cfg["effort"]; ok {
			t.Fatalf("%s: effort was sent: %v", name, cfg)
		}
	}
}

func TestAnthropicStrictToolCarriesAdditionalPropertiesFalse(t *testing.T) {
	a, bodies := anthropicStub(t, endTurnReply)
	schema := json.RawMessage(`{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}`)
	for _, strict := range []bool{true, false} {
		req := CompletionRequest{Model: "claude-sonnet-5-5", MaxTokens: 64, Messages: []Message{{Role: "user", Content: "q"}},
			Tools: []ToolSpec{{Name: "t", Description: "d", Schema: schema, Strict: strict}}}
		if _, err := a.Complete(context.Background(), req); err != nil {
			t.Fatal(err)
		}
	}
	on := (*bodies)[0]["tools"].([]any)[0].(map[string]any)
	if on["strict"] != true || on["input_schema"].(map[string]any)["additionalProperties"] != false {
		t.Fatalf("strict tool = %v", on)
	}
	off := (*bodies)[1]["tools"].([]any)[0].(map[string]any)
	if _, ok := off["strict"]; ok {
		t.Fatalf("non-strict tool carried strict: %v", off)
	}
}

func TestAnthropicMarksCacheBreakpoints(t *testing.T) {
	a, bodies := anthropicStub(t, endTurnReply)
	req := CompletionRequest{Model: "claude-sonnet-5-5", System: "sys", MaxTokens: 64, Messages: []Message{
		{Role: "user", Content: "first"},
		{Role: "assistant", ToolCalls: []ToolCall{{ID: "tu1", Name: "t", Input: json.RawMessage(`{}`)}}},
		{Role: "tool", ToolCallID: "tu1", Content: "r1"},
		{Role: "tool", ToolCallID: "tu2", Content: "r2"},
	}}
	if _, err := a.Complete(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	body := (*bodies)[0]
	sys := body["system"].([]any)[0].(map[string]any)
	if cc, _ := sys["cache_control"].(map[string]any); cc["type"] != "ephemeral" {
		t.Fatalf("system block = %v", sys)
	}
	msgs := body["messages"].([]any)
	marked := 0
	for mi, m := range msgs {
		blocks := m.(map[string]any)["content"].([]any)
		for bi, b := range blocks {
			if _, ok := b.(map[string]any)["cache_control"]; ok {
				marked++
				if mi != len(msgs)-1 || bi != len(blocks)-1 {
					t.Fatalf("cache_control on message %d block %d", mi, bi)
				}
			}
		}
	}
	if marked != 1 {
		t.Fatalf("%d message blocks carry cache_control, want 1: %v", marked, msgs)
	}
}

func TestAnthropicReplaysRawAssistantTurn(t *testing.T) {
	first := `{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[{"type":"thinking","thinking":"","signature":"sig-1"},{"type":"tool_use","id":"tu1","name":"t","input":{"a":1}}],"stop_reason":"tool_use","usage":{"input_tokens":5,"output_tokens":2}}`
	a, bodies := anthropicSeqStub(t, first, endTurnReply)
	tools := []ToolSpec{{Name: "t", Schema: json.RawMessage(`{"type":"object"}`)}}
	user := Message{Role: "user", Content: "q"}
	r1, err := a.Complete(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64, Tools: tools, Messages: []Message{user}})
	if err != nil {
		t.Fatal(err)
	}
	if r1.Raw == nil || r1.ToolCalls[0].ID != "tu1" {
		t.Fatalf("resp %+v", r1)
	}
	_, err = a.Complete(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64, Tools: tools, Messages: []Message{
		user,
		{Role: "assistant", Raw: r1.Raw, ToolCalls: r1.ToolCalls},
		{Role: "tool", ToolCallID: "tu1", Content: "ok"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	content := (*bodies)[1]["messages"].([]any)[1].(map[string]any)["content"].([]any)
	th := content[0].(map[string]any)
	if th["type"] != "thinking" || th["thinking"] != "" || th["signature"] != "sig-1" {
		t.Fatalf("thinking block not replayed verbatim: %v", th)
	}
	if content[1].(map[string]any)["id"] != "tu1" {
		t.Fatalf("tool_use = %v", content[1])
	}
}

func TestAnthropicReadsCacheTokens(t *testing.T) {
	a, _ := anthropicStub(t, `{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"cache_read_input_tokens":300,"cache_creation_input_tokens":40,"output_tokens":5}}`)
	resp, err := a.Complete(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64, Messages: []Message{{Role: "user", Content: "q"}}})
	if err != nil {
		t.Fatal(err)
	}
	if resp.InputTokens != 10 || resp.CacheReadTokens != 300 || resp.CacheWriteTokens != 40 || resp.OutputTokens != 5 {
		t.Fatalf("usage %+v", resp)
	}
}

func TestAnthropicRefusalKeepsUsage(t *testing.T) {
	a, _ := anthropicStub(t, `{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[],"stop_reason":"refusal","usage":{"input_tokens":12,"output_tokens":3}}`)
	resp, err := a.Complete(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64, Messages: []Message{{Role: "user", Content: "q"}}})
	if !errors.Is(err, ErrRefused) || resp.InputTokens != 12 || !resp.UsagePresent {
		t.Fatalf("resp %+v err %v", resp, err)
	}
}
