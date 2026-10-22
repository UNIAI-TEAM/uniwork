package service

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Evidence (UNI-2002, spec meeting follow-through §7.2, D11): each decision
// and action item a summary proposes cites the transcript segments, notes and
// chat messages of its input it rests on. The prompt sees short per-call
// labels (S12, N3, C5); the rows store {kind, id}.

const (
	EvidenceSegment = "segment"
	EvidenceNote    = "note"
	EvidenceChat    = "chat"

	// maxEvidenceRefs bounds one evidence read; a decision or an item cites
	// at most ai.maxEvidenceLabels lines.
	maxEvidenceRefs = 20
)

var evidencePrefix = map[string]string{EvidenceSegment: "S", EvidenceNote: "N", EvidenceChat: "C"}

// EvidenceRef names one cited input line.
type EvidenceRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// SummaryDecision is one decision of a stored summary.
type SummaryDecision struct {
	Text     string        `json:"text"`
	Evidence []EvidenceRef `json:"evidence"`
}

// summaryLabels is one Summarize call's label → row table, and its draft
// label → pending live item table (D1, D2, … meeting_summary@7).
type summaryLabels struct {
	refs   map[string]EvidenceRef
	next   map[string]int
	drafts map[string]string
}

func newSummaryLabels() *summaryLabels {
	return &summaryLabels{refs: map[string]EvidenceRef{}, next: map[string]int{}, drafts: map[string]string{}}
}

// draft gives a pending live item its D label.
func (l *summaryLabels) draft(itemID string) string {
	label := "D" + strconv.Itoa(len(l.drafts)+1)
	l.drafts[label] = itemID
	return label
}

// draftID is the item a D label names; ok is false for any other label.
func (l *summaryLabels) draftID(label string) (string, bool) {
	id, ok := l.drafts[strings.ToUpper(strings.Trim(strings.TrimSpace(label), "[]"))]
	return id, ok
}

// label gives the row its label, or "" for a line that is no row (the
// "lines omitted" marker).
func (l *summaryLabels) label(kind, id string) string {
	if id == "" {
		return ""
	}
	p := evidencePrefix[kind]
	l.next[p]++
	label := p + strconv.Itoa(l.next[p])
	l.refs[label] = EvidenceRef{Kind: kind, ID: id}
	return label
}

// resolve maps the model's labels to rows: a label this call did not hand
// out is dropped (and counted), a repeat is kept once. Never nil.
func (l *summaryLabels) resolve(labels []string) ([]EvidenceRef, int) {
	refs, dropped := []EvidenceRef{}, 0
	seen := map[string]bool{}
	for _, raw := range labels {
		key := strings.ToUpper(strings.Trim(strings.TrimSpace(raw), "[]"))
		ref, ok := l.refs[key]
		if !ok {
			dropped++
			continue
		}
		if !seen[key] {
			seen[key] = true
			refs = append(refs, ref)
		}
	}
	return refs, dropped
}

// validEvidence keeps the well-formed references of a stored list. Never nil.
func validEvidence(refs []EvidenceRef) []EvidenceRef {
	out := []EvidenceRef{}
	for _, r := range refs {
		if _, ok := evidencePrefix[r.Kind]; ok && r.ID != "" {
			out = append(out, r)
		}
	}
	return out
}

// decodeEvidence reads meeting_action_items.evidence. Never nil.
func decodeEvidence(raw string) []EvidenceRef {
	var refs []EvidenceRef
	_ = json.Unmarshal([]byte(raw), &refs)
	return validEvidence(refs)
}

// DecodeSummaryDecisions reads meeting_summaries.decisions: objects since
// @5, bare strings before it (spec §7.2). A row that does not parse reads as
// no decisions, an entry that does not parse is skipped. Never nil.
func DecodeSummaryDecisions(raw string) []SummaryDecision {
	var entries []json.RawMessage
	_ = json.Unmarshal([]byte(raw), &entries)
	out := []SummaryDecision{}
	for _, e := range entries {
		var d SummaryDecision
		var text string
		if json.Unmarshal(e, &text) == nil {
			d.Text = text
		} else if json.Unmarshal(e, &d) != nil {
			continue
		}
		if d.Text = strings.TrimSpace(d.Text); d.Text != "" {
			d.Evidence = validEvidence(d.Evidence)
			out = append(out, d)
		}
	}
	return out
}

// SummaryTopic is one topic of a stored @7 summary: Start is the transcript
// segment it begins at, nil when no segment does.
type SummaryTopic struct {
	Title  string            `json:"title"`
	Start  *EvidenceRef      `json:"start"`
	Points []SummaryDecision `json:"points"`
}

