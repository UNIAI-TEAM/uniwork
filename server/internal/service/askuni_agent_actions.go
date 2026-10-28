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

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's write tools in the agent loop (ADR 0044, R11, R12, R18). A write
// call runs only its tool's prepare: it records a row in the turn's memory and
// the model reads back that it did. Only a turn that answers stores its rows,
// with the answer, in one transaction. After the store, Auto mode applies the
// level-1 rows of an untainted turn through applyRow, and only then do the
// rows reach the asker, each in its current state.

// AskMaxProposalRows is askMaxProposalRows for the API: the most rows one
// answer holds, so the most one apply-all may name.
const AskMaxProposalRows = askMaxProposalRows

const (
	// askMaxProposalRows caps a turn's rows (ADR 0044 §3); the call after
	// them is answered "error: too_many_changes", unrun.
	askMaxProposalRows = 10
	// askAutoApplyBudget bounds starting Auto mode's rows, all of them; a row
	// already claimed finishes within askApplyTimeout.
	askAutoApplyBudget = 20 * time.Second
	// askRecordedValueMax is the longest value a recorded line shows, in runes.
	askRecordedValueMax = 80
)

// askWrites is the write side of one turn that is sent the write tools.
type askWrites struct {
	mode  string // the clamped mode its rows are stored with
	tools []askWriteTool
	rows  []askDraftRow // recorded so far: row N is rows[N-1]
	// tainted is the turn's taint at its end (conversation or turn), set just
	// before the store.
	tainted bool
}

// turnWrites is the write side of a turn, nil when it is sent no write tool
// (R2): only a dock turn, the flag on, and a ceiling that leaves a mode.
func (s *AskUNIService) turnWrites(ctx context.Context, tc ai.ToolContext, in AskInput) *askWrites {
	if !in.Dock || in.Transient {
		return nil
	}
	a := s.askActions(ctx, tc, in.Mode)
	if !a.Enabled || a.Mode == "" {
		return nil
	}
	return &askWrites{mode: a.Mode, tools: s.askWriteTools()}
}

// tool is the offered write tool named name.
func (w *askWrites) tool(name string) (askWriteTool, bool) {
	if w == nil {
		return askWriteTool{}, false
	}
	i := slices.IndexFunc(w.tools, func(t askWriteTool) bool { return t.Name == name })
	if i < 0 {
		return askWriteTool{}, false
	}
	return w.tools[i], true
}

func (w *askWrites) offered() []askWriteTool {
	if w == nil {
		return nil
	}
	return w.tools
}

// agentToolRegistry is what the model is sent: the read tools, then any write
// tools in R4 order. Both are part of the cache prefix
// (TestAskAgentToolBytesAreStable).
func agentToolRegistry(reads []agentTool, writes []askWriteTool) ai.Registry {
	r := agentRegistry(reads)
	for _, t := range writes {
		r = append(r, t.Tool)
	}
	return r
}

// agentWriteCall answers one call of a write tool: past the turn's rows it is
// refused unrun; otherwise prepare reads, rates and builds the row, and the
// model reads back that it was recorded or what to correct. items is what
// prepare read that the taint rules weigh. A Go error is the server's.
func (s *AskUNIService) agentWriteCall(ctx context.Context, w *askWrites, tool askWriteTool, tc ai.ToolContext, args json.RawMessage) (content, status, label string, items []agentItem, err error) {
	if len(w.rows) >= askMaxProposalRows {
		return "error: too_many_changes", "error", "", nil, nil
	}
	row, err := tool.prepare(ctx, tc, args, w.rows)
	if err != nil {
		if code, ok := agentError(err); ok {
			return "error: " + code, "error", "", nil, nil
		}
		return "", "", "", nil, err
	}
	label = clipLabel(row.Preview.Target.Title)
	items = askTargetRead(row)
	for i, r := range w.rows {
		if askTargetClash(r, row) {
			return fmt.Sprintf("error: invalid_args: row %d of this turn already changes this %s; make every change to one object in one call", i+1, row.TargetKind), "error", label, items, nil
		}
	}
	w.rows = append(w.rows, row)
	return askRecordedLine(len(w.rows), row), "ok", label, items, nil
}

