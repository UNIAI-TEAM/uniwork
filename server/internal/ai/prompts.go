package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Prompt keys used by callers.
const (
	PromptMeetingSummary     = "meeting_summary@2"
	PromptCopilotAnswer      = "copilot_answer@1"
	PromptChatCatchUp        = "chat_catchup@1"
	PromptChatCallSummary    = "chat_call_summary@1"
	PromptEmailThreadSummary = "email_thread_summary@1"
)

type TranscriptLine struct {
	Speaker string
	Text    string
}

type ChatLine struct {
	Sender string
	Text   string
}

// AttendanceFacts is the recorded attendance of one meeting, members only.
// Observers never appear: they do not count toward attendance or votes.
type AttendanceFacts struct {
	Members, Present, Late, Excused, Absent int
	QuorumPercent                           int   // 0 = no minimum set
	QuorumMet                               *bool // nil when no minimum or no members
	Finalized                               bool
	NamesByStatus                           map[string][]string // PRESENT/LATE/EXCUSED/ABSENT → display names (members only)
}

// MotionFact is one closed vote as the system counted it. It deliberately
// has no voter names: who chose what never reaches the model.
type MotionFact struct {
	Title, BallotMode          string
	Yes, No, Abstain, Required int
	Outcome                    string // PASSED | FAILED
}

// meetingSummaryRules is the @1 system text; @2 appends meetingSummaryFactRules.
const meetingSummaryRules = `You turn meeting transcripts and notes into a written record for a Vietnamese work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "decisions": string[], "action_items": [{"title": string, "owner": string, "due": string}]}
- "summary": 3-6 sentences covering what was discussed and the outcome.
- "decisions": concrete decisions that were made; empty array if none.
- "action_items": tasks someone must do next; "title" is an imperative sentence, "owner" is the person's name as spoken or "", "due" is a date/relative time as spoken or "".
- Write every string in the language named by the caller.
`

const meetingSummaryFactRules = `- "Recorded attendance" and "Recorded votes" are the system's own record. Use their numbers and outcomes exactly; never recount, round or adjust them.
- When attendance is recorded, state it in "summary" in one sentence: members present out of the total, and whether the minimum attendance was met when one is set.
- Add one entry to "decisions" per recorded vote: its title, its outcome (passed or not passed) and its yes, no and abstain counts.
- Never infer or report a vote result from the transcript, notes or chat; only recorded votes are votes.
- Never state or guess how any person voted, whatever the ballot.
`

const meetingSummarySchema = `{"type":"object","properties":{"summary":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"action_items":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"}},"required":["title","owner","due"],"additionalProperties":false}}},"required":["summary","decisions","action_items"],"additionalProperties":false}`

// attendanceOrder fixes the order statuses are listed in, so the rendered
// prompt does not depend on map iteration.
var attendanceOrder = []struct{ status, label string }{
	{"PRESENT", "Present"}, {"LATE", "Late"}, {"EXCUSED", "Excused"}, {"ABSENT", "Absent"},
}

// renderMeetingSummary is shared by @1 and @2. withFacts adds the recorded
// attendance and vote blocks; without it the output is exactly @1's.
func renderMeetingSummary(vars map[string]any, withFacts bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Output language: %s\nMeeting title: %s\n", language(str(vars, "locale")), str(vars, "title"))
	if agenda := strings.TrimSpace(str(vars, "agenda")); agenda != "" {
		fmt.Fprintf(&b, "Agenda:\n<untrusted source=\"agenda\">%s</untrusted>\n", agenda)
	}
	if withFacts {
		// A typed nil (*AttendanceFacts)(nil) still asserts ok, hence the nil check.
		if a, _ := vars["attendance"].(*AttendanceFacts); a != nil {
			renderAttendanceFacts(&b, a)
		}
		if motions, _ := vars["motions"].([]MotionFact); len(motions) > 0 {
			renderMotionFacts(&b, motions)
		}
	}
	if notes, _ := vars["notes"].([]string); len(notes) > 0 {
		b.WriteString("\nNotes taken during the meeting:\n<untrusted source=\"notes\">\n")
		for _, n := range notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
		b.WriteString("</untrusted>\n")
	}
	if chat, _ := vars["chat"].([]ChatLine); len(chat) > 0 {
		b.WriteString("\nIn-meeting chat:\n<untrusted source=\"chat\">\n")
		for _, c := range chat {
			fmt.Fprintf(&b, "%s: %s\n", c.Sender, c.Text)
		}
		b.WriteString("</untrusted>\n")
	}
	b.WriteString("\nTranscript:\n<untrusted source=\"transcript\">\n")
	lines, _ := vars["transcript"].([]TranscriptLine)
	if len(lines) == 0 {
		b.WriteString("(no transcript captured)\n")
	}
	for _, l := range lines {
		fmt.Fprintf(&b, "%s: %s\n", l.Speaker, l.Text)
	}
	b.WriteString("</untrusted>\n")
	return b.String()
}

