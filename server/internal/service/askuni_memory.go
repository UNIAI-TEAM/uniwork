package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askWithMemory is the dock prompt with the asker's memory for each one
// without (R8). A turn sent the write tools runs @20 to @23 (UNI-2158), so
// @14, @15, @18 and @19 are no longer picked.
var askWithMemory = map[string]string{
	ai.PromptCopilotAnswerV4: ai.PromptCopilotAnswerV12, ai.PromptCopilotAnswerV5: ai.PromptCopilotAnswerV13,
	ai.PromptCopilotAnswerV8: ai.PromptCopilotAnswerV16, ai.PromptCopilotAnswerV9: ai.PromptCopilotAnswerV17,
	ai.PromptCopilotAnswerV20: ai.PromptCopilotAnswerV24, ai.PromptCopilotAnswerV21: ai.PromptCopilotAnswerV25,
	ai.PromptCopilotAnswerV22: ai.PromptCopilotAnswerV26, ai.PromptCopilotAnswerV23: ai.PromptCopilotAnswerV27,
}

// askMemoryTurn is the asker's memory as one turn sees it: the entries in M#
// order (preferences first) and the M# to id table. An M# means something only inside its turn (R6).
type askMemoryTurn struct {
	entries []db.AiMemory
	refs    map[string]string
	// drafts are the turn's propose_memory rows so far: row N is drafts[N-1].
	drafts []askMemoryDraft
}

// askMemoryDraft is one memory row of a turn, stored with its answer. Kind and
// Body are what a remember or update saves; BeforeKind and BeforeBody the
// entry an update or forget names, as it stood.
type askMemoryDraft struct{ Action, MemoryID, Kind, Body, BeforeKind, BeforeBody string }

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

// askProposeMemoryTool is the tool a memory turn adds after the read and write
// tools (R10). It is not one of ADR 0044's write tools: a call drafts a row in
// the turn and saves nothing. Its bytes are a literal, so the cache prefix holds.
// It names no Undo because it saves nothing: the undo is the memory
// proposal's own, once the asker applies it.
var askProposeMemoryTool = ai.Tool{
	Name:        "propose_memory",
	Description: "Propose to remember, change or forget one entry of the asker's memory. Saves nothing: the asker decides on each proposal.",
	Kind:        ai.ToolWrite, Risk: ai.RiskLow,
	Schema: json.RawMessage(`{"type":"object","properties":{"action":{"type":"string","enum":["remember","update","forget"]},"entry":{"type":"string","pattern":"^M[0-9]+$"},"kind":{"type":"string","enum":["preference","fact"]},"text":{"type":"string","maxLength":300}},"required":["action"],"additionalProperties":false}`),
}

// propose answers one propose_memory call (R10): past askMaxMemoryRows rows it
// is refused; otherwise a valid call drafts a row and the model reads back
// what was recorded, an invalid one what to correct. A refused call counts no row.
func (m *askMemoryTurn) propose(args json.RawMessage) (content, status string) {
	if len(m.drafts) >= askMaxMemoryRows {
		return "error: too_many_memory_rows", "error"
	}
	d, line, code := m.draft(args)
	if code != "" {
		return "error: " + code, "error"
	}
	m.drafts = append(m.drafts, d)
	return "memory row " + strconv.Itoa(len(m.drafts)) + " recorded: " + line + ". The asker decides; do not call it again.", "ok"
}