// askTargetRead is what prepare read, as the taint rules see a read tool's
// items: the existing target, whose title and before-values reach the model,
// and every other object whose title a field shows (askDraftRow.Read). A room
// is only its name, a label (R8); an object this turn makes read nothing.
func askTargetRead(row askDraftRow) []agentItem {
	read := append([]AskContextRef{{Kind: row.TargetKind, ID: row.TargetID, Title: row.Preview.Target.Title}}, row.Read...)
	var out []agentItem
	for _, r := range read {
		if _, audited := askAuditKinds[r.Kind]; audited && r.ID != "" {
			out = append(out, agentItem{Kind: r.Kind, Key: r.Kind + "/" + r.ID, ID: r.ID, Title: r.Title})
		}
	}
	return out
}

// askTargetClash says whether row b, applied after row a, carries the
// revision of an existing object a changes: b would fail at apply. A row with
// no revision (a comment, an invite, a message) or on an object made this
// turn may follow others on the same object.
func askTargetClash(a, b askDraftRow) bool {
	return b.TargetRevision != nil && b.TargetID != "" && a.TargetKind == b.TargetKind && a.TargetID == b.TargetID
}

// askEditClash is askTargetClash for an edited row, against the answer's
// other pending rows in position order: the edit is refused, the row unchanged.
func (s *AskUNIService) askEditClash(ctx context.Context, row db.AgentActionProposal, d askDraftRow) error {
	answer, err := s.answerRows(ctx, s.q, row)
	if err != nil {
		return err
	}
	for _, r := range answer {
		if r.ID == row.ID || r.Status != proposalPending || r.Position == askAnswerPosition {
			continue
		}
		o := draftOfRow(r)
		if (r.Position < row.Position && askTargetClash(o, d)) || (r.Position > row.Position && askTargetClash(d, o)) {
			return McpInvalidArgs{Msg: fmt.Sprintf("row %d of this answer also changes this %s; make every change to one object in one row", r.Position, d.TargetKind)}
		}
	}
	return nil
}

// askMakers are the tools whose row makes an object later rows may name.
var askMakers = func() map[string]bool {
	out := map[string]bool{}
	for _, spec := range askIDFields {
		for _, maker := range spec.Refs {
			out[maker] = true
		}
	}
	return out
}()

// askRecordedLine is what the model reads back for row n (R11):
// proposal row 2 recorded: update_task "Viết spec" (status: todo → done). …
// Titles and values are the objects' own text, escaped like any untrusted line.
func askRecordedLine(n int, row askDraftRow) string {
	var b strings.Builder
	b.WriteString("proposal row " + strconv.Itoa(n) + " recorded: " + row.Tool + ` "` + askQuoted(row.Preview.Target.Title) + `"`)
	var parts []string
	for _, f := range row.Preview.Fields {
		part := f.Field + ": "
		if f.From != nil || row.TargetID != "" {
			part += askRecordedValue(f.From) + " → "
		}
		parts = append(parts, part+askRecordedValue(f.To))
	}
	if len(parts) > 0 {
		b.WriteString(" (" + strings.Join(parts, ", ") + ")")
	}
	b.WriteString(". The asker reviews it; do not call it again.")
	if askMakers[row.Tool] {
		b.WriteString(" Its id for later rows: {{row:" + strconv.Itoa(n) + ".id}}.")
	}
	return b.String()
}

func askRecordedValue(v any) string {
	var s string
	switch x := v.(type) {
	case nil:
	case string:
		s = x
	case []string:
		s = strings.Join(x, ", ")
	default:
		s = fmt.Sprint(x)
	}
	if s = oneLine(s); s == "" {
		return "none"
	}
	if r := []rune(s); len(r) > askRecordedValueMax {
		s = string(r[:askRecordedValueMax]) + "…"
	}
	return askQuoted(s)
}

// askQuoted is an object's own text on one line of server text: escaped like
// any untrusted line, with \ and " escaped so a quote in it cannot end the
// quoted title and pose as server text.
func askQuoted(s string) string {
	s = ai.EscapeUntrustedLine(oneLine(s))
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s)
}

// insertTurnProposals writes a turn's rows for its answer msgID, from position
// 1, inside store's transaction.
func (s *AskUNIService) insertTurnProposals(ctx context.Context, q *db.Queries, orgID, convID, msgID string, t askTurn) error {
	tc := ai.ToolContext{ActorID: t.UserID, OrganizationID: orgID, WorkspaceID: t.WorkspaceID}
	now := s.now()
	for i, d := range t.Proposals {
		p, err := askProposalParams(tc, convID, msgID, t.RunID, i+1, d, t.Mode, t.Tainted, now)
		if err != nil {
			return err
		}
		if _, err := q.AiInsertProposal(ctx, p); err != nil {
			return err
		}
	}
	return nil
}

