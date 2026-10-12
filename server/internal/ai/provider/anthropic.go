package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
)

// Anthropic speaks the Messages API through the official SDK.
type Anthropic struct{ client anthropic.Client }

func NewAnthropic(apiKey string) *Anthropic {
	return &Anthropic{client: anthropic.NewClient(option.WithAPIKey(apiKey))}
}

func (a *Anthropic) Name() string { return "anthropic" }

func (a *Anthropic) Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error) {
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: int64(req.MaxTokens),
	}
	if req.System != "" {
		params.System = []anthropic.TextBlockParam{{Text: req.System}}
	}
	if req.Temperature > 0 {
		params.Temperature = param.NewOpt(req.Temperature)
	}
	for i, m := range req.Messages {
		block := anthropic.NewTextBlock(m.Content)
		switch {
		case m.Role == "assistant":
			// Replay the call before its result: the Messages API needs the
			// tool_use block (with its id) in the assistant turn that produced
			// it, or the tool_result below has nothing to pair with.
			blocks := make([]anthropic.ContentBlockParamUnion, 0, len(m.ToolCalls)+1)
			if m.Content != "" {
				blocks = append(blocks, block)
			}
			for _, tc := range m.ToolCalls {
				blocks = append(blocks, anthropic.NewToolUseBlock(tc.ID, toolInput(tc.Input), tc.Name))
			}
			params.Messages = append(params.Messages, anthropic.NewAssistantMessage(blocks...))
		case m.Role == "tool":
			// A tool result is not a turn of its own there: it rides the user
			// turn, addressed to the tool_use id it answers. Results of
			// parallel calls share that one user turn, since the API wants
			// every result right after the assistant turn that asked.
			result := anthropic.NewToolResultBlock(m.ToolCallID, m.Content, false)
			if n := len(params.Messages); n > 0 && i > 0 && req.Messages[i-1].Role == "tool" {
				params.Messages[n-1].Content = append(params.Messages[n-1].Content, result)
				continue
			}
			params.Messages = append(params.Messages, anthropic.NewUserMessage(result))
		default:
			blocks := make([]anthropic.ContentBlockParamUnion, 0, len(m.Parts)+1)
			for _, p := range m.Parts {
				b, err := anthropicPart(p)
				if err != nil {
					return CompletionResponse{}, err
				}
				blocks = append(blocks, b)
			}
			params.Messages = append(params.Messages, anthropic.NewUserMessage(append(blocks, block)...))
		}
	}
	for _, t := range req.Tools {
		props, required := schemaParts(t.Schema)
		tool := anthropic.ToolParam{
			Name:        t.Name,
			Description: param.NewOpt(t.Description),
			InputSchema: anthropic.ToolInputSchemaParam{Properties: props, Required: required},
		}
		params.Tools = append(params.Tools, anthropic.ToolUnionParam{OfTool: &tool})
	}
	resp, err := a.client.Messages.New(ctx, params)
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			se := &StatusError{Status: apiErr.StatusCode, Detail: snippet([]byte(apiErr.RawJSON())), Err: err}
			if apiErr.Response != nil {
				se.RetryAfter = retryAfter(apiErr.Response.Header, time.Now())
			}
			return CompletionResponse{}, se
		}
		return CompletionResponse{}, err
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return CompletionResponse{}, ErrRefused
	}
	out := CompletionResponse{
		Model:      string(resp.Model),
		StopReason: string(resp.StopReason),
		// Usage is api:"required" in the SDK, so a successful response that
		// carries no usage block never reaches here; the flag still says what
		// the body actually had.
		UsagePresent: resp.JSON.Usage.Valid(),
		InputTokens:  int(resp.Usage.InputTokens),
		OutputTokens: int(resp.Usage.OutputTokens),
	}
	var text strings.Builder
	for _, block := range resp.Content {
		switch b := block.AsAny().(type) {
		case anthropic.TextBlock:
			text.WriteString(b.Text)
		case anthropic.ToolUseBlock:
			out.ToolCalls = append(out.ToolCalls, ToolCall{ID: b.ID, Name: b.Name, Input: b.Input})
		}
	}
	out.Text = text.String()
	return out, nil
}

// toolInput is the call's arguments as the SDK wants them: a decoded value, or
// an empty object when the model sent none (the API requires the field).
func toolInput(raw json.RawMessage) any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	return raw
}

// anthropicPart maps a media part onto the Messages API: images and PDFs
// only; audio and video are not model inputs there.
func anthropicPart(p Part) (anthropic.ContentBlockParamUnion, error) {
	data := base64.StdEncoding.EncodeToString(p.Data)
	switch p.MIME {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return anthropic.NewImageBlockBase64(p.MIME, data), nil
	case "application/pdf":
		return anthropic.NewDocumentBlock(anthropic.Base64PDFSourceParam{Data: data}), nil
	}
	return anthropic.ContentBlockParamUnion{}, ErrUnsupportedMedia
}

func (a *Anthropic) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}
