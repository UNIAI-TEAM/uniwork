package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAI speaks the chat-completions wire format, which OpenAI, Gemini's
// OpenAI-compatible endpoint, vLLM and most gateways implement. Changing
// BASE_URL is the whole vendor switch; no SDK, one POST.
type OpenAI struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewOpenAI(baseURL, apiKey string, timeout time.Duration) *OpenAI {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	return &OpenAI{baseURL: strings.TrimSuffix(baseURL, "/"), apiKey: apiKey, http: &http.Client{Timeout: timeout}}
}

func (o *OpenAI) Name() string { return "openai" }

type oaiMessage struct {
	Role string `json:"role"`
	// Content is untyped so a role "tool" message always carries it (OpenAI
	// rejects a tool message without content) while an empty assistant or
	// user content stays omitted, as before.
	Content any `json:"content,omitempty"`
	// ToolCalls replays the assistant's request (id + function) so the tool
	// result below it has something to answer.
	ToolCalls []oaiToolCall `json:"tool_calls,omitempty"`
	// ToolCallID is set on a role "tool" message and names the call it answers.
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// oaiResponseMessage is the answer side of a message: Content is always text
// there (the untyped request field exists only for role "tool").
type oaiResponseMessage struct {
	Content   string        `json:"content"`
	ToolCalls []oaiToolCall `json:"tool_calls"`
}

type oaiToolCall struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func (o *OpenAI) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	// stream is explicit: an upstream that reads a missing field as true
	// answers in SSE, which this JSON reader cannot parse (spike G6-02 §8.1).
	body := map[string]any{"model": req.Model, "max_tokens": req.MaxTokens, "stream": false}
	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}
	msgs := make([]any, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, oaiMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		msg := oaiMessage{Role: m.Role, ToolCallID: m.ToolCallID}
		if m.Content != "" || m.Role == "tool" {
			msg.Content = m.Content
		}
		for _, tc := range m.ToolCalls {
			var call oaiToolCall
			call.ID, call.Type = tc.ID, "function"
			call.Function.Name, call.Function.Arguments = tc.Name, string(tc.Input)
			msg.ToolCalls = append(msg.ToolCalls, call)
		}
		if len(m.Parts) == 0 {
			msgs = append(msgs, msg)
			continue
		}
		content := make([]map[string]any, 0, len(m.Parts)+1)
		for _, p := range m.Parts {
			c, err := openAIPart(p)
			if err != nil {
				return CompletionResponse{}, err
			}
			content = append(content, c)
		}
		content = append(content, map[string]any{"type": "text", "text": m.Content})
		msgs = append(msgs, map[string]any{"role": m.Role, "content": content})
	}
	body["messages"] = msgs
	if len(req.JSONSchema) > 0 {
		body["response_format"] = map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   "output",
				"strict": true,
				"schema": json.RawMessage(req.JSONSchema),
			},
		}
	}
	// Tools + json_schema together are rejected by OpenAI; gateway already omits
	// tools when a schema is set. Keep this guard for direct callers.
	if len(req.Tools) > 0 && len(req.JSONSchema) == 0 {
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
		Choices []struct {
			Message      oaiResponseMessage `json:"message"`
			FinishReason string             `json:"finish_reason"`
		} `json:"choices"`
		// Kept raw so an absent usage block stays distinguishable from a
		// present one with zero tokens (spec §8.2).
		Usage json.RawMessage `json:"usage"`
	}
	if err := postJSON(ctx, o.http, o.baseURL+"/chat/completions", o.apiKey, body, &out); err != nil {
		return CompletionResponse{}, err
	}
	if len(out.Choices) == 0 {
		return CompletionResponse{}, fmt.Errorf("openai: empty choices")
	}
	c := out.Choices[0]
	resp := CompletionResponse{
		Text: c.Message.Content, Model: out.Model, StopReason: c.FinishReason,
	}
	if len(out.Usage) > 0 && string(out.Usage) != "null" {
		var usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		}
		if err := json.Unmarshal(out.Usage, &usage); err != nil {
			return CompletionResponse{}, fmt.Errorf("openai: unreadable usage: %w", err)
		}
		resp.UsagePresent = true
		resp.InputTokens, resp.OutputTokens = usage.PromptTokens, usage.CompletionTokens
	}
	for _, tc := range c.Message.ToolCalls {
		resp.ToolCalls = append(resp.ToolCalls, ToolCall{
			ID: tc.ID, Name: tc.Function.Name, Input: json.RawMessage(tc.Function.Arguments),
		})
	}
	return resp, nil
}

// openAIPart maps a media part onto chat-completions content: images as data
// URLs, wav/mp3 as input_audio (audio-capable models only). Anything else is
// refused, never silently dropped.
func openAIPart(p Part) (map[string]any, error) {
	data := base64.StdEncoding.EncodeToString(p.Data)
	switch p.MIME {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + p.MIME + ";base64," + data}}, nil
	case "audio/wav", "audio/x-wav", "audio/wave":
		return map[string]any{"type": "input_audio", "input_audio": map[string]any{"data": data, "format": "wav"}}, nil
	case "audio/mpeg", "audio/mp3":
		return map[string]any{"type": "input_audio", "input_audio": map[string]any{"data": data, "format": "mp3"}}, nil
	}
	return nil, ErrUnsupportedMedia
}

func (o *OpenAI) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}

// postJSON is shared by the HTTP adapters. A non-2xx status is a
// *StatusError carrying the vendor's status, Retry-After and the first bytes
// of its body.
func postJSON(ctx context.Context, client *http.Client, url, bearer string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return &StatusError{Status: res.StatusCode, RetryAfter: retryAfter(res.Header, time.Now()), URL: url, Detail: snippet(data)}
	}
	return json.Unmarshal(data, out)
}