// DecodeSummaryTopics reads meeting_summaries.topics; a row before @7, or one
// that does not parse, reads as none. Never nil.
func DecodeSummaryTopics(raw string) []SummaryTopic {
	var topics []SummaryTopic
	_ = json.Unmarshal([]byte(raw), &topics)
	out := []SummaryTopic{}
	for _, t := range topics {
		if t.Title = strings.TrimSpace(t.Title); t.Title == "" {
			continue
		}
		if t.Start != nil && (t.Start.Kind != EvidenceSegment || t.Start.ID == "") {
			t.Start = nil
		}
		points := []SummaryDecision{}
		for _, p := range t.Points {
			if p.Text = strings.TrimSpace(p.Text); p.Text != "" {
				p.Evidence = validEvidence(p.Evidence)
				points = append(points, p)
			}
		}
		t.Points = points
		out = append(out, t)
	}
	return out
}

// summaryDecisionTexts is the decisions as a JSON array of strings, the shape
// Ask UNI and MCP excerpts have always quoted, whichever shape the row holds.
func summaryDecisionTexts(raw string) string {
	decisions := DecodeSummaryDecisions(raw)
	texts := make([]string, len(decisions))
	for i, d := range decisions {
		texts[i] = d.Text
	}
	b, _ := json.Marshal(texts)
	return string(b)
}

// summaryActionItemTitles is the raw action items of a summary row as a JSON
// array of their titles: the evidence labels of @5 ("S2") would collide with
// Ask UNI's own source labels and only cost runes in an excerpt.
func summaryActionItemTitles(raw string) string {
	var items []struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal([]byte(raw), &items)
	titles := []string{}
	for _, it := range items {
		if t := strings.TrimSpace(it.Title); t != "" {
			titles = append(titles, t)
		}
	}
	b, _ := json.Marshal(titles)
	return string(b)
}

// ParseEvidenceRefs reads the refs query of GET /meetings/{id}/evidence:
// comma-separated kind:id pairs, at most maxEvidenceRefs. "" is none.
func ParseEvidenceRefs(raw string) ([]EvidenceRef, error) {
	refs := []EvidenceRef{}
	if strings.TrimSpace(raw) == "" {
		return refs, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxEvidenceRefs {
		return nil, Invalid("tối đa " + strconv.Itoa(maxEvidenceRefs) + " căn cứ mỗi lần")
	}
	for _, p := range parts {
		kind, id, _ := strings.Cut(strings.TrimSpace(p), ":")
		if _, ok := evidencePrefix[kind]; !ok || id == "" {
			return nil, Invalid("căn cứ không hợp lệ")
		}
		refs = append(refs, EvidenceRef{Kind: kind, ID: id})
	}
	return refs, nil
}

// EvidenceSource is one cited line as the reader sees it: who said or wrote
// it, when, and what.
type EvidenceSource struct {
	Kind, ID, Author, Text string
	At                     pgtype.Timestamptz
}

// EvidenceSources reads the cited lines of one meeting for any member, in the
// order asked. A reference to a line of another meeting or tenant, or one
// deleted since, is simply absent.
func (s *MeetingService) EvidenceSources(ctx context.Context, userID, meetingID string, refs []EvidenceRef) ([]EvidenceSource, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	ids := map[string][]string{}
	for _, r := range refs {
		ids[r.Kind] = append(ids[r.Kind], r.ID)
	}
	found := map[EvidenceRef]EvidenceSource{}
	if len(ids[EvidenceSegment]) > 0 {
		rows, err := s.q.ListTranscriptSegmentsByIDs(ctx, db.ListTranscriptSegmentsByIDsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID, Ids: ids[EvidenceSegment]})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			found[EvidenceRef{EvidenceSegment, r.ID}] = EvidenceSource{Kind: EvidenceSegment, ID: r.ID, Author: r.SpeakerName, Text: r.Text, At: r.SpokenAt}
		}
	}
	if len(ids[EvidenceChat]) > 0 {
		rows, err := s.q.ListMeetingChatMessagesByIDs(ctx, db.ListMeetingChatMessagesByIDsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID, Ids: ids[EvidenceChat]})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			found[EvidenceRef{EvidenceChat, r.ID}] = EvidenceSource{Kind: EvidenceChat, ID: r.ID, Author: r.SenderName, Text: r.Message, At: r.SentAt}
		}
	}
	if len(ids[EvidenceNote]) > 0 {
		// A meeting's notes are few and the summary reads them all anyway.
		rows, err := s.q.ListMeetingNotes(ctx, m.ID)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			found[EvidenceRef{EvidenceNote, r.ID}] = EvidenceSource{Kind: EvidenceNote, ID: r.ID, Author: r.DisplayName, Text: r.Body, At: r.CreatedAt}
		}
	}
	out := make([]EvidenceSource, 0, len(refs))
	for _, r := range refs {
		if src, ok := found[r]; ok {
			out = append(out, src)
			delete(found, r) // a repeated reference is answered once
		}
	}
	return out, nil
}
