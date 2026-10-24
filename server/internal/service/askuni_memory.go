package service

import (
	"context"
	"strconv"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askWithMemory is the dock prompt with the asker's memory for each one
// without (R8).
var askWithMemory = map[string]string{
	ai.PromptCopilotAnswerV4: ai.PromptCopilotAnswerV12, ai.PromptCopilotAnswerV5: ai.PromptCopilotAnswerV13,
	ai.PromptCopilotAnswerV6: ai.PromptCopilotAnswerV14, ai.PromptCopilotAnswerV7: ai.PromptCopilotAnswerV15,
	ai.PromptCopilotAnswerV8: ai.PromptCopilotAnswerV16, ai.PromptCopilotAnswerV9: ai.PromptCopilotAnswerV17,
	ai.PromptCopilotAnswerV10: ai.PromptCopilotAnswerV18, ai.PromptCopilotAnswerV11: ai.PromptCopilotAnswerV19,
}

// askMemoryTurn is the asker's memory as one turn sees it: the entries in M#
// order (preferences first) and the M# to id table. An M# means something only inside its turn (R6).
type askMemoryTurn struct {
	entries []db.AiMemory
	refs    map[string]string
}

// turnMemory reads the asker's memory for this turn. It is nil unless the
// turn is a dock turn with the agent on, ask_uni_memory on and the asker's
// own switch on (R9); a failed read fails the turn like any other read.
func (s *AskUNIService) turnMemory(ctx context.Context, tc ai.ToolContext, in AskInput) (*askMemoryTurn, error) {
	if !in.Dock || s.memory == nil || !s.agentOn(ctx, tc) || !s.memory.AskMemoryEnabled(ctx, tc.ActorID, tc.OrganizationID) {
		return nil, nil
	}
	off, err := s.q.GetUserAskUniMemoryOff(ctx, tc.ActorID)
	if err != nil || off {
		return nil, err
	}
	rows, err := s.q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: tc.OrganizationID, UserID: tc.ActorID})
	if err != nil {
		return nil, err
	}
	m := &askMemoryTurn{entries: rows, refs: make(map[string]string, len(rows))}
	for i, r := range rows {
		m.refs["M"+strconv.Itoa(i+1)] = r.ID
	}
	if s.agentMetrics != nil {
		s.agentMetrics.ObserveAskMemoryEntries(len(rows))
	}
	return m, nil
}

// promptEntries is the entries as the prompt lists them, never nil.
func (m *askMemoryTurn) promptEntries() []ai.MemoryEntry {
	out := make([]ai.MemoryEntry, len(m.entries))
	for i, e := range m.entries {
		out[i] = ai.MemoryEntry{Ref: "M" + strconv.Itoa(i+1), Kind: e.Kind, Body: e.Body}
	}
	return out
}
