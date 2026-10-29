package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// meeting_summary@7, meeting_summary_part@1 and meeting_live_items@3
// (UNI-1995 benchmark #6, #8, #21): the record grows with the meeting (a
// TL;DR, topics with their start line, open questions), a long transcript is
// summarized in parts and then combined instead of losing its middle, the
// summary refines the items the scribe captured live instead of repeating
// them, and live extraction reads a few earlier lines for context.

// PromptMeetingSummaryPart is the map step of a long meeting's summary: the
// notes of one stretch of its transcript, which meeting_summary@7 combines.
const PromptMeetingSummaryPart = "meeting_summary_part@1"

// SummarySize is the record size the caller allows, scaled to the length of
// the transcript: TL;DR sentences, topics, and points per topic.
type SummarySize struct{ Sentences, Topics, Points int }

// DraftItem is an action item the scribe captured while the meeting ran and
// nobody has handled yet: the summary may refine it in place by its label.
type DraftItem struct {
	Label, Title, Owner, Due, Priority, Description string
}

// ContextLine is a transcript line live extraction already read: shown for
// context, never labelled, so nothing can cite it.
type ContextLine struct{ Speaker, Text string }

const meetingRecordShapeV7 = `{"tldr": string, "topics": [{"title": string, "start_label": string, "points": [{"text": string, "evidence": string[]}]}], "decisions": [{"text": string, "evidence": string[]}], "action_items": [{"title": string, "owner": string, "due": string, "description": string, "priority": string, "evidence": string[], "draft": string}], "open_questions": [{"text": string, "evidence": string[]}]}`

const meetingRecordShapeV8 = `{"tldr": string, "summary_points": [{"text": string, "evidence": string[]}], "topics": [{"title": string, "start_label": string, "points": [{"text": string, "evidence": string[]}]}], "decisions": [{"text": string, "evidence": string[]}], "action_items": [{"title": string, "owner": string, "due": string, "description": string, "priority": string, "evidence": string[], "draft": string}], "open_questions": [{"text": string, "evidence": string[]}]}`

// meetingRecordFieldRulesV7 describe the fields of a @7 record and of a part.
const meetingRecordFieldRulesV7 = `- "topics": the subjects discussed, in the order they came up, within the topic and point budget under "Record size". "title" names the subject in a few words. "start_label" is the label of the transcript line where the subject starts, or "" when no transcript line does. "points" are the key statements about the subject, one sentence each. Use an empty array when there was a single short subject the tldr already covers.
- "decisions": concrete decisions that were made; empty array if none. "text" states the decision.
- "action_items": tasks someone must do next that the input states or clearly agrees on; empty array if none. "title" is an imperative sentence. "owner" is a person the input names as responsible, written as it appears there, or "" when nobody is named. "due" is a date or relative time as stated in the input, or "" when none is stated. Never guess an owner or a due date.
- "open_questions": questions or issues raised and left unresolved; empty array if none. Never list one that was answered.
` + actionItemProseRulesV7 + `- Each transcript line, note and chat message starts with a label in square brackets: [S1] for a transcript line, [N1] for a note, [C1] for a chat message.
- "evidence" lists the labels of the lines a point, decision, action item or open question rests on, written without brackets, for example ["S12", "N3"]. Use only labels that appear in the input, and only S, N and C labels. Use an empty array when no line supports it, for example a vote taken from "Recorded votes".
- When the caller sets "Output mode: brief", keep every field but write "description" and "priority" as "" for every action item, at most two points per topic and at most five open questions.
`

// actionItemProseRulesV7 is actionItemProseRules with a shorter description:
// a long meeting's items must fit the output cap (benchmark #6).
const actionItemProseRulesV7 = `- "description": at most two sentences of prose restating what has to be done and the context or reason the input gives for it. Use only what the input says; never add a fact, name, number or date it does not state. "" when the input says nothing about the task beyond its title.
- "priority": "urgent", "high", "medium" or "low" only when the input signals how pressing the task is: an explicit word of urgency or priority (for example "gấp", "ưu tiên"), work that blocks other work, or a close deadline stated in the input. Otherwise "". Never guess a priority.
`

