package service

import (
	"context"
	"html"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AskTitleEvent is the title UNI gave a new conversation.
type AskTitleEvent struct{ ConversationID, Title string }

const (
	// askGenTitleMax is the longest generated title, in runes.
	askGenTitleMax = 40
	// askTitleTimeout bounds the one short call that names a conversation.
	askTitleTimeout = 10 * time.Second
)

// cleanTitle is the model's reply as a one-line title: no surrounding quotes
// or trailing sentence marks, single spaces, at most askGenTitleMax runes.
func cleanTitle(raw string) string {
	t := strings.Join(strings.Fields(sourceRef.ReplaceAllString(raw, "")), " ")
	if r := []rune(trimTitle(t)); len(r) > askGenTitleMax {
		t = string(r[:askGenTitleMax])
		// A cut inside a word ends at the word before it; one long word keeps the hard cut.
		if r[askGenTitleMax] != ' ' {
			if i := strings.LastIndexByte(t, ' '); i > 0 {
				t = t[:i]
			}
		}
	}
	return trimTitle(t)
}

// questionTitle is the title a question gives its conversation until one is
// generated: the dock composer's markdown read as the plain text typed, on one
// line, cut at askTitleMax runes.
func questionTitle(q string) string {
	var parts []string
	fenced := false
	for _, line := range strings.Split(q, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") {
			fenced = !fenced
			continue
		}
		if !fenced {
			t = plainInline(markdownLinePrefix.ReplaceAllString(t, ""))
		}
		parts = append(parts, t)
	}
	title := strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
	if r := []rune(title); len(r) > askTitleMax {
		title = string(r[:askTitleMax]) + "…"
	}
	return title
}

// markdownLinePrefix is a quote or list marker at the start of a line.
var markdownLinePrefix = regexp.MustCompile(`^(?:>\s?)*(?:[-*+]\s+|\d+[.)]\s+)?`)

// plainInline drops the composer's inline marks (** * ~~ `) and reads its
// backslash escapes and html entities back as the characters typed. The
// composer escapes neither inside code, so a code span keeps its text as is.
func plainInline(s string) string {
	var out, run strings.Builder
	flush := func() {
		out.WriteString(html.UnescapeString(run.String()))
		run.Reset()
	}
	code := false
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '`':
			flush()
			code = !code
		case code:
			out.WriteByte(c)
		case c == '\\' && i+1 < len(s) && strings.IndexByte("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", s[i+1]) >= 0:
			i++
			run.WriteByte(s[i])
		case c == '*' || c == '~':
		default:
			run.WriteByte(c)
		}
	}
	flush()
	return out.String()
}

// trimTitle strips quotes, sentence marks and spaces from both ends until
// nothing more comes off: `"Việc trễ".` is `Việc trễ`.
func trimTitle(t string) string {
	for {
		n := strings.TrimRight(strings.Trim(t, "\"'“”«» "), ".!?: ")
		if n == t {
			return t
		}
		t = n
	}
}

// generateTitle names a conversation after its first answer with one short
// call on the fast model. It reports the stored title, or false when nothing
// was renamed: a failed call, an empty title, or a title that is no longer
// the question's (a rename won, ruling P2b). A failure is logged by ids only
// and never reaches the asker.
func (s *AskUNIService) generateTitle(ctx context.Context, actor Actor, orgID, wsID, convID, question, answer string) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, askTitleTimeout)
	defer cancel()
	resp, err := s.gw.Complete(ctx, ai.Request{
		Actor: actor, OrganizationID: orgID, WorkspaceID: wsID,
		Capability: ai.CapCopilotTitle, PromptID: ai.PromptConversationTitle,
		Vars: map[string]any{"question": question, "answer": answer},
	})
	if err != nil {
		slog.Warn("ask uni: title call failed", "organization_id", orgID, "conversation_id", convID, "err", err)
		return "", false
	}
	title := cleanTitle(ai.StripUntrustedTags(resp.Text))
	if title == "" {
		return "", false
	}
	// Only a title still taken from the question is replaced; one row or none.
	n, err := s.q.AiSetGeneratedTitle(ctx, db.AiSetGeneratedTitleParams{ID: convID, Title: title})
	if err != nil {
		slog.Warn("ask uni: title not stored", "organization_id", orgID, "conversation_id", convID, "err", err)
		return "", false
	}
	return title, n > 0
}
