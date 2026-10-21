package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Live caption translation (scribe spec §5.3 B9, §8): the scribe agent sends
// a second's worth of final captions and the server asks for them in one
// target language. Nothing is stored; the caller maps the labels back.

// PromptCaptionTranslate is caption_translate@1.
const PromptCaptionTranslate = "caption_translate@1"

// CaptionLine is one caption the model translates, under its per-call label.
type CaptionLine struct {
	Label string
	Text  string
}

// CaptionTranslation is one translated line, under the label it came with.
type CaptionTranslation struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

const captionTranslateRules = `You translate the live captions of a meeting for a Vietnamese work team.
Respond with a single JSON object and nothing else, shaped exactly as:
{"translations": [{"id": string, "text": string}]}
- Translate every caption line into the target language named by the caller. Each line starts with an id in square brackets, for example [T1]; answer one entry per line, with that id written without brackets.
- Translate only. Never add, leave out, explain or summarize anything; keep the meaning, the tone and roughly the length of the line. Keep numbers, dates and units as they are said.
- Keep proper names of people, companies, products and places exactly as written. Keep every term of the glossary exactly as written there.
- A line already in the target language comes back unchanged.
- The captions come from automatic speech recognition and may contain misheard words. Do not invent words to repair them; translate what is there.
`

const captionTranslateSchema = `{"type":"object","properties":{"translations":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"text":{"type":"string"}},"required":["id","text"],"additionalProperties":false}}},"required":["translations"],"additionalProperties":false}`

func init() {
	register(Prompt{
		ID: "caption_translate", Version: 1,
		System:       captionTranslateRules + UntrustedFooter,
		OutputSchema: json.RawMessage(captionTranslateSchema),
		Render:       renderCaptionTranslate,
	})
}

// renderCaptionTranslate: vars "target" (vi | en), "glossary" ([]string:
// the meeting's title and names), "captions" ([]CaptionLine).
func renderCaptionTranslate(vars map[string]any) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Target language: %s\n", language(str(vars, "target")))
	if terms, _ := vars["glossary"].([]string); len(terms) > 0 {
		b.WriteString("\nGlossary:\n<untrusted source=\"glossary\">\n")
		for _, t := range terms {
			fmt.Fprintf(&b, "- %s\n", EscapeUntrustedLine(t))
		}
		b.WriteString("</untrusted>\n")
	}
	b.WriteString("\nCaptions:\n<untrusted source=\"captions\">\n")
	lines, _ := vars["captions"].([]CaptionLine)
	for _, l := range lines {
		fmt.Fprintf(&b, "[%s] %s\n", l.Label, EscapeUntrustedLine(l.Text))
	}
	b.WriteString("</untrusted>\n")
	return b.String()
}

// ParseCaptionTranslateJSON reads caption_translate output. Entries without
// an id or a text are dropped; whether an id names a line of the input is
// the caller's check.
func ParseCaptionTranslateJSON(s string) ([]CaptionTranslation, error) {
	raw, err := extractJSON(s)
	if err != nil {
		return nil, ErrOutputInvalid.wrap(err)
	}
	var out struct {
		Translations *[]CaptionTranslation `json:"translations"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, ErrOutputInvalid.wrap(fmt.Errorf("parse caption translations: %w", err))
	}
	if out.Translations == nil {
		return nil, ErrOutputInvalid.wrap(errors.New("no translations"))
	}
	kept := make([]CaptionTranslation, 0, len(*out.Translations))
	for _, t := range *out.Translations {
		t.ID, t.Text = strings.TrimSpace(t.ID), strings.TrimSpace(t.Text)
		if t.ID != "" && t.Text != "" {
			kept = append(kept, t)
		}
	}
	return kept, nil
}
