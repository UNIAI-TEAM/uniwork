package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
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

// NoticeNoSources is the ai_messages.notice code for a turn that had nothing
// to cite; the client renders the text, the row stores only the code.
const NoticeNoSources = "no_sources"

// NoticeEmptyAnswer marks a model answer that was empty once its untrusted
// tags were stripped, so the client shows a notice instead of an empty bubble.
const NoticeEmptyAnswer = "empty_answer"

// NoticeAgentFailed marks an Ask UNI agent run that ended without an answer.
const NoticeAgentFailed = "agent_failed"

// NoticeRefused marks a turn the model declined to answer (stop_reason
// refusal); the row stores no content.
const NoticeRefused = "refused"

// NoticeStopped marks a turn the asker stopped midway; the row keeps the
// answer text streamed until then.
const NoticeStopped = "stopped"

// NoticeInterrupted marks a turn cut by the server shutting down; the row
// keeps the answer text streamed until then.
const NoticeInterrupted = "interrupted"

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
	// Evidence is the meeting_summary@5 labels ("S12", "N3", "C5") of the
	// input lines the item rests on; the caller maps them to rows.
	Evidence []string `json:"evidence,omitempty"`
	// Description (meeting_summary@6, meeting_live_items@2) restates the item
	// in prose from the meeting content; the task composer prefills it.
	Description string `json:"description,omitempty"`
	// Priority is low|medium|high|urgent when the meeting signalled one, ""
	// otherwise; cleanActionItems drops any other value.
	Priority string `json:"priority,omitempty"`
}

// Decision is one decision of a meeting summary. Before @5 a decision was a
// bare string; UnmarshalJSON still reads that shape.
type Decision struct {
	Text     string   `json:"text"`
	Evidence []string `json:"evidence,omitempty"`
}

func (d *Decision) UnmarshalJSON(b []byte) error {
	var text string
	if json.Unmarshal(b, &text) == nil {
		*d = Decision{Text: text}
		return nil
	}
	type plain Decision
	return json.Unmarshal(b, (*plain)(d))
}

type MeetingSummary struct {
	Summary     string       `json:"summary"`
	Decisions   []Decision   `json:"decisions"`
	ActionItems []ActionItem `json:"action_items"`
}

type EmailThreadSummary struct {
	Summary     string       `json:"summary"`
	KeyPoints   []string     `json:"key_points"`
	ActionItems []ActionItem `json:"action_items"`
	NeedsReply  bool         `json:"needs_reply"`
	ReplyHint   string       `json:"reply_hint"`
}

// CatchUpActionItem is one suggested follow-up from unread chat (C-13.7).
// SourceID is optional and must match a pack source when present.
type CatchUpActionItem struct {
	Title    string `json:"title"`
	Owner    string `json:"owner,omitempty"`
	Due      string `json:"due,omitempty"`
	SourceID string `json:"source_id,omitempty"`
}

// CatchUpHighlight is one key point of a brief. SourceID is optional and,
// like an action item's, must match a pack source when present.
type CatchUpHighlight struct {
	Text     string `json:"text"`
	SourceID string `json:"source_id,omitempty"`
}

// UnmarshalJSON takes the object chat_catchup@2 returns or the bare string
// chat_catchup@1 and chat_call_summary@1 return.
func (h *CatchUpHighlight) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, &h.Text); err == nil {
		return nil
	}
	type plain CatchUpHighlight
	return json.Unmarshal(b, (*plain)(h))
}

// CatchUp is the structured catch-up brief for a room or thread.
type CatchUp struct {
	Summary     string              `json:"summary"`
	Highlights  []CatchUpHighlight  `json:"highlights"`
	ActionItems []CatchUpActionItem `json:"action_items"`
}

// HighlightTexts is the highlights as plain strings, the shape the call
// summary stores and older catch-up clients read.
func (c CatchUp) HighlightTexts() []string {
	out := make([]string, len(c.Highlights))
	for i, h := range c.Highlights {
		out[i] = h.Text
	}
	return out
}

