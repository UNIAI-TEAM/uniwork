package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Stream is Complete over SSE. The HTTP client has no overall timeout (it
// would cut a long answer); ctx bounds the call.
func (o *OpenAI) Stream(ctx context.Context, req CompletionRequest, onDelta func(string)) (CompletionResponse, error) {
	body, err := o.body(req)
	if err != nil {
		return CompletionResponse{}, err
	}
	body["stream"] = true
	body["stream_options"] = map[string]any{"include_usage": true}
	b, err := json.Marshal(body)
	if err != nil {
		return CompletionResponse{}, err
	}
	url := o.baseURL + "/chat/completions"
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return CompletionResponse{}, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	hreq.Header.Set("Accept", "text/event-stream")
	if o.apiKey != "" {
		hreq.Header.Set("Authorization", "Bearer "+o.apiKey)
	}
	res, err := (&http.Client{Transport: o.http.Transport}).Do(hreq)
	if err != nil {
		return CompletionResponse{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 4<<10))
		return CompletionResponse{}, &StatusError{Status: res.StatusCode, RetryAfter: retryAfter(res.Header, time.Now()), URL: url, Detail: snippet(data)}
	}

	var text strings.Builder
	var calls []*oaiToolCall
	resp := CompletionResponse{}
	done := false
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "[DONE]" {
			done = true
			break
		}
		var chunk struct {
			Model   string `json:"model"`
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index int `json:"index"`
						oaiToolCall
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Usage json.RawMessage `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return CompletionResponse{}, fmt.Errorf("openai: unreadable stream chunk: %w", err)
		}
		if chunk.Model != "" {
			resp.Model = chunk.Model
		}
		if len(chunk.Usage) > 0 && string(chunk.Usage) != "null" {
			var u struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			}
			if err := json.Unmarshal(chunk.Usage, &u); err != nil {
				return CompletionResponse{}, fmt.Errorf("openai: unreadable usage: %w", err)
			}
			resp.UsagePresent, resp.InputTokens, resp.OutputTokens = true, u.PromptTokens, u.CompletionTokens
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		c := chunk.Choices[0]
		if c.FinishReason != "" {
			resp.StopReason = c.FinishReason
		}
		if c.Delta.Content != "" {
			text.WriteString(c.Delta.Content)
			onDelta(c.Delta.Content)
		}
		for _, tc := range c.Delta.ToolCalls {
			for len(calls) <= tc.Index {
				calls = append(calls, &oaiToolCall{})
			}
			cur := calls[tc.Index]
			if tc.ID != "" {
				cur.ID = tc.ID
			}
			if tc.Function.Name != "" {
				cur.Function.Name = tc.Function.Name
			}
			cur.Function.Arguments += tc.Function.Arguments
		}
	}
	resp.Text = text.String()
	if err := sc.Err(); err != nil || !done {
		if cerr := ctx.Err(); cerr != nil {
			// Usage that arrived before the cut is kept, but it is not final.
			resp.UsagePresent = false
			return resp, cerr
		}
		if err == nil {
			err = fmt.Errorf("openai: stream ended before [DONE]")
		}
		return CompletionResponse{}, err
	}
	for _, tc := range calls {
		resp.ToolCalls = append(resp.ToolCalls, ToolCall{ID: tc.ID, Name: tc.Function.Name, Input: json.RawMessage(tc.Function.Arguments)})
	}
	return resp, nil
}
