package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Prompt keys used by callers.
const (
	PromptMeetingSummary     = "meeting_summary@1"
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

func init() {
	register(Prompt{
		ID: "meeting_summary", Version: 1,
		System: `You turn meeting transcripts and notes into a written record for a Vietnamese work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"summary": string, "decisions": string[], "action_items": [{"title": string, "owner": string, "due": string}]}
- "summary": 3-6 sentences covering what was discussed and the outcome.
- "decisions": concrete decisions that were made; empty array if none.
- "action_items": tasks someone must do next; "title" is an imperative sentence, "owner" is the person's name as spoken or "", "due" is a date/relative time as spoken or "".
- Write every string in the language named by the caller.
` + UntrustedFooter,
		OutputSchema: json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"action_items":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"owner":{"type":"string"},"due":{"type":"string"}},"required":["title","owner","due"],"additionalProperties":false}}},"required":["summary","decisions","action_items"],"additionalProperties":false}`),
		Render: func(vars map[string]any) string {
			var b strings.Builder
			fmt.Fprintf(&b, "Output language: %s\nMeeting title: %s\n", language(str(vars, "locale")), str(vars, "title"))
			if agenda := strings.TrimSpace(str(vars, "agenda")); agenda != "" {
				fmt.Fprintf(&b, "Agenda:\n<untrusted source=\"agenda\">%s</untrusted>\n", agenda)
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
		},
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
