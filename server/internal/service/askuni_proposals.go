package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The executor of Ask UNI's proposals (ADR 0044, R13–R16). A row a turn
// proposed changes nothing until its asker decides. Applying claims the row
// (pending → applying), runs the tool's command as the asker under the
// proposal's audit via, and settles the row (applied | failed) with its audit
// row in one transaction. Every state change is an UPDATE guarded by the
// state it leaves, so two clicks run a command once.

const (
	askProposalTTL = 24 * time.Hour // R3
	// askProposalStuck is how long a row may be applying or undoing before it
	// reads unknown: the process that held it is taken to be gone (R3).
	askProposalStuck = 2 * time.Minute
	// askApplyTimeout bounds a claimed row's command and settle, which outlive
	// the request so a client that leaves does not strand the row.
	askApplyTimeout = 30 * time.Second
	// askAnswerPosition is the row "Tạo tài liệu" makes. The model's rows count
	// from 1, so no {{row:N.id}} names it.
	askAnswerPosition = 0
	// askApplyFailed is what a failed row stores when its command failed for a
	// reason that is not the command's own refusal.
	askApplyFailed = "apply_failed"
)

// The stored states of a row (R3); expired and unknown are only read.
const (
	proposalPending  = "pending"
	proposalApplying = "applying"
	proposalApplied  = "applied"
	proposalRejected = "rejected"
	proposalFailed   = "failed"
	proposalUndoing  = "undoing"
	proposalUndone   = "undone"
)

var (
	errProposalExpired    = CodedError{Code: "proposal_expired", Status: http.StatusConflict}
	errProposalNotPending = CodedError{Code: "proposal_not_pending", Status: http.StatusConflict}
	errProposalRefPending = CodedError{Code: "proposal_ref_pending", Status: http.StatusConflict}
	// errProposalNotAuto is an auto decision on a row Auto mode may not apply:
	// not level 1, tainted, or proposed outside auto mode.
	errProposalNotAuto = CodedError{Code: "proposal_not_auto", Status: http.StatusConflict}
)

// AskProposal is one row as its card reads it. Status is the state as read:
// a stored state, or expired (pending past ExpiresAt) or unknown (applying or
// undoing for longer than askProposalStuck).
type AskProposal struct {
	ID, MessageID                       string
	Position                            int
	Tool, Level, Mode, Status, Decision string
	Preview                             AskProposalPreview
	Result                              AskProposalResult
	CanUndo                             bool
	ErrorCode                           string
	Tainted                             bool
	ExpiresAt                           time.Time
}

func askExpired(row db.AgentActionProposal, now time.Time) bool {
	return !now.Before(row.ExpiresAt.Time)
}

func askProposalOf(row db.AgentActionProposal, now time.Time) AskProposal {
	p := AskProposal{
		ID: row.ID, MessageID: row.MessageID.String, Position: int(row.Position),
		Tool: row.ActionType, Level: row.RiskLevel, Mode: row.Mode, Status: row.Status, Decision: row.Decision.String,
		CanUndo: row.Status == proposalApplied && row.Undo.Valid, ErrorCode: row.Error.String,
		Tainted: row.Tainted, ExpiresAt: row.ExpiresAt.Time,
	}
	_ = json.Unmarshal([]byte(row.Preview), &p.Preview)
	_ = json.Unmarshal([]byte(row.Result), &p.Result)
	switch {
	case row.Status == proposalPending && askExpired(row, now):
		p.Status = "expired"
	case (row.Status == proposalApplying || row.Status == proposalUndoing) && now.Sub(row.UpdatedAt.Time) > askProposalStuck:
		p.Status = "unknown"
	}
	return p
}

