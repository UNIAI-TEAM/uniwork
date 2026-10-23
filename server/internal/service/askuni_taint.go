package service

import (
	"context"
	"log/slog"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Taint (ADR 0044, ruling R8): a turn is tainted when it read content someone
// other than the asker wrote, and a tainted turn never auto-applies a write.
// This file only computes and records the mark; Task 10 reads it.

// askTaint is one run's view of it: conv is whether the conversation carries
// tainted_at already, turn whether this turn read foreign content.
type askTaint struct{ conv, turn bool }

func (t askTaint) tainted() bool { return t.conv || t.turn }

// convTainted reads a conversation's mark. One from before taint was tracked is
// tainted: nobody knows what it read.
func convTainted(c db.AiConversation) bool { return c.TaintedAt.Valid || !c.TaintTracked }

// markMine sets Mine on every item that has a Key (content the model saw)
// by R8, one authorship query per kind. Fail closed: a kind whose query fails,
// an unknown kind and an item without an ID stay not Mine. Notes and errors
// carry no Key and are never marked.
func (s *AskUNIService) markMine(ctx context.Context, tc ai.ToolContext, items []agentItem) error {
	ids := map[string][]string{}
	for _, it := range items {
		if it.Key == "" {
			continue
		}
		if _, audited := askAuditKinds[it.Kind]; audited && it.ID != "" && !slices.Contains(ids[it.Kind], it.ID) {
			ids[it.Kind] = append(ids[it.Kind], it.ID)
		}
	}
	authored := map[string]map[string]bool{}
	var firstErr error
	for kind, list := range ids {
		got, err := s.authoredByAsker(ctx, tc, kind, list)
		if err != nil {
			slog.Warn("ask uni: taint authorship lookup failed", "organization_id", tc.OrganizationID, "workspace_id", tc.WorkspaceID, "kind", kind, "error", err)
			firstErr = err
			continue
		}
		authored[kind] = got
	}
	for i := range items {
		it := &items[i]
		if it.Key == "" {
			continue
		}
		switch it.Kind {
		case "member", "members": // names and roles: labels, not content
			it.Mine = true
		case "chat": // the tool decided from the messages it showed
		case "task", "project", "meeting", "document":
			it.Mine = !it.Foreign && it.ID != "" && authored[it.Kind][it.ID]
		default: // email threads, files, anything unknown
			it.Mine = false
		}
	}
	return firstErr
}

// noteTaint taints the turn from the first item that has a Key and is not
// Mine, and the conversation with it (once, for good).
func (s *AskUNIService) noteTaint(ctx context.Context, orgID, convID string, t *askTaint, items []agentItem) {
	if slices.ContainsFunc(items, func(it agentItem) bool { return it.Key != "" && !it.Mine }) {
		s.taintNow(ctx, orgID, convID, t)
	}
}

// taintFrom is markMine then noteTaint; an authorship failure only logs, the
// items it could not check taint the turn.
func (s *AskUNIService) taintFrom(ctx context.Context, tc ai.ToolContext, convID string, t *askTaint, items []agentItem) {
	if len(items) == 0 {
		return
	}
	_ = s.markMine(ctx, tc, items) // logged inside; the unchecked items stay not Mine
	s.noteTaint(ctx, tc.OrganizationID, convID, t, items)
}

// taintNow taints the turn and records the conversation's mark. The write
// outlives a cancelled request: a turn that read foreign content and was
// stopped is still tainted.
func (s *AskUNIService) taintNow(ctx context.Context, orgID, convID string, t *askTaint) {
	t.turn = true
	if t.conv {
		return
	}
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), askAgentStoreTimeout)
	defer cancel()
	if err := s.q.AiMarkConversationTainted(wctx, db.AiMarkConversationTaintedParams{ID: convID, OrganizationID: orgID}); err != nil {
		slog.Warn("ask uni: marking a conversation tainted failed", "organization_id", orgID, "conversation_id", convID, "error", err)
		return // the turn stays tainted; the next read retries the write
	}
	t.conv = true
}
