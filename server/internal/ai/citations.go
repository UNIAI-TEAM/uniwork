package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Citation validation (spec §3.6): a source_id the pack does not contain is
// dropped, never rendered.
type Citation struct {
	SourceID string `json:"source_id"`
	Quote    string `json:"quote"`
}

type Answer struct {
	Answer    string     `json:"answer"`
	Citations []Citation `json:"citations"`
}

// NoSourcesAnswer is what the caller says when the pack is empty: the
// model is not even asked, so it cannot assert anything (spec §3.6).
const NoSourcesAnswer = "Chưa đủ dữ liệu trong workspace để trả lời."

func ParseAnswer(text string, pack []Source) (Answer, error) {
	raw, err := extractJSON(text)
	if err != nil {
		return Answer{}, ErrOutputInvalid.wrap(err)
	}
	var out Answer
	if err := json.Unmarshal(raw, &out); err != nil {
		return Answer{}, ErrOutputInvalid.wrap(err)
	}
	if strings.TrimSpace(out.Answer) == "" {
		return Answer{}, ErrOutputInvalid.wrap(errors.New("empty answer"))
	}
	known := map[string]bool{}
	for _, s := range pack {
		known[s.ID] = true
	}
	kept := make([]Citation, 0, len(out.Citations))
	for _, c := range out.Citations {
		if known[c.SourceID] {
			kept = append(kept, c)
		}
	}
	out.Citations = kept
	return out, nil
}

// ---- Meeting summary (moved from the old summarizer port) --------------

type ActionItem struct {
	Title string `json:"title"`
	Owner string `json:"owner,omitempty"`
	Due   string `json:"due,omitempty"`
}

type MeetingSummary struct {
	Summary     string       `json:"summary"`
	Decisions   []string     `json:"decisions"`
	ActionItems []ActionItem `json:"action_items"`
}

// ParseSummaryJSON accepts the model text and tolerates a ```json fence or
// prose around the object: it parses from the first '{' to the last '}'.
func ParseSummaryJSON(s string) (MeetingSummary, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return MeetingSummary{}, err
	}
	var out MeetingSummary
	if err := json.Unmarshal(raw, &out); err != nil {
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

func extractJSON(s string) (json.RawMessage, error) {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return nil, errors.New("ai: no JSON object in response")
	}
	return json.RawMessage(s[start : end+1]), nil
}
