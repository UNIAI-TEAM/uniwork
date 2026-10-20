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
