package provider

import (
	"context"
	"encoding/json"
	"errors"
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
	if got["response_format"] == nil || got["tools"] == nil {
		t.Fatalf("schema/tools not sent: %v", got)
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