// ParseCatchUpJSON parses the chat_catchup model output and drops unknown source_ids.
func ParseCatchUpJSON(s string, pack []Source) (CatchUp, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return CatchUp{}, ErrOutputInvalid.wrap(err)
	}
	var out CatchUp
	if err := json.Unmarshal(raw, &out); err != nil {
		return CatchUp{}, ErrOutputInvalid.wrap(err)
	}
	if strings.TrimSpace(out.Summary) == "" {
		return CatchUp{}, ErrOutputInvalid.wrap(errors.New("empty summary"))
	}
	if out.Highlights == nil {
		out.Highlights = []CatchUpHighlight{}
	}
	if out.ActionItems == nil {
		out.ActionItems = []CatchUpActionItem{}
	}
	known := map[string]bool{}
	for _, src := range pack {
		known[src.ID] = true
	}
	for i, h := range out.Highlights {
		if h.SourceID != "" && !known[h.SourceID] {
			out.Highlights[i].SourceID = ""
		}
	}
	kept := make([]CatchUpActionItem, 0, len(out.ActionItems))
	for _, item := range out.ActionItems {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		if item.SourceID != "" && !known[item.SourceID] {
			item.SourceID = ""
		}
		kept = append(kept, item)
	}
	out.ActionItems = kept
	return out, nil
}

// ParseEmailThreadSummaryJSON parses email_thread_summary model output.
func ParseEmailThreadSummaryJSON(s string) (EmailThreadSummary, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return EmailThreadSummary{}, err
	}
	var out EmailThreadSummary
	if err := json.Unmarshal(raw, &out); err != nil {
		return EmailThreadSummary{}, fmt.Errorf("ai: parse email summary: %w", err)
	}
	if strings.TrimSpace(out.Summary) == "" {
		return EmailThreadSummary{}, errors.New("ai: empty summary")
	}
	if out.KeyPoints == nil {
		out.KeyPoints = []string{}
	}
	if out.ActionItems == nil {
		out.ActionItems = []ActionItem{}
	}
	kept := make([]ActionItem, 0, len(out.ActionItems))
	for _, item := range out.ActionItems {
		item.Title = strings.TrimSpace(item.Title)
		if item.Title == "" {
			continue
		}
		kept = append(kept, item)
	}
	out.ActionItems = kept
	return out, nil
}

// Caps on a parsed meeting summary (L1). They are far above what the prompt
// asks for, so a well-behaved answer is never cut; they only stop a runaway
// answer from becoming a record nobody can read or a task batch nobody can
// review.
const (
	maxSummaryRunes     = 4000
	maxSummaryDecisions = 30
	maxDecisionRunes    = 500
	maxSummaryItems     = 30
	maxItemTitleRunes   = 300
	maxItemOwnerRunes   = 120
	maxItemDueRunes     = 120
	// maxItemDescriptionRunes: the prompt asks for 1-3 sentences.
	maxItemDescriptionRunes = 1000
	maxEvidenceLabels       = 10
	maxEvidenceRunes        = 16
)