// draft checks one call against the turn's memory and earlier drafts, and
// returns its row and readback, or the error code the model reads.
func (m *askMemoryTurn) draft(args json.RawMessage) (d askMemoryDraft, line, code string) {
	var a struct {
		Action string  `json:"action"`
		Entry  string  `json:"entry"`
		Kind   *string `json:"kind"`
		Text   *string `json:"text"`
	}
	if err := json.Unmarshal(args, &a); err != nil {
		return d, "", "invalid_args: arguments must be a JSON object"
	}
	invalid := func(msg string) (askMemoryDraft, string, string) {
		return askMemoryDraft{}, "", "invalid_args: " + msg
	}
	var cur db.AiMemory
	if a.Action == "update" || a.Action == "forget" {
		if a.Entry == "" {
			return invalid(a.Action + " needs entry")
		}
		i := slices.IndexFunc(m.entries, func(e db.AiMemory) bool { return e.ID == m.refs[a.Entry] })
		if i < 0 {
			return invalid("unknown entry " + a.Entry)
		}
		cur = m.entries[i]
		// Two cards on one entry would contradict each other; the second
		// would fail at apply.
		if slices.ContainsFunc(m.drafts, func(d askMemoryDraft) bool { return d.MemoryID == cur.ID }) {
			return invalid("entry " + a.Entry + " already has a proposal in this turn")
		}
	}
	d = askMemoryDraft{Action: a.Action, MemoryID: cur.ID, Kind: cur.Kind, Body: cur.Body, BeforeKind: cur.Kind, BeforeBody: cur.Body}
	switch a.Action {
	case "remember":
		if a.Kind == nil || a.Text == nil {
			return invalid("remember needs kind and text")
		}
	case "update":
		if a.Kind == nil && a.Text == nil {
			return invalid("update needs kind or text")
		}
	case "forget":
		return askMemoryDraft{Action: a.Action, MemoryID: cur.ID, BeforeKind: cur.Kind, BeforeBody: cur.Body},
			"forget " + a.Entry + ` "` + askQuoted(cur.Body) + `"`, ""
	default:
		return invalid("action must be remember, update or forget")
	}
	if a.Kind != nil {
		if err := validMemoryKind(*a.Kind); err != nil {
			return invalid(err.Error())
		}
		d.Kind = *a.Kind
	}
	if a.Text != nil {
		body, err := validMemoryText(*a.Text)
		if err != nil {
			return invalid(err.Error())
		}
		d.Body = body
	}
	// The cap counts this turn's remember drafts as entries; duplicates also
	// count the new text of its update drafts, so two cards never save one text.
	taken, adds := slices.Clone(m.entries), 0
	for _, e := range m.drafts {
		switch e.Action {
		case "remember":
			adds++
			taken = append(taken, db.AiMemory{ID: "draft", Body: e.Body})
		case "update":
			taken = append(taken, db.AiMemory{ID: "draft", Body: e.Body})
		}
	}
	if a.Action == "remember" && len(m.entries)+adds >= aiMemoryMaxEntries {
		return askMemoryDraft{}, "", errAiMemoryFull.Code
	}
	if a.Text != nil && aiMemoryTaken(taken, cur.ID, d.Body) {
		return askMemoryDraft{}, "", errAiMemoryDuplicate.Code
	}
	if a.Action == "remember" {
		return d, "remember (" + d.Kind + `) "` + askQuoted(d.Body) + `"`, ""
	}
	return d, "update " + a.Entry + " (" + d.Kind + `) "` + askQuoted(cur.Body) + `" → "` + askQuoted(d.Body) + `"`, ""
}

// insertTurnMemoryProposals writes a turn's memory rows for its answer msgID,
// from position 1, pending for aiMemoryProposalTTL, owned by the asker
// (spec §5.3), inside store's transaction.
func (s *AskUNIService) insertTurnMemoryProposals(ctx context.Context, q *db.Queries, orgID, workspaceID, convID, msgID, userID string, drafts []askMemoryDraft) error {
	expires := pgtype.Timestamptz{Time: s.now().Add(aiMemoryProposalTTL), Valid: true}
	for i, d := range drafts {
		if _, err := q.AiInsertMemoryProposal(ctx, db.AiInsertMemoryProposalParams{
			ID: util.NewID(), OrganizationID: orgID, WorkspaceID: workspaceID, ConversationID: convID, MessageID: msgID,
			Position: int32(i + 1), Action: d.Action, MemoryID: strText(d.MemoryID), Kind: strText(d.Kind), Body: strText(d.Body),
			BeforeKind: strText(d.BeforeKind), BeforeBody: strText(d.BeforeBody), ExpiresAt: expires,
			CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		}); err != nil {
			return err
		}
	}
	return nil
}