// renderAttendanceFacts writes the counts as system facts; only the names,
// which people typed, go inside an untrusted tag.
func renderAttendanceFacts(b *strings.Builder, a *AttendanceFacts) {
	b.WriteString("\nRecorded attendance (system record — use exactly):\n")
	fmt.Fprintf(b, "- Members: %d (present %d, late %d, excused %d, absent %d)\n", a.Members, a.Present, a.Late, a.Excused, a.Absent)
	switch {
	case a.QuorumPercent == 0:
		b.WriteString("- Minimum attendance: not set\n")
	case a.QuorumMet == nil:
		fmt.Fprintf(b, "- Minimum attendance: %d%%\n", a.QuorumPercent)
	case *a.QuorumMet:
		fmt.Fprintf(b, "- Minimum attendance: %d%%, met\n", a.QuorumPercent)
	default:
		fmt.Fprintf(b, "- Minimum attendance: %d%%, not met\n", a.QuorumPercent)
	}
	if a.Finalized {
		b.WriteString("- Attendance finalized: yes\n")
	} else {
		b.WriteString("- Attendance finalized: no (provisional)\n")
	}
	for _, st := range attendanceOrder {
		if names := a.NamesByStatus[st.status]; len(names) > 0 {
			fmt.Fprintf(b, "- %s: <untrusted source=\"attendance\">%s</untrusted>\n", st.label, strings.Join(names, ", "))
		}
	}
}

// renderMotionFacts writes each closed vote's counted result; the title is
// the only user-typed text and sits inside an untrusted tag.
func renderMotionFacts(b *strings.Builder, motions []MotionFact) {
	b.WriteString("\nRecorded votes (system record — use exactly):\n")
	for i, mo := range motions {
		required := fmt.Sprintf("%d yes votes required", mo.Required)
		if mo.Required == 0 {
			required = "no eligible voters"
		}
		fmt.Fprintf(b, "- Vote %d: %s · %s · yes %d · no %d · abstain %d · %s\n",
			i+1, mo.Outcome, ballotLabel(mo.BallotMode), mo.Yes, mo.No, mo.Abstain, required)
		fmt.Fprintf(b, "  Title: <untrusted source=\"motions\">%s</untrusted>\n", mo.Title)
	}
}

func ballotLabel(mode string) string {
	if mode == "SECRET" {
		return "secret ballot"
	}
	return "open ballot"
}

func init() {
	register(Prompt{
		ID: "meeting_summary", Version: 1,
		System:       meetingSummaryRules + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingSummarySchema),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, false) },
	})
	register(Prompt{
		ID: "meeting_summary", Version: 2,
		System:       meetingSummaryRules + meetingSummaryFactRules + UntrustedFooter,
		OutputSchema: json.RawMessage(meetingSummarySchema),
		Render:       func(vars map[string]any) string { return renderMeetingSummary(vars, true) },
	})

	register(Prompt{
		ID: "copilot_answer", Version: 1,
		System: `You are UNI, a colleague inside a Vietnamese team's work OS. You answer questions about the team's tasks, meetings, chat and members using ONLY the numbered sources the caller provides.
Respond with a single JSON object and nothing else, shaped exactly as:
{"answer": string, "citations": [{"source_id": string, "quote": string}]}
- "answer": a direct, concise reply in the caller's language. Refer to a source inline as [S1], [S2] … exactly as numbered.
- "citations": one entry per source you relied on; "quote" is a short verbatim excerpt from that source.
- If the sources do not contain the answer, say so plainly and return an empty "citations" array. Never guess, never mention data outside the sources, never reveal email addresses or phone numbers even if a source contains them.
- Tone: a helpful colleague, no mascot voice, no emojis.
` + UntrustedFooter,
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"answer":{"type":"string"},"citations":{"type":"array","items":{"type":"object","properties":{"source_id":{"type":"string"},"quote":{"type":"string"}},"required":["source_id","quote"],"additionalProperties":false}}},"required":["answer","citations"],"additionalProperties":false}`),
		Render: func(vars map[string]any) string {
			var b strings.Builder
			fmt.Fprintf(&b, "Output language: %s\nToday: %s\n\n", language(str(vars, "locale")), str(vars, "today"))
			if src := str(vars, "sources"); src != "" {
				fmt.Fprintf(&b, "Sources:\n%s\n", src)
			} else {
				b.WriteString("Sources: (none — the workspace has nothing the asker may read about this)\n")
			}
			fmt.Fprintf(&b, "\nQuestion:\n<untrusted source=\"question\">%s</untrusted>\n", str(vars, "question"))
			return b.String()
		},
	})

	register(Prompt{
		ID: "chat_catchup", Version: 1,
		System: `You catch a teammate up on unread chat in a Vietnamese work OS.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "highlights": string[], "action_items": [{"title": string, "owner": string, "due": string, "source_id": string}]}
