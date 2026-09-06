package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Ollama speaks /api/chat of a local or on-prem Ollama daemon.
type Ollama struct {
	baseURL string
	http    *http.Client
}

func NewOllama(baseURL string, timeout time.Duration) *Ollama {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	return &Ollama{baseURL: strings.TrimSuffix(baseURL, "/"), http: &http.Client{Timeout: timeout}}
}

func (o *Ollama) Name() string { return "ollama" }

func (o *Ollama) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	msgs := make([]map[string]string, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, map[string]string{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}
	body := map[string]any{
		"model": req.Model, "messages": msgs, "stream": false,
		"options": map[string]any{"num_predict": req.MaxTokens, "temperature": req.Temperature},
	}
	if len(req.JSONSchema) > 0 {
		body["format"] = json.RawMessage(req.JSONSchema)
	}
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, 0, len(req.Tools))
		for _, t := range req.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{
				"name": t.Name, "description": t.Description, "parameters": json.RawMessage(t.Schema),
			}})
		}
		body["tools"] = tools
	}
	var out struct {
		Model   string `json:"model"`
		Message struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Function struct {
					Name      string          `json:"name"`
					Arguments json.RawMessage `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
		DoneReason      string `json:"done_reason"`
		PromptEvalCount int    `json:"prompt_eval_count"`
		EvalCount       int    `json:"eval_count"`
	}
	if err := postJSON(ctx, o.http, o.baseURL+"/api/chat", "", body, &out); err != nil {
		return CompletionResponse{}, err
	}
	resp := CompletionResponse{
		Text: out.Message.Content, Model: out.Model, StopReason: out.DoneReason,
		InputTokens: out.PromptEvalCount, OutputTokens: out.EvalCount,
	}
	for _, tc := range out.Message.ToolCalls {
		resp.ToolCalls = append(resp.ToolCalls, ToolCall{Name: tc.Function.Name, Input: tc.Function.Arguments})
	}
	return resp, nil
}

func (o *Ollama) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}