// AskMemoryProposal is one memory proposal row as the asker sees it.
type AskMemoryProposal struct {
	ID, MessageID                                                string
	Position                                                     int
	Action, MemoryID, Kind, Text, BeforeKind, BeforeText, Status string
	ExpiresAt                                                    time.Time
}

// askMemoryProposalOf is row as the asker sees it: a pending row past its
// expiry reads expired (R13).
func askMemoryProposalOf(row db.AiMemoryProposal, now time.Time) AskMemoryProposal {
	p := AskMemoryProposal{
		ID: row.ID, MessageID: row.MessageID, Position: int(row.Position), Action: row.Action, MemoryID: row.MemoryID.String,
		Kind: row.Kind.String, Text: row.Body.String, BeforeKind: row.BeforeKind.String, BeforeText: row.BeforeBody.String,
		Status: row.Status, ExpiresAt: row.ExpiresAt.Time,
	}
	if p.Status == "pending" && now.After(p.ExpiresAt) {
		p.Status = "expired"
	}
	return p
}

// MessageMemoryProposals is every memory row of the answers named, in
// position order. The caller has already shown the answers are the reader's.
func (s *AskUNIService) MessageMemoryProposals(ctx context.Context, orgID string, msgIDs []string) (map[string][]AskMemoryProposal, error) {
	out := map[string][]AskMemoryProposal{}
	if len(msgIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.AiListMemoryProposalsForMessages(ctx, db.AiListMemoryProposalsForMessagesParams{OrganizationID: orgID, MessageIds: msgIDs})
	if err != nil {
		return nil, err
	}
	now := s.now()
	for _, r := range rows {
		out[r.MessageID] = append(out[r.MessageID], askMemoryProposalOf(r, now))
	}
	return out, nil
}

// turnMemoryProposals is a stored turn's memory rows, once each is counted
// proposed (R19). A read that fails leaves the event empty; the asker sees
// the rows when the conversation is read again.
func (s *AskUNIService) turnMemoryProposals(ctx context.Context, orgID, msgID string, n int) []AskMemoryProposal {
	if s.agentMetrics != nil {
		for range n {
			s.agentMetrics.ObserveAskMemory("proposed")
		}
	}
	byMsg, err := s.MessageMemoryProposals(ctx, orgID, []string{msgID})
	if err != nil {
		slog.Warn("ask uni: reading a turn's memory proposals failed", "organization_id", orgID, "message_id", msgID, "error", err)
		return nil
	}
	return byMsg[msgID]
}

// historyMemoryProposals adds to each earlier answer in hist what its memory
// proposals became, one line a row (R11):
// Memory proposals: row 1 remember (preference) "…" — applied.
// hist is history(rows, …), which replays historyWindow(rows) one for one.
func (s *AskUNIService) historyMemoryProposals(ctx context.Context, orgID string, rows []db.AiMessage, hist []provider.Message) error {
	kept := historyWindow(rows)
	var ids []string
	for _, r := range kept {
		if r.Role == "assistant" {
			ids = append(ids, r.ID)
		}
	}
	byMsg, err := s.MessageMemoryProposals(ctx, orgID, ids)
	if err != nil {
		return err
	}
	for i, r := range kept {
		ps := byMsg[r.ID]
		if len(ps) == 0 {
			continue
		}
		lines := make([]string, len(ps))
		for j, p := range ps {
			what := p.Action + ` "` + askQuoted(p.BeforeText) + `"` // forget
			switch p.Action {
			case "remember":
				what = "remember (" + p.Kind + `) "` + askQuoted(p.Text) + `"`
			case "update":
				what = "update (" + p.Kind + `) "` + askQuoted(p.BeforeText) + `" → "` + askQuoted(p.Text) + `"`
			}
			lines[j] = fmt.Sprintf("Memory proposals: row %d %s — %s", p.Position, what, p.Status)
		}
		hist[i].Content += "\n" + ai.WrapUntrusted("prior_memory_proposals", strings.Join(lines, "\n"))
	}
	return nil
}