- "summary": 2-5 sentences covering what happened since they last read.
- "highlights": short bullet facts (decisions, blockers, @mentions); empty array if none.
- "action_items": concrete follow-ups implied by the messages; "title" is imperative; "owner" is a display name from the sources or ""; "due" as spoken or ""; "source_id" is the [S#] of the message that motivated the item when known, else "".
- Write every string in the language named by the caller. Do not invent messages absent from the sources.
- Tone: a helpful colleague, no mascot voice, no emojis.
` + UntrustedFooter,
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"},"highlights":{"type":"array","items":{"type":"string"}},"action_items":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"},"source_id":{"type":"string"}},"required":["title","owner","due","source_id"],"additionalProperties":false}}},"required":["summary","highlights","action_items"],"additionalProperties":false}`),
		Render: func(vars map[string]any) string {
			var b strings.Builder
			fmt.Fprintf(&b, "Output language: %s\nToday: %s\nScope: %s\nMessages since: %s\n\n",
				language(str(vars, "locale")), str(vars, "today"), str(vars, "scope"), str(vars, "since"))
			if src := str(vars, "sources"); src != "" {
				fmt.Fprintf(&b, "Sources:\n%s\n", src)
			} else {
				b.WriteString("Sources: (none)\n")
			}
			return b.String()
		},
	})

	register(Prompt{
		ID: "chat_call_summary", Version: 1,
		System: `You summarize a completed voice call in a Vietnamese work chat room.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "highlights": string[], "action_items": [{"title": string, "owner": string, "due": string, "source_id": string}]}
- "summary": 2-5 sentences on what was discussed or decided during the call.
- "highlights": short bullet facts; empty array if none.
- "action_items": concrete follow-ups; "title" is imperative; "owner" is a display name from the sources or ""; "due" as spoken or ""; "source_id" is the [S#] of the chat line that motivated the item when known, else "".
- When only call metadata is present (no chat lines), summarize who joined and the call length; do not invent discussion topics.
- Write every string in the language named by the caller. Tone: helpful colleague, no emojis.
` + UntrustedFooter,
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"},"highlights":{"type":"array","items":{"type":"string"}},"action_items":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"},"source_id":{"type":"string"}},"required":["title","owner","due","source_id"],"additionalProperties":false}}},"required":["summary","highlights","action_items"],"additionalProperties":false}`),
		Render: func(vars map[string]any) string {
			var b strings.Builder
			fmt.Fprintf(&b, "Output language: %s\nToday: %s\nCall duration: %s\nParticipants: %s\n\n",
				language(str(vars, "locale")), str(vars, "today"), str(vars, "duration"), str(vars, "participants"))
			if src := str(vars, "sources"); src != "" {
				fmt.Fprintf(&b, "Sources:\n%s\n", src)
			} else {
				b.WriteString("Sources: (none)\n")
			}
			return b.String()
		},
	})

	register(Prompt{
		ID: "email_thread_summary", Version: 1,
		System: `You summarize one email thread for a Vietnamese work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "key_points": string[], "action_items": [{"title": string, "owner": string, "due": string}], "needs_reply": boolean, "reply_hint": string}
- "summary": 2-4 sentences on what the thread is about and the current state.
- "key_points": concrete facts, requests, or decisions; empty array if none.
- "action_items": tasks someone should do; "title" is imperative; "owner" is a name as written or ""; "due" is a date or relative time as written or "".
- "needs_reply": whether the reader likely owes a reply.
- "reply_hint": one short sentence on what to answer if needs_reply is true, else "".
- Write every string in the language named by the caller.
` + UntrustedFooter,
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"},"key_points":{"type":"array","items":{"type":"string"}},"action_items":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"}},"required":["title","owner","due"],"additionalProperties":false}},"needs_reply":{"type":"boolean"},"reply_hint":{"type":"string"}},"required":["summary","key_points","action_items","needs_reply","reply_hint"],"additionalProperties":false}`),
		Render: func(vars map[string]any) string {
			var b strings.Builder
			fmt.Fprintf(&b, "Output language: %s\nSubject: %s\nFrom: %s\nTo: %s\nSent: %s\n\n",
				language(str(vars, "locale")), str(vars, "subject"), str(vars, "from"), str(vars, "to"), str(vars, "sent_at"))
			b.WriteString("Body:\n<untrusted source=\"email_body\">\n")
			b.WriteString(str(vars, "body"))
			b.WriteString("\n</untrusted>\n")
			return b.String()
		},
	})
}
