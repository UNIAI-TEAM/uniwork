package provider

import (
	"bytes"
	"context"
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
	Role      string        `json:"role"`
	Content   string        `json:"content,omitempty"`
	ToolCalls []oaiToolCall `json:"tool_calls,omitempty"`
}

type oaiToolCall struct {
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func (o *OpenAI) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	body := map[string]any{"model": req.Model, "max_tokens": req.MaxTokens}
	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}
	msgs := make([]oaiMessage, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, oaiMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		msgs = append(msgs, oaiMessage{Role: m.Role, Content: m.Content})
	}
	body["messages"] = msgs
	if len(req.JSONSchema) > 0 {
		body["response_format"] = map[string]any{
			"type":        "json_schema",
			"json_schema": map[string]any{"name": "output", "schema": json.RawMessage(req.JSONSchema)},
		}
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
		Choices []struct {
			Message      oaiMessage `json:"message"`
			FinishReason string     `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
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
		InputTokens: out.Usage.PromptTokens, OutputTokens: out.Usage.CompletionTokens,
	}
	for _, tc := range c.Message.ToolCalls {
		resp.ToolCalls = append(resp.ToolCalls, ToolCall{Name: tc.Function.Name, Input: json.RawMessage(tc.Function.Arguments)})
	}
	return resp, nil
}

func (o *OpenAI) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}

// postJSON is shared by the HTTP adapters. A non-2xx status is an error
// carrying the vendor's status code and the first bytes of its body, which
// is what an operator needs and nothing a log should not hold.
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
		snippet := string(data)
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return fmt.Errorf("provider: %s → %d: %s", url, res.StatusCode, snippet)
	}
	return json.Unmarshal(data, out)
}