// askProposalParams is the insert of draft d as tc's asker's pending row at
// position of one answer.
func askProposalParams(tc ai.ToolContext, convID, msgID, runID string, position int, d askDraftRow, mode string, tainted bool, now time.Time) (db.AiInsertProposalParams, error) {
	preview, err := json.Marshal(d.Preview)
	if err != nil {
		return db.AiInsertProposalParams{}, err
	}
	return db.AiInsertProposalParams{
		ID: util.NewID(), OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID, Source: "ask_uni", RunID: runID,
		ConversationID: strText(convID), MessageID: strText(msgID), Position: int32(position),
		ActionType: d.Tool, TargetKind: d.TargetKind, TargetID: strText(d.TargetID), Payload: string(d.Args), Preview: string(preview),
		RiskLevel: d.Level, Mode: mode, Tainted: tainted, TargetRevision: int8Of(d.TargetRevision), Status: proposalPending,
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(askProposalTTL), Valid: true}, CreatedBy: tc.ActorID, CreatedByKind: "human",
	}, nil
}

func int8Of(v *int64) pgtype.Int8 {
	if v == nil {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: *v, Valid: true}
}

// MessageProposals is every row of the answers named, in position order. The
// caller has already shown the answers are the reader's.
func (s *AskUNIService) MessageProposals(ctx context.Context, orgID string, messageIDs []string) (map[string][]AskProposal, error) {
	out := map[string][]AskProposal{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.AiListProposalsForMessages(ctx, db.AiListProposalsForMessagesParams{OrganizationID: orgID, MessageIds: messageIDs})
	if err != nil {
		return nil, err
	}
	now := s.now()
	for _, r := range rows {
		out[r.MessageID.String] = append(out[r.MessageID.String], askProposalOf(r, now))
	}
	return out, nil
}

// ownProposal reads a row only its asker may decide: an id of someone else's
// row reads as one that names nothing, so a row's existence never leaks.
func (s *AskUNIService) ownProposal(ctx context.Context, userID, id string) (db.AgentActionProposal, error) {
	row, err := s.q.AiGetProposal(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.CreatedBy != userID) {
		return db.AgentActionProposal{}, ErrNotFound
	}
	return row, err
}

// proposalMember is the gate every decision passes again (R13): the row is an
// Ask UNI row the decider made, and they are still a member of its workspace,
// in its organization.
func (s *AskUNIService) proposalMember(ctx context.Context, userID string, row db.AgentActionProposal) error {
	if row.CreatedBy != userID || row.Source != "ask_uni" {
		return ErrNotFound
	}
	m, err := s.ws.RequireMember(ctx, row.WorkspaceID, userID)
	if err != nil {
		return err
	}
	if m.OrganizationID != row.OrganizationID {
		return ErrNotFound
	}
	return nil
}

// proposalOf is ownProposal and proposalMember.
func (s *AskUNIService) proposalOf(ctx context.Context, userID, id string) (db.AgentActionProposal, error) {
	row, err := s.ownProposal(ctx, userID, id)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	return row, s.proposalMember(ctx, userID, row)
}

// askGate asks the shared write gate (R10) as tc's asker, with the mode the
// ceiling allows now. spend is true only for a row about to run, which is
// what the budget counts.
func (s *AskUNIService) askGate(ctx context.Context, tc ai.ToolContext, spend bool) error {
	g := s.askWriteGate(ctx, tc)
	if !spend {
		g.Budget = nil
	}
	switch why := g.Refusal(ctx); why {
	case "":
		return nil
	case g.BudgetCode:
		return CodedError{Code: why, Status: http.StatusTooManyRequests}
	default:
		return CodedError{Code: why, Status: http.StatusForbidden}
	}
}

// codeOf is the code of a CodedError in err's chain, "" for none.
func codeOf(err error) string {
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func proposalContext(row db.AgentActionProposal) ai.ToolContext {
	return ai.ToolContext{ActorID: row.CreatedBy, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID}
}

func (s *AskUNIService) askWriteToolNamed(name string) (askWriteTool, error) {
	for _, t := range s.askWriteTools() {
		if t.Name == name {
			return t, nil
		}
	}
	return askWriteTool{}, fmt.Errorf("ask uni: no write tool %q", name)
}

func (s *AskUNIService) observeAction(tool, outcome string) {
	if s.agentMetrics != nil {
		s.agentMetrics.ObserveAskAction(tool, outcome)
	}
}

// draftOfRow is a stored row as the draft prepare made, its payload as stored.
func draftOfRow(r db.AgentActionProposal) askDraftRow {
	d := askDraftRow{Tool: r.ActionType, Args: json.RawMessage(r.Payload), TargetKind: r.TargetKind, TargetID: r.TargetID.String, Level: r.RiskLevel}
	if r.TargetRevision.Valid {
		rev := r.TargetRevision.Int64
		d.TargetRevision = &rev
	}
	_ = json.Unmarshal([]byte(r.Preview), &d.Preview)
	return d
}

func (s *AskUNIService) answerRows(ctx context.Context, q *db.Queries, row db.AgentActionProposal) ([]db.AgentActionProposal, error) {
	if !row.MessageID.Valid {
		return nil, nil
	}
	return q.AiListProposalsForMessages(ctx, db.AiListProposalsForMessagesParams{OrganizationID: row.OrganizationID, MessageIds: []string{row.MessageID.String}})
}

// askRowRefsOf is, for each id field the tool declares in askIDFields, the
// row N a {{row:N.id}} there names. Any other field is text, even a title that
// reads {{row:9.id}}.
func askRowRefsOf(tool string, payload string) map[string]int {
	args := map[string]json.RawMessage{}
	_ = json.Unmarshal([]byte(payload), &args)
	out := map[string]int{}
	for field := range askIDFields[tool].Refs {
		var v string
		if json.Unmarshal(args[field], &v) != nil {
			continue
		}
		if n, ok := askRowRef(v); ok {
			out[field] = n
		}
	}
	return out
}

// askMadeID is the id of what row n of an answer made, "" until it is applied.
func askMadeID(answer []db.AgentActionProposal, n int) string {
	i := slices.IndexFunc(answer, func(r db.AgentActionProposal) bool { return int(r.Position) == n && r.Status == proposalApplied })
	if i < 0 {
		return ""
	}
	var made AskProposalResult
	_ = json.Unmarshal([]byte(answer[i].Result), &made)
	return made.ObjectID
}

// askRunDraft is the draft apply runs for row: each {{row:N.id}} in a declared
// id field becomes the id row N of the same answer made, and the workspace is
// the row's whatever the payload says. A row whose row N is not applied waits
// (proposal_ref_pending). The stored payload keeps its references; a target
// that was one is known from here on (TargetID). Such a row stored no
// revision, and its apply reads the object as it is.
func (s *AskUNIService) askRunDraft(ctx context.Context, row db.AgentActionProposal) (askDraftRow, error) {
	d := draftOfRow(row)
	args := map[string]json.RawMessage{}
	if err := json.Unmarshal(d.Args, &args); err != nil {
		return askDraftRow{}, err
	}
	if refs := askRowRefsOf(row.ActionType, row.Payload); len(refs) > 0 {
		answer, err := s.answerRows(ctx, s.q, row)
		if err != nil {
			return askDraftRow{}, err
		}
		for field, n := range refs {
			id := askMadeID(answer, n)
			if id == "" {
				return askDraftRow{}, errProposalRefPending
			}
			args[field], _ = json.Marshal(id)
			if field == askIDFields[row.ActionType].Target {
				d.TargetID = id
			}
		}
	}
	args["workspace_id"], _ = json.Marshal(row.WorkspaceID)
	b, err := json.Marshal(args)
	if err != nil {
		return askDraftRow{}, err
	}
	d.Args = b
	return d, nil
}

// askFailureCode is what a failed row stores: the command's own refusal, as
// the MCP connector names it, or apply_failed for anything else.
func askFailureCode(err error) string {
	err = mcpMapError(err)
	var invalid McpInvalidArgs
	var refusal McpToolError
	switch {
	case errors.Is(err, ErrNotFound):
		return "not_found"
	case errors.As(err, &invalid):
		return "invalid_args"
	case errors.As(err, &refusal):
		return refusal.Code
	}
	return askApplyFailed
}

// proposalEntry is the audit row of a decision on row. It names what the row
// made or changed the way the repo audits it: a comment under its task or page
// with comment_id in the metadata; a sent chat message, which has no business
// audit row, so this one is its trace (R4); else the object. A row that made
// nothing names itself.
func proposalEntry(row db.AgentActionProposal, action, actorID string) audit.Entry {
	var res AskProposalResult
	_ = json.Unmarshal([]byte(row.Result), &res)
	meta := map[string]any{
		"proposal_id": row.ID, "tool": row.ActionType, "level": row.RiskLevel, "mode": row.Mode,
		"decision": row.Decision.String, "tainted": row.Tainted, "message_id": row.MessageID.String,
	}
	kind, id := "ai_proposal", row.ID
	switch {
	case res.ObjectID == "":
	case row.ActionType == "add_comment" || row.ActionType == "add_document_comment":
		meta["comment_id"] = res.ObjectID
		if row.TargetID.Valid {
			kind, id = row.TargetKind, row.TargetID.String
		}
	case row.ActionType == "send_chat_message":
		kind, id = "chat_message", res.ObjectID
	default:
		kind, id = row.TargetKind, res.ObjectID
	}
	return audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: audit.User(actorID), Action: action,
		ResourceType: kind, ResourceID: id, Metadata: meta,
	}
}

// ApplyProposal applies one row as its asker pressed Áp dụng (decision
// confirmed, or answer for the row "Tạo tài liệu" made). A refusal leaves the
// row as it was. A command that fails settles the row failed and returns its
// code as the error, with the row.
func (s *AskUNIService) ApplyProposal(ctx context.Context, userID, proposalID string) (AskProposal, error) {
	row, err := s.ownProposal(ctx, userID, proposalID)
	if err != nil {
		return AskProposal{}, err
	}
	decision := "confirmed"
	if row.Position == askAnswerPosition {
		decision = "answer"
	}
	return s.applyRow(ctx, userID, row, decision)
}

// applyRow claims, runs and settles one row: the manual apply, a plan's rows,
// Auto mode's level-1 rows and "Tạo tài liệu" all come here. Every check runs
// again here, whoever calls: the asker and their membership, the row still
// pending and not expired, the rows it names applied, then the shared gate,
// which spends the budget. The claim is pinned to row as read: if the row was
// edited since, nothing runs (proposal_not_pending).
func (s *AskUNIService) applyRow(ctx context.Context, userID string, row db.AgentActionProposal, decision string) (AskProposal, error) {
	if err := s.proposalMember(ctx, userID, row); err != nil {
		return AskProposal{}, err
	}
	// Defense in depth for Auto mode (R11): the stored row must say it may run
	// unasked, whatever the caller decided.
	if decision == AskModeAuto && (row.RiskLevel != askLevel1 || row.Tainted || row.Mode != AskModeAuto) {
		return AskProposal{}, errProposalNotAuto
	}
	if row.Status != proposalPending {
		return AskProposal{}, errProposalNotPending
	}
	if askExpired(row, s.now()) {
		return AskProposal{}, errProposalExpired
	}
	tool, err := s.askWriteToolNamed(row.ActionType)
	if err != nil {
		return AskProposal{}, err
	}
	draft, err := s.askRunDraft(ctx, row)
	if err != nil {
		return AskProposal{}, err
	}
	if err := s.askGate(ctx, proposalContext(row), true); err != nil {
		return AskProposal{}, err
	}
	if _, err := s.q.AiClaimProposal(ctx, db.AiClaimProposalParams{
		ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalPending, ToStatus: proposalApplying, SeenUpdatedAt: row.UpdatedAt,
	}); errors.Is(err, pgx.ErrNoRows) {
		return AskProposal{}, errProposalNotPending
	} else if err != nil {
		return AskProposal{}, err
	}
	return s.runClaimed(ctx, userID, row, decision, draft, tool.apply, askApplyTimeout)
}

// errAskPanicked is a claimed row whose command panicked. The row is left as
// it is (it reads unknown): whether the command wrote is not known.
var errAskPanicked = errors.New("ask uni: a proposal's command panicked")

// askRecover runs a claimed row's command; a panic is logged with the row's id
// and becomes errAskPanicked, so a run off the request (Auto mode) cannot take
// the process down.
func askRecover(ctx context.Context, proposalID string, run func() error) (err error) {
	defer func() {
		if v := recover(); v != nil {
			slog.ErrorContext(ctx, "ask uni: a proposal's command panicked", "proposal_id", proposalID, "panic", fmt.Sprint(v))
			err = errAskPanicked
		}
	}()
	return run()
}

// askCommand is a claimed row's command: its tool's apply.
type askCommand func(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error)

// runClaimed runs a claimed row's command, within timeout and as the asker
// under the proposal's via, then settles the row. Both outlive the request,
// so a client that leaves does not strand the row; the settle has a deadline
// of its own, so a command that ran out of time still leaves the row failed.
func (s *AskUNIService) runClaimed(ctx context.Context, userID string, row db.AgentActionProposal, decision string, draft askDraftRow, run askCommand, timeout time.Duration) (AskProposal, error) {
	via := audit.WithVia(context.WithoutCancel(ctx), audit.Via{Kind: "ask_uni", ProposalID: row.ID})
	runCtx, cancel := context.WithTimeout(via, timeout)
	defer cancel()
	var res AskProposalResult
	var inv *askInverse
	runErr := askRecover(runCtx, row.ID, func() (err error) {
		res, inv, err = run(runCtx, McpPrincipal{UserID: userID, OrganizationID: row.OrganizationID}, draft)
		return err
	})
	if errors.Is(runErr, errAskPanicked) {
		return AskProposal{}, runErr
	}
	ctx, done := outliving(via)
	defer done()
	if runErr != nil {
		// apply wrote nothing (its contract): the row fails with the reason.
		code := askFailureCode(runErr)
		failed, err := s.q.AiSettleProposalApply(ctx, db.AiSettleProposalApplyParams{
			ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalApplying, Status: proposalFailed,
			Result: row.Result, Error: strText(code), Decision: strText(decision), DecidedBy: strText(userID), TargetID: strText(draft.TargetID),
		})
		if err != nil {
			return AskProposal{}, err
		}
		s.observeAction(row.ActionType, "failed")
		if code == askApplyFailed {
			return askProposalOf(failed, s.now()), runErr
		}
		return askProposalOf(failed, s.now()), CodedError{Code: code, Status: http.StatusConflict}
	}
	applied, err := s.settleApplied(ctx, userID, row, decision, draft.TargetID, res, inv)
	if err != nil {
		// The command is written; the row stays applying and reads unknown.
		slog.ErrorContext(ctx, "ask uni: settling an applied proposal failed", "proposal_id", row.ID, "error", err)
		return AskProposal{}, err
	}
	outcome := "applied"
	if decision == AskModeAuto {
		outcome = "auto_applied"
	}
	s.observeAction(row.ActionType, outcome)
	return askProposalOf(applied, s.now()), nil
}

// settleApplied marks the claimed row applied with what its command returned
// and writes ai_proposal.applied in the same transaction.
func (s *AskUNIService) settleApplied(ctx context.Context, userID string, row db.AgentActionProposal, decision, targetID string, res AskProposalResult, inv *askInverse) (db.AgentActionProposal, error) {
	result, err := json.Marshal(res)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	undo := pgtype.Text{}
	if inv != nil {
		b, err := json.Marshal(inv)
		if err != nil {
			return db.AgentActionProposal{}, err
		}
		undo = pgtype.Text{String: string(b), Valid: true}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	applied, err := q.AiSettleProposalApply(ctx, db.AiSettleProposalApplyParams{
		ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalApplying, Status: proposalApplied,
		Result: string(result), Undo: undo, Decision: strText(decision), DecidedBy: strText(userID), TargetID: strText(targetID),
	})
	if err != nil {
		return db.AgentActionProposal{}, err
	}
	if err := auditRecorder.Record(ctx, q, proposalEntry(applied, audit.ActionAIProposalApplied, userID)); err != nil {
		return db.AgentActionProposal{}, err
	}
	return applied, tx.Commit(ctx)
}

// ApplyMessageProposals applies the chosen rows of one answer in position
// order and stops at the first that fails or is refused; the chosen rows after
// it stay pending. When the answer was made in plan mode (the rows' stored
// mode) its approval is a plan: decision plan, and every pending row not
// chosen is rejected in the same call; otherwise it is "Áp dụng tất cả"
// (decision confirmed). It returns the answer's rows as they stand after the
// call and why the run stopped, nil when every chosen row applied.
func (s *AskUNIService) ApplyMessageProposals(ctx context.Context, userID, conversationID, messageID string, ids []string) ([]AskProposal, error) {
	if len(ids) == 0 {
		return nil, Invalid("proposal_ids is empty")
	}
	conv, err := s.ownConversation(ctx, userID, conversationID, "")
	if err != nil {
		return nil, err
	}
	rows, err := s.q.AiListProposalsForMessages(ctx, db.AiListProposalsForMessagesParams{OrganizationID: conv.OrganizationID, MessageIds: []string{messageID}})
	if err != nil {
		return nil, err
	}
	rows = slices.DeleteFunc(rows, func(r db.AgentActionProposal) bool {
		return r.ConversationID.String != conv.ID || r.CreatedBy != userID || r.Position == askAnswerPosition
	})
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	chosen := map[string]bool{}
	for _, id := range ids {
		if !slices.ContainsFunc(rows, func(r db.AgentActionProposal) bool { return r.ID == id }) {
			return nil, ErrNotFound
		}
		chosen[id] = true
	}
	if err := s.proposalMember(ctx, userID, rows[0]); err != nil {
		return nil, err
	}
	if err := s.askGate(ctx, proposalContext(rows[0]), false); err != nil {
		return nil, err
	}
	// A chosen row that names another needs it chosen too or applied already,
	// or the run would stop half way: refuse before anything runs or is
	// rejected.
	for _, r := range rows {
		if !chosen[r.ID] {
			continue
		}
		for _, n := range askRowRefsOf(r.ActionType, r.Payload) {
			i := slices.IndexFunc(rows, func(o db.AgentActionProposal) bool { return int(o.Position) == n })
			if i < 0 || !(chosen[rows[i].ID] || rows[i].Status == proposalApplied) {
				return nil, errProposalRefPending
			}
		}
	}
	plan := rows[0].Mode == AskModePlan
	decision := "confirmed"
	if plan {
		decision = AskModePlan
	}
	var stopped error
	for _, r := range rows {
		if !chosen[r.ID] {
			continue
		}
		if _, stopped = s.applyRow(ctx, userID, r, decision); stopped != nil {
			break
		}
	}
	if plan {
		for _, r := range rows {
			if chosen[r.ID] || r.Status != proposalPending {
				continue
			}
			if _, err := s.rejectRow(ctx, userID, r, decision); err != nil && codeOf(err) != errProposalNotPending.Code {
				return nil, err
			}
		}
	}
	m, err := s.MessageProposals(ctx, conv.OrganizationID, []string{messageID})
	if err != nil {
		return nil, err
	}
	return m[messageID], stopped
}

// RejectProposal is Bỏ qua: pending → rejected, audited.
func (s *AskUNIService) RejectProposal(ctx context.Context, userID, proposalID string) (AskProposal, error) {
	row, err := s.proposalOf(ctx, userID, proposalID)
	if err != nil {
		return AskProposal{}, err
	}
	if err := s.askGate(ctx, proposalContext(row), false); err != nil {
		return AskProposal{}, err
	}
	return s.rejectRow(ctx, userID, row, "")
}

// rejectRow settles a pending row rejected and writes ai_proposal.rejected in
// the same transaction; decision is "" for Bỏ qua and plan for a row a plan
// left out.
func (s *AskUNIService) rejectRow(ctx context.Context, userID string, row db.AgentActionProposal, decision string) (AskProposal, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AskProposal{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	rejected, err := q.AiSettleProposalApply(ctx, db.AiSettleProposalApplyParams{
		ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalPending, Status: proposalRejected,
		Result: row.Result, Decision: strText(decision), DecidedBy: strText(userID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return AskProposal{}, errProposalNotPending
	}
	if err != nil {
		return AskProposal{}, err
	}
	if err := auditRecorder.Record(ctx, q, proposalEntry(rejected, audit.ActionAIProposalRejected, userID)); err != nil {
		return AskProposal{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AskProposal{}, err
	}
	s.observeAction(row.ActionType, proposalRejected)
	return askProposalOf(rejected, s.now()), nil
}
