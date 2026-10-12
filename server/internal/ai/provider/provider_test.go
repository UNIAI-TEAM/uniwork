package provider

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOpenAIComplete(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer k" {
			t.Errorf("bad request %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"model":"gpt-4o","choices":[{"message":{"content":"hi","tool_calls":[{"function":{"name":"search_workspace","arguments":"{\"q\":\"x\"}"}}]},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}`))
	}))
	defer srv.Close()
	p := NewOpenAI(srv.URL+"/v1/", "k", time.Second)
	resp, err := p.Complete(context.Background(), CompletionRequest{
		Model: "gpt-4o", System: "sys", MaxTokens: 10, JSONSchema: json.RawMessage(`{"type":"object"}`),
		Messages: []Message{{Role: "user", Content: "q"}},
		Tools:    []ToolSpec{{Name: "search_workspace", Schema: json.RawMessage(`{"type":"object"}`)}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != "hi" || resp.InputTokens != 7 || resp.OutputTokens != 3 || resp.Model != "gpt-4o" {
		t.Fatalf("%+v", resp)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "search_workspace" || string(resp.ToolCalls[0].Input) != `{"q":"x"}` {
		t.Fatalf("tool calls %+v", resp.ToolCalls)
	}
	msgs := got["messages"].([]any)
	if len(msgs) != 2 || msgs[0].(map[string]any)["role"] != "system" {
		t.Fatalf("messages %v", msgs)
	}
	if got["response_format"] == nil {
		t.Fatalf("schema not sent: %v", got)
	}
	rf := got["response_format"].(map[string]any)
	js := rf["json_schema"].(map[string]any)
	if js["strict"] != true {
		t.Fatalf("expected strict schema, got %v", js)
	}
	// Tools must not ship alongside json_schema (OpenAI rejects / returns empty).
	if got["tools"] != nil {
		t.Fatalf("tools must be omitted when JSONSchema is set: %v", got["tools"])
	}
}

func TestOpenAIErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"error":"slow down"}`))
	}))
	defer srv.Close()
	_, err := NewOpenAI(srv.URL, "", time.Second).Complete(context.Background(), CompletionRequest{Model: "m"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestOllamaComplete(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Errorf("path %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["stream"] != false || body["format"] == nil {
			t.Errorf("body %v", body)
		}
		_, _ = w.Write([]byte(`{"model":"llama3.1","message":{"role":"assistant","content":"{\"a\":1}"},"done_reason":"stop","prompt_eval_count":11,"eval_count":5}`))
	}))
	defer srv.Close()
	resp, err := NewOllama(srv.URL, time.Second).Complete(context.Background(), CompletionRequest{
		Model: "llama3.1", Messages: []Message{{Role: "user", Content: "q"}}, JSONSchema: json.RawMessage(`{"type":"object"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Text != `{"a":1}` || resp.InputTokens != 11 || resp.OutputTokens != 5 || resp.StopReason != "stop" {
		t.Fatalf("%+v", resp)
	}
}

func TestEmbedUnsupported(t *testing.T) {
	for _, p := range []Provider{NewAnthropic("k"), NewOpenAI("", "", time.Second), NewOllama("", time.Second), &Fake{}} {
		if _, err := p.Embed(context.Background(), EmbedRequest{}); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("%s: %v", p.Name(), err)
		}
	}
}

func TestFakeEchoes(t *testing.T) {
	f := &Fake{}
	resp, err := f.Complete(context.Background(), CompletionRequest{Model: "m", Messages: []Message{{Role: "user", Content: "hello"}}})
	if err != nil || resp.Text != "hello" || resp.Model != "m" || f.Calls != 1 {
		t.Fatalf("%+v %v", resp, err)
	}
}

// ---- Tool-result loop (G6-02 spike, UNI-1364) ------------------------------

// TestOpenAIToolResultLoop pins the wire shape of one tool loop: the id the
// model returned is the tool_call_id the next request sends back, and the
// assistant call is replayed ahead of its result.
func TestOpenAIToolResultLoop(t *testing.T) {
	var calls []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		calls = append(calls, body)
		if len(calls) == 1 {
			_, _ = w.Write([]byte(`{"model":"m","choices":[{"message":{"role":"assistant","content":"","tool_calls":[{"id":"call_abc","type":"function","function":{"name":"get_cell","arguments":"{\"cell\":\"A1\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":4}}`))
			return
		}
		_, _ = w.Write([]byte(`{"model":"m","choices":[{"message":{"role":"assistant","content":"A1 is 42"},"finish_reason":"stop"}],"usage":{"prompt_tokens":22,"completion_tokens":5}}`))
	}))
	defer srv.Close()
	p := NewOpenAI(srv.URL, "k", time.Second)
	tools := []ToolSpec{{Name: "get_cell", Schema: json.RawMessage(`{"type":"object"}`)}}
	first, err := p.Complete(context.Background(), CompletionRequest{
		Model: "m", MaxTokens: 32, Messages: []Message{{Role: "user", Content: "what is in A1?"}}, Tools: tools,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID != "call_abc" || first.ToolCalls[0].Name != "get_cell" ||
		string(first.ToolCalls[0].Input) != `{"cell":"A1"}` || !first.UsagePresent {
		t.Fatalf("first response %+v", first)
	}
	second, err := p.Complete(context.Background(), CompletionRequest{
		Model: "m", MaxTokens: 32, Tools: tools,
		Messages: []Message{
			{Role: "user", Content: "what is in A1?"},
			{Role: "assistant", ToolCalls: first.ToolCalls},
			{Role: "tool", ToolCallID: first.ToolCalls[0].ID, Content: `{"value":42}`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Text != "A1 is 42" || len(calls) != 2 {
		t.Fatalf("second response %+v calls %d", second, len(calls))
	}
	msgs := calls[1]["messages"].([]any)
	if len(msgs) != 3 {
		t.Fatalf("messages %v", msgs)
	}
	replayed := msgs[1].(map[string]any)
	tcs, ok := replayed["tool_calls"].([]any)
	if !ok || len(tcs) != 1 || tcs[0].(map[string]any)["id"] != "call_abc" {
		t.Fatalf("assistant replay lost the tool-call id: %v", replayed)
	}
	if fn := tcs[0].(map[string]any)["function"].(map[string]any); fn["arguments"] != `{"cell":"A1"}` {
		t.Fatalf("assistant replay lost the arguments: %v", fn)
	}
	tool := msgs[2].(map[string]any)
	if tool["role"] != "tool" || tool["tool_call_id"] != "call_abc" || tool["content"] != `{"value":42}` {
		t.Fatalf("tool result message %v", tool)
	}
}

// TestOpenAIUsageAbsent: a vendor that answers without a usage block must be
// reported as unknown, not as zero tokens (spec §8.2).
func TestOpenAIUsageAbsent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"model":"m","choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}`))
	}))
	defer srv.Close()
	resp, err := NewOpenAI(srv.URL, "", time.Second).Complete(context.Background(), CompletionRequest{Model: "m"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.UsagePresent || resp.InputTokens != 0 || resp.OutputTokens != 0 {
		t.Fatalf("absent usage must be flagged, got %+v", resp)
	}
}

// TestFakeToolLoop: the fake scripts one deterministic call, then answers once
// its result is in the history — the no-network shape of the same loop.
func TestFakeToolLoop(t *testing.T) {
	f := &Fake{}
	tools := []ToolSpec{{Name: "get_cell", Schema: json.RawMessage(`{"type":"object"}`)}}
	first, err := f.Complete(context.Background(), CompletionRequest{
		Model: "m", Messages: []Message{{Role: "user", Content: "what is in A1?"}}, Tools: tools,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID == "" || first.ToolCalls[0].Name != "get_cell" {
		t.Fatalf("scripted call %+v", first.ToolCalls)
	}
	second, err := f.Complete(context.Background(), CompletionRequest{
		Model: "m", Tools: tools,
		Messages: []Message{
			{Role: "user", Content: "what is in A1?"},
			{Role: "assistant", ToolCalls: first.ToolCalls},
			{Role: "tool", ToolCallID: first.ToolCalls[0].ID, Content: `{"value":42}`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.ToolCalls) != 0 {
		t.Fatalf("the loop must end on a final answer: %+v", second.ToolCalls)
	}
	if !strings.Contains(second.Text, first.ToolCalls[0].ID) {
		t.Fatalf("answer must echo the id it received: %q", second.Text)
	}
}

// TestAnthropicToolResultLoop pins the Messages API mapping: tool_use.id
// round-trips, and a role "tool" message becomes a tool_result block on the
// following user turn.
func TestAnthropicToolResultLoop(t *testing.T) {
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		if len(bodies) == 1 {
			_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"claude-x","content":[{"type":"tool_use","id":"toolu_1","name":"get_cell","input":{"cell":"A1"}}],"stop_reason":"tool_use","usage":{"input_tokens":9,"output_tokens":3}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"msg_2","type":"message","role":"assistant","model":"claude-x","content":[{"type":"text","text":"A1 is 42"}],"stop_reason":"end_turn","usage":{"input_tokens":19,"output_tokens":6}}`))
	}))
	defer srv.Close()
	a := &Anthropic{client: anthropic.NewClient(option.WithAPIKey("k"), option.WithBaseURL(srv.URL), option.WithMaxRetries(0))}
	tools := []ToolSpec{{Name: "get_cell", Description: "read a cell", Schema: json.RawMessage(`{"type":"object"}`)}}
	first, err := a.Complete(context.Background(), CompletionRequest{
		Model: "claude-x", MaxTokens: 64, Messages: []Message{{Role: "user", Content: "what is in A1?"}}, Tools: tools,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ToolCalls[0].ID != "toolu_1" || first.ToolCalls[0].Name != "get_cell" ||
		string(first.ToolCalls[0].Input) != `{"cell":"A1"}` {
		t.Fatalf("first response %+v", first)
	}
	if !first.UsagePresent || first.InputTokens != 9 || first.OutputTokens != 3 {
		t.Fatalf("usage %+v", first)
	}
	second, err := a.Complete(context.Background(), CompletionRequest{
		Model: "claude-x", MaxTokens: 64, Tools: tools,
		Messages: []Message{
			{Role: "user", Content: "what is in A1?"},
			{Role: "assistant", ToolCalls: first.ToolCalls},
			{Role: "tool", ToolCallID: first.ToolCalls[0].ID, Content: `{"value":42}`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.Text != "A1 is 42" || len(bodies) != 2 {
		t.Fatalf("second response %+v bodies %d", second, len(bodies))
	}
	msgs := bodies[1]["messages"].([]any)
	if len(msgs) != 3 {
		t.Fatalf("messages %v", msgs)
	}
	asst := msgs[1].(map[string]any)
	if asst["role"] != "assistant" {
		t.Fatalf("assistant %v", asst)
	}
	use := asst["content"].([]any)[0].(map[string]any)
	if use["type"] != "tool_use" || use["id"] != "toolu_1" || use["name"] != "get_cell" {
		t.Fatalf("tool_use %v", use)
	}
	res := msgs[2].(map[string]any)
	if res["role"] != "user" {
		t.Fatalf("a tool result must ride a user turn: %v", res)
	}
	block := res["content"].([]any)[0].(map[string]any)
	if block["type"] != "tool_result" || block["tool_use_id"] != "toolu_1" {
		t.Fatalf("tool_result %v", block)
	}
	if text := block["content"].([]any)[0].(map[string]any); text["text"] != `{"value":42}` {
		t.Fatalf("tool_result content %v", text)
	}
}

// TestOllamaRefusesToolMessages: this adapter has no tool-result turn, so it
// refuses the shape instead of sending a request the daemon cannot read.
func TestOllamaRefusesToolMessages(t *testing.T) {
	for _, msgs := range [][]Message{
		{{Role: "tool", ToolCallID: "call_1", Content: "42"}},
		{{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Name: "get_cell"}}}},
	} {
		if _, err := NewOllama("", time.Second).Complete(context.Background(), CompletionRequest{Model: "m", Messages: msgs}); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("messages %v: %v", msgs, err)
		}
	}
}