// ParseSummaryJSON accepts the model text and tolerates a ```json fence or
// prose around the object: it parses from the first '{' to the last '}'.
// Strings are trimmed and capped, blank decisions and untitled action items
// are dropped, and an answer left with nothing at all (no summary, no
// decision, no item) is ErrOutputInvalid, so the caller keeps the summary it
// already has instead of storing an empty one over it.
func ParseSummaryJSON(s string) (MeetingSummary, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return MeetingSummary{}, ErrOutputInvalid.wrap(err)
	}
	var out MeetingSummary
	if err := json.Unmarshal(raw, &out); err != nil {
		return MeetingSummary{}, ErrOutputInvalid.wrap(fmt.Errorf("parse summary: %w", err))
	}
	out.Summary = capRunes(strings.TrimSpace(out.Summary), maxSummaryRunes)
	decisions := make([]Decision, 0, len(out.Decisions))
	for _, d := range out.Decisions {
		if d.Text = strings.TrimSpace(d.Text); d.Text != "" && len(decisions) < maxSummaryDecisions {
			decisions = append(decisions, Decision{Text: capRunes(d.Text, maxDecisionRunes), Evidence: capEvidence(d.Evidence)})
		}
	}
	out.Decisions = decisions
	out.ActionItems = cleanActionItems(out.ActionItems)
	if out.Summary == "" && len(out.Decisions) == 0 && len(out.ActionItems) == 0 {
		return MeetingSummary{}, ErrOutputInvalid.wrap(errors.New("empty summary"))
	}
	return out, nil
}

// actionItemPriorities are the task priorities a model may suggest.
var actionItemPriorities = map[string]bool{"low": true, "medium": true, "high": true, "urgent": true}

// cleanActionItems trims and caps the items a model proposed, dropping the
// untitled ones.
func cleanActionItems(in []ActionItem) []ActionItem {
	items := make([]ActionItem, 0, len(in))
	for _, it := range in {
		it.Title = capRunes(strings.TrimSpace(it.Title), maxItemTitleRunes)
		if it.Title == "" || len(items) >= maxSummaryItems {
			continue
		}
		it.Owner = capRunes(strings.TrimSpace(it.Owner), maxItemOwnerRunes)
		it.Due = capRunes(strings.TrimSpace(it.Due), maxItemDueRunes)
		it.Evidence = capEvidence(it.Evidence)
		it.Description = capRunes(strings.TrimSpace(it.Description), maxItemDescriptionRunes)
		it.Priority = strings.ToLower(strings.TrimSpace(it.Priority))
		if !actionItemPriorities[it.Priority] {
			it.Priority = ""
		}
		items = append(items, it)
	}
	return items
}

// ParseLiveItemsJSON reads meeting_live_items output. Unlike a summary, an
// empty "action_items" array is a correct answer: most stretches of a
// meeting settle nothing.
func ParseLiveItemsJSON(s string) ([]ActionItem, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return nil, ErrOutputInvalid.wrap(err)
	}
	var out struct {
		ActionItems *[]ActionItem `json:"action_items"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, ErrOutputInvalid.wrap(fmt.Errorf("parse live items: %w", err))
	}
	if out.ActionItems == nil {
		return nil, ErrOutputInvalid.wrap(errors.New("no action_items"))
	}
	return cleanActionItems(*out.ActionItems), nil
}

// capEvidence keeps at most maxEvidenceLabels labels of a plausible length;
// whether a label names a line of the input is the caller's check.
func capEvidence(labels []string) []string {
	var out []string
	for _, l := range labels {
		if l = strings.TrimSpace(l); l != "" && utf8.RuneCountInString(l) <= maxEvidenceRunes && len(out) < maxEvidenceLabels {
			out = append(out, l)
		}
	}
	return out
}

// capRunes cuts s to at most n runes, marking the cut with an ellipsis.
func capRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n-1])) + "…"
}

// MediaAnalysis is the media_analysis@1 output.
type MediaAnalysis struct {
	Text string `json:"text"`
}

// ParseMediaAnalysisJSON reads media_analysis output. A model that answered
// in prose instead of the object still answered: its text is kept.
func ParseMediaAnalysisJSON(s string) MediaAnalysis {
	if raw, err := extractJSON(s); err == nil {
		var out MediaAnalysis
		if json.Unmarshal(raw, &out) == nil && strings.TrimSpace(out.Text) != "" {
			return out
		}
	}
	return MediaAnalysis{Text: strings.TrimSpace(s)}
}

func extractJSON(s string) (json.RawMessage, error) {
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return nil, errors.New("ai: no JSON object in response")
	}
	return json.RawMessage(s[start : end+1]), nil
}