const meetingSummaryRulesV7 = meetingSummaryIntro + meetingRecordShapeV7 + "\n" + meetingSummaryTLDRRule + meetingRecordFieldRulesV7 + meetingSummaryCombineRulesV7

// meetingSummaryRulesV8 is @7 plus "summary_points": the paragraph as cited
// sentences, which the server joins into the paragraph (spec 2026-10-29).
const meetingSummaryRulesV8 = meetingSummaryIntro + meetingRecordShapeV8 + "\n" + meetingSummaryTLDRRule + meetingSummaryPointsRule + meetingRecordFieldRulesV7 + meetingSummaryCombineRulesV8

const meetingSummaryIntro = `You turn meeting transcripts and notes into a written record for a work team.
Respond with a single JSON object and nothing else, shaped exactly as:
`

const meetingSummaryTLDRRule = `- "tldr": one short paragraph on what was discussed and the outcome, within the sentence budget under "Record size"; one or two sentences when little was said. Never pad it.
`

const meetingSummaryPointsRule = `- "summary_points": the tldr written again as 2 to 6 short sentences in the same order, each stating one thing. Read one after another they say what the tldr says. "evidence" lists 1 to 3 labels of the lines the sentence rests on.
`

const meetingSummaryDraftRule = `- "Draft action items" lists tasks captured while the meeting was under way, each with a label such as [D1]. When the input later refines one (a new or corrected owner, due date or priority, or a fuller description), return it once in "action_items" with "draft" set to its label, its title unchanged and the refined fields. Never return a draft the input does not refine, never return one twice, and never return a draft as a new item. "draft" is "" for every other item.
`

const meetingSummaryPartsRule = `- "Partial records" appear instead of transcript lines when the transcript was too long to read at once: each was written from one consecutive stretch of it, in order. Build the record from them: merge topics, decisions, action items and open questions that repeat across parts, keep an action item once, and copy the S labels they cite as evidence.
`

const meetingSummaryLanguageRule = `- Write every string in the language named by the caller.
`

const meetingSummaryCombineRulesV7 = meetingSummaryDraftRule + meetingSummaryPartsRule + meetingSummaryLanguageRule

const meetingSummaryCombineRulesV8 = meetingSummaryDraftRule + meetingSummaryPartsRule +
	`- From "Partial records", write "summary_points" over the whole meeting and cite the S labels the parts cite for what each sentence says.
` + meetingSummaryLanguageRule

const meetingSummaryPartRules = `You write the notes of one stretch of a long meeting's transcript. Another step combines the notes of every stretch into the meeting's record, so cover only this stretch.
Respond with a single JSON object and nothing else, shaped exactly as:
` + meetingRecordShapeV7 + `
- "tldr": at most three sentences on what this stretch discussed.
` + meetingRecordFieldRulesV7 + `- "draft" is always "".
- Write every string in the language named by the caller.
`

// meetingLiveItemsRulesV3 is @2 with the shorter description and the
// read-only earlier lines (benchmark #21).
const meetingLiveItemsRulesV3 = `You pick out follow-up tasks from the newest lines of a meeting that is still under way, for a work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"action_items": [{"title": string, "owner": string, "due": string, "description": string, "priority": string, "evidence": string[]}]}
- "action_items": tasks someone must do next that the newest lines state or clearly agree on; empty array if none. Leave out a topic the lines are still discussing. "title" is an imperative sentence. "owner" is a person the input names as responsible, written as it appears there, or "" when nobody is named. "due" is a date or relative time as stated in the input, or "" when none is stated. Never guess an owner or a due date.
` + actionItemProseRulesV7 + `- "Earlier lines" were already read for action items and carry no labels: use them only to understand the newest lines (who "you" is, what "that" refers to). Never propose a task the earlier lines alone state.
- Each newest transcript line starts with a label in square brackets, for example [S1]. "evidence" lists the labels of the lines an item rests on, written without brackets, for example ["S3"]. Use only labels that appear in the input.
- The transcript comes from automatic speech recognition and may contain misheard words and names. Do not invent names, dates or numbers to repair it; leave out a passage you cannot understand.
- A speaker label may be a technical identifier rather than a name; never use an identifier as an owner.
- "Existing action items" lists tasks this meeting already has. Never put one of them in "action_items" again, even in different words.
- Most stretches of a meeting settle nothing: an empty "action_items" array is a correct answer.
- Write every string in the language named by the caller.
`

