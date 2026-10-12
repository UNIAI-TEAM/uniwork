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
	msgs := make([]any, 0, len(req.Messages)+1)
	if req.System != "" {
		msgs = append(msgs, oaiMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		if len(m.Parts) == 0 {
			msgs = append(msgs, oaiMessage{Role: m.Role, Content: m.Content})
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