// turnProposals runs once a turn's rows are stored: in Auto mode the level-1
// rows of an untainted turn are applied, and the rows are returned as they
// then stand. A read that fails leaves every row pending and the event empty;
// the asker sees the rows when the conversation is read again.
func (s *AskUNIService) turnProposals(ctx context.Context, userID, orgID, msgID string, w *askWrites) []AskProposal {
	for _, r := range w.rows {
		s.observeAction(r.Tool, "proposed")
	}
	read := func() ([]db.AgentActionProposal, error) {
		rctx, done := outliving(ctx)
		defer done()
		return s.q.AiListProposalsForMessages(rctx, db.AiListProposalsForMessagesParams{OrganizationID: orgID, MessageIds: []string{msgID}})
	}
	rows, err := read()
	if err == nil && w.mode == AskModeAuto && s.autoApply(ctx, userID, rows, w.tainted) {
		rows, err = read()
	}
	if err != nil {
		slog.Warn("ask uni: reading a turn's proposals failed", "organization_id", orgID, "message_id", msgID, "error", err)
		return nil
	}
	out := make([]AskProposal, len(rows))
	for i, r := range rows {
		out[i] = askProposalOf(r, s.now())
	}
	return out
}

// autoApply applies Auto mode's rows (R11): only the level-1 rows, in position
// order, only for a turn that read nothing someone else wrote and while the
// ceiling still allows Auto (R9 clamps at apply time too), as decision auto
// through applyRow, which checks every gate again. The group stops at the
// first row that fails or is refused; the rows after it stay pending. It
// reports whether it tried any row.
func (s *AskUNIService) autoApply(ctx context.Context, userID string, rows []db.AgentActionProposal, tainted bool) bool {
	if !slices.ContainsFunc(rows, func(r db.AgentActionProposal) bool { return r.RiskLevel == askLevel1 }) {
		return false
	}
	if tainted {
		if s.agentMetrics != nil {
			s.agentMetrics.ObserveAskTaintDowngrade()
		}
		return false
	}
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), askAutoApplyBudget)
	defer cancel()
	if c, err := s.askCeiling(actx, rows[0].OrganizationID); err != nil || clampAskMode(AskModeAuto, c) != AskModeAuto {
		return false
	}
	for _, r := range rows {
		if r.RiskLevel != askLevel1 {
			continue
		}
		if _, err := s.applyRow(actx, userID, r, AskModeAuto); err != nil {
			slog.Warn("ask uni: auto-apply stopped", "organization_id", r.OrganizationID, "proposal_id", r.ID, "error", err)
			break
		}
	}
	return true
}

// askPriorValueRunes caps each field value a history line repeats, so a long
// body costs the next turn little.
const askPriorValueRunes = 120

// askFieldValues is a row's fields as they stand now, after any edit the
// person made: `; due_date "2026-10-29", title "…"`. The answer text above
// still holds UNI's draft, so these are what the next turn must trust.
func askFieldValues(fs []AskProposalField) string {
	if len(fs) == 0 {
		return ""
	}
	parts := make([]string, len(fs))
	for i, f := range fs {
		v := ""
		switch x := f.To.(type) {
		case nil:
		case string:
			v = x
		default:
			b, _ := json.Marshal(x)
			v = string(b)
		}
		parts[i] = fmt.Sprintf(`%s "%s"`, askQuoted(f.Field), askQuoted(capRunes(v, askPriorValueRunes, "…")))
	}
	return "; " + strings.Join(parts, ", ")
}

// historyProposals adds to each earlier answer in hist what its proposals
// became, one line a row (R11): Proposals: row 1 create_task "…" — applied;
// title "…", due_date "…".
// hist is history(rows, …), which replays historyWindow(rows) one for one.
func (s *AskUNIService) historyProposals(ctx context.Context, orgID string, rows []db.AiMessage, hist []provider.Message) error {
	kept := historyWindow(rows)
	var ids []string
	for _, r := range kept {
		if r.Role == "assistant" {
			ids = append(ids, r.ID)
		}
	}
	byMsg, err := s.MessageProposals(ctx, orgID, ids)
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
			lines[j] = fmt.Sprintf(`Proposals: row %d %s "%s" — %s%s`, p.Position, p.Tool, askQuoted(p.Preview.Target.Title), p.Status, askFieldValues(p.Preview.Fields))
		}
		hist[i].Content += "\n" + ai.WrapUntrusted("prior_proposals", strings.Join(lines, "\n"))
	}
	return nil
}