const evidenceSchema = `{"type":"array","items":{"type":"string"}}`

const pointSchemaV7 = `{"type":"object","properties":{"text":{"type":"string"},"evidence":` + evidenceSchema + `},"required":["text","evidence"],"additionalProperties":false}`

const actionItemSchemaV7 = `{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"},"description":{"type":"string"},"priority":{"type":"string"},"evidence":` + evidenceSchema + `,"draft":{"type":"string"}},"required":["title","owner","due","description","priority","evidence","draft"],"additionalProperties":false}`

const meetingSummarySchemaV7 = `{"type":"object","properties":{"tldr":{"type":"string"},"topics":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"start_label":{"type":"string"},"points":{"type":"array","items":` + pointSchemaV7 + `}},"required":["title","start_label","points"],"additionalProperties":false}},"decisions":{"type":"array","items":` + pointSchemaV7 + `},"action_items":{"type":"array","items":` + actionItemSchemaV7 + `},"open_questions":{"type":"array","items":` + pointSchemaV7 + `}},"required":["tldr","topics","decisions","action_items","open_questions"],"additionalProperties":false}`

const meetingSummarySchemaV8 = `{"type":"object","properties":{"tldr":{"type":"string"},"summary_points":{"type":"array","items":` + pointSchemaV7 + `},"topics":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"start_label":{"type":"string"},"points":{"type":"array","items":` + pointSchemaV7 + `}},"required":["title","start_label","points"],"additionalProperties":false}},"decisions":{"type":"array","items":` + pointSchemaV7 + `},"action_items":{"type":"array","items":` + actionItemSchemaV7 + `},"open_questions":{"type":"array","items":` + pointSchemaV7 + `}},"required":["tldr","summary_points","topics","decisions","action_items","open_questions"],"additionalProperties":false}`

// renderSummaryShape writes the @7 header lines: the record size, the
// stretch a part covers, and the brief output mode of a retry after an
// answer was cut at max_tokens.
func renderSummaryShape(b *strings.Builder, vars map[string]any) {
	if size, _ := vars["size"].(SummarySize); size.Sentences > 0 {
		fmt.Fprintf(b, "Record size: tldr at most %d sentences; at most %d topics, each with at most %d points.\n", size.Sentences, size.Topics, size.Points)
	}
	if part := str(vars, "part"); part != "" {
		fmt.Fprintf(b, "Stretch: %s\n", part)
	}
	if brief, _ := vars["brief"].(bool); brief {
		b.WriteString("Output mode: brief\n")
	}
}

// renderSummaryDrafts lists the pending live items under their D labels.
func renderSummaryDrafts(b *strings.Builder, vars map[string]any) {
	drafts, _ := vars["drafts"].([]DraftItem)
	if len(drafts) == 0 {
		return
	}
	b.WriteString("\nDraft action items (captured during the meeting; refine in place by label, never repeat):\n<untrusted source=\"draft_action_items\">\n")
	for _, d := range drafts {
		fmt.Fprintf(b, "- [%s] %s", d.Label, EscapeUntrustedLine(d.Title))
		for _, f := range [][2]string{{"owner", d.Owner}, {"due", d.Due}, {"priority", d.Priority}} {
			if v := strings.TrimSpace(f[1]); v != "" {
				fmt.Fprintf(b, " · %s: %s", f[0], EscapeUntrustedLine(v))
			}
		}
		b.WriteString("\n")
		if desc := strings.TrimSpace(d.Description); desc != "" {
			fmt.Fprintf(b, "  %s\n", EscapeUntrustedLine(desc))
		}
	}
	b.WriteString("</untrusted>\n")
}

