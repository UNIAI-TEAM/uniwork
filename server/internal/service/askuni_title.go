package service

import (
	"context"
	"log/slog"
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
	}
	return trimTitle(t)
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
