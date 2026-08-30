// Package ai holds the LLM port used by services. Only this package imports
// the Anthropic SDK; services depend on the Summarizer interface so tests
// run with a fake.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// DefaultModel is the model used for meeting summaries.
const DefaultModel = "claude-opus-5"

type TranscriptLine struct {
	Speaker string
	Text    string
}

type SummarizeInput struct {
	Title      string
	Agenda     string
	Locale     string // "vi" or "en"; drives the output language
	Transcript []TranscriptLine
	Notes      []string
}

type ActionItem struct {
	Title string `json:"title"`
	Owner string `json:"owner,omitempty"`
	Due   string `json:"due,omitempty"`
}

type MeetingSummary struct {
	Summary     string       `json:"summary"`
	Decisions   []string     `json:"decisions"`
	ActionItems []ActionItem `json:"action_items"`
	Model       string       `json:"-"`
}

type Summarizer interface {
	SummarizeMeeting(ctx context.Context, in SummarizeInput) (MeetingSummary, error)
}

// Claude implements Summarizer on the Anthropic Messages API.
type Claude struct {
	client anthropic.Client
	model  string
}

func NewClaude(apiKey, model string) *Claude {
	if model == "" {
		model = DefaultModel
	}
	return &Claude{client: anthropic.NewClient(option.WithAPIKey(apiKey)), model: model}
}

const systemPrompt = `You turn meeting transcripts and notes into a written record for a Vietnamese work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "decisions": string[], "action_items": [{"title": string, "owner": string, "due": string}]}
- "summary": 3-6 sentences covering what was discussed and the outcome.
- "decisions": concrete decisions that were made; empty array if none.
- "action_items": tasks someone must do next; "title" is an imperative sentence, "owner" is the person's name as spoken or "", "due" is a date/relative time as spoken or "".
- Write every string in the language named by the caller. Never invent facts that are not in the input.`

func (c *Claude) SummarizeMeeting(ctx context.Context, in SummarizeInput) (MeetingSummary, error) {
	lang := "Vietnamese"
	if strings.HasPrefix(in.Locale, "en") {
		lang = "English"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Output language: %s\nMeeting title: %s\n", lang, in.Title)
	if strings.TrimSpace(in.Agenda) != "" {
		fmt.Fprintf(&b, "Agenda:\n%s\n", in.Agenda)
	}
	if len(in.Notes) > 0 {
		b.WriteString("\nNotes taken during the meeting:\n")
		for _, n := range in.Notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	b.WriteString("\nTranscript:\n")
	if len(in.Transcript) == 0 {
		b.WriteString("(no transcript captured)\n")
	}
	for _, l := range in.Transcript {
		fmt.Fprintf(&b, "%s: %s\n", l.Speaker, l.Text)
	}

	resp, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: 4096,
		System:    []anthropic.TextBlockParam{{Text: systemPrompt}},
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(b.String()))},
	})
	if err != nil {
		return MeetingSummary{}, err
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return MeetingSummary{}, errors.New("ai: request refused")
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(tb.Text)
		}
	}
	out, err := ParseSummaryJSON(text.String())
	if err != nil {
		return MeetingSummary{}, err
	}
	out.Model = string(resp.Model)
	return out, nil
}

// ParseSummaryJSON accepts the model text and tolerates a ```json fence or
// prose around the object: it parses from the first '{' to the last '}'.
func ParseSummaryJSON(s string) (MeetingSummary, error) {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return MeetingSummary{}, errors.New("ai: no JSON object in response")
	}
	var out MeetingSummary
	if err := json.Unmarshal([]byte(s[start:end+1]), &out); err != nil {
		return MeetingSummary{}, fmt.Errorf("ai: parse summary: %w", err)
	}
	if out.Decisions == nil {
		out.Decisions = []string{}
	}
	if out.ActionItems == nil {
		out.ActionItems = []ActionItem{}
	}
	return out, nil
}

// Fake is a Summarizer for tests.
type Fake struct {
	Result MeetingSummary
	Err    error
	Calls  int
	Last   SummarizeInput
}

func (f *Fake) SummarizeMeeting(_ context.Context, in SummarizeInput) (MeetingSummary, error) {
	f.Calls++
	f.Last = in
	if f.Err != nil {
		return MeetingSummary{}, f.Err
	}
	r := f.Result
	if r.Decisions == nil {
		r.Decisions = []string{}
	}
	if r.ActionItems == nil {
		r.ActionItems = []ActionItem{}
	}
	if r.Model == "" {
		r.Model = "fake"
	}
	return r, nil
}