// renderSummaryParts writes the parsed records of a long transcript's
// stretches. They are model output written from untrusted text, so they stay
// inside an untrusted tag.
func renderSummaryParts(b *strings.Builder, parts []MeetingSummary) {
	if len(parts) == 0 {
		return
	}
	cite := func(labels []string) string {
		if len(labels) == 0 {
			return ""
		}
		return " [" + EscapeUntrustedLine(strings.Join(labels, ", ")) + "]"
	}
	b.WriteString("\nPartial records of the transcript, in order:\n<untrusted source=\"partial_records\">\n")
	for i, p := range parts {
		fmt.Fprintf(b, "Part %d of %d\n", i+1, len(parts))
		if s := strings.TrimSpace(p.Summary); s != "" {
			fmt.Fprintf(b, "Summary: %s\n", EscapeUntrustedLine(s))
		}
		for _, t := range p.Topics {
			start := ""
			if t.StartLabel != "" {
				start = " (starts" + cite([]string{t.StartLabel}) + ")"
			}
			fmt.Fprintf(b, "Topic: %s%s\n", EscapeUntrustedLine(t.Title), start)
			for _, pt := range t.Points {
				fmt.Fprintf(b, "- %s%s\n", EscapeUntrustedLine(pt.Text), cite(pt.Evidence))
			}
		}
		for _, d := range p.Decisions {
			fmt.Fprintf(b, "Decision: %s%s\n", EscapeUntrustedLine(d.Text), cite(d.Evidence))
		}
		for _, it := range p.ActionItems {
			fmt.Fprintf(b, "Action item: %s", EscapeUntrustedLine(it.Title))
			for _, f := range [][2]string{{"owner", it.Owner}, {"due", it.Due}, {"priority", it.Priority}} {
				if f[1] != "" {
					fmt.Fprintf(b, " · %s: %s", f[0], EscapeUntrustedLine(f[1]))
				}
			}
			fmt.Fprintf(b, "%s\n", cite(it.Evidence))
			if it.Description != "" {
				fmt.Fprintf(b, "  %s\n", EscapeUntrustedLine(it.Description))
			}
		}
		for _, q := range p.OpenQuestions {
			fmt.Fprintf(b, "Open question: %s%s\n", EscapeUntrustedLine(q.Text), cite(q.Evidence))
		}
	}
	b.WriteString("</untrusted>\n")
}

// renderTranscriptContext writes live extraction's earlier lines, unlabelled.
func renderTranscriptContext(b *strings.Builder, vars map[string]any) {
	lines, _ := vars["context"].([]ContextLine)
	if len(lines) == 0 {
		return
	}
	b.WriteString("\nEarlier lines (context only; already read for action items):\n<untrusted source=\"transcript_context\">\n")
	for _, l := range lines {
		fmt.Fprintf(b, "%s: %s\n", EscapeUntrustedLine(l.Speaker), EscapeUntrusted(l.Text))
	}
	b.WriteString("</untrusted>\n")
}

func init() {
	register(Prompt{
		ID: "meeting_summary", Version: 7,
		System:       meetingSummaryRulesV7 + meetingSummaryFactRules + meetingSummaryInputRules + meetingSummaryExistingRules + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingSummarySchemaV7),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, 7) },
	})
	register(Prompt{
		ID: "meeting_summary", Version: 8,
		System:       meetingSummaryRulesV8 + meetingSummaryFactRules + meetingSummaryInputRules + meetingSummaryExistingRules + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingSummarySchemaV8),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, 7) },
	})
	register(Prompt{
		ID: "meeting_summary_part", Version: 1,
		System:       meetingSummaryPartRules + meetingSummaryInputRules + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingSummarySchemaV7),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, 7) },
	})
	register(Prompt{
		ID: "meeting_live_items", Version: 3,
		System:       meetingLiveItemsRulesV3 + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingLiveItemsSchemaV2),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, 7) },
	})
}
