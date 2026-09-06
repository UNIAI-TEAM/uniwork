package provider

import (
	"context"
	"strings"

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
	for _, m := range req.Messages {
		block := anthropic.NewTextBlock(m.Content)
		if m.Role == "assistant" {
			params.Messages = append(params.Messages, anthropic.NewAssistantMessage(block))
		} else {
			params.Messages = append(params.Messages, anthropic.NewUserMessage(block))
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
		return CompletionResponse{}, err
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return CompletionResponse{}, ErrRefused
	}
	out := CompletionResponse{
		Model:        string(resp.Model),
		StopReason:   string(resp.StopReason),
		InputTokens:  int(resp.Usage.InputTokens),
		OutputTokens: int(resp.Usage.OutputTokens),
	}
	var text strings.Builder
	for _, block := range resp.Content {
		switch b := block.AsAny().(type) {
		case anthropic.TextBlock:
			text.WriteString(b.Text)
		case anthropic.ToolUseBlock:
			out.ToolCalls = append(out.ToolCalls, ToolCall{Name: b.Name, Input: b.Input})
		}
	}
	out.Text = text.String()
	return out, nil
}

func (a *Anthropic) Embed(context.Context, EmbedRequest) (EmbedResponse, error) {
	return EmbedResponse{}, ErrUnsupported
}
