package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Sửa and Hoàn tác on an Ask UNI proposal (R13, R14).

// EditProposal is Sửa: changes are merged into the row's arguments and the
// tool's prepare runs on them again, with the answer's earlier rows, as for a
// new call; its draft replaces the payload, preview, level, target and the
// revision it read. A refused edit changes nothing. No audit: the row is AI
// bookkeeping until it is applied (R13).
func (s *AskUNIService) EditProposal(ctx context.Context, userID, proposalID string, changes map[string]json.RawMessage) (AskProposal, error) {
	row, err := s.proposalOf(ctx, userID, proposalID)
	if err != nil {
		return AskProposal{}, err
	}
	if err := s.askGate(ctx, proposalContext(row), false); err != nil {
		return AskProposal{}, err
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
	args := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(row.Payload), &args); err != nil {
		return AskProposal{}, err
	}
	for k, v := range changes {
		args[k] = v
	}
	delete(args, "workspace_id") // prepare binds the row's own
	merged, err := json.Marshal(args)
	if err != nil {
		return AskProposal{}, err
	}
	earlier, err := s.earlierDrafts(ctx, row)
	if err != nil {
		return AskProposal{}, err
	}
	d, err := tool.prepare(ctx, proposalContext(row), merged, earlier)
	if err != nil {
		return AskProposal{}, err
	}
	preview, err := json.Marshal(d.Preview)
	if err != nil {
		return AskProposal{}, err
	}
	updated, err := s.q.AiUpdateProposalDraft(ctx, db.AiUpdateProposalDraftParams{
		ID: row.ID, OrganizationID: row.OrganizationID, Payload: string(d.Args), Preview: string(preview),
		RiskLevel: d.Level, TargetID: strText(d.TargetID), TargetRevision: int8Of(d.TargetRevision),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return AskProposal{}, errProposalNotPending
	}
	if err != nil {
		return AskProposal{}, err
	}
	return askProposalOf(updated, s.now()), nil
}

// earlierDrafts is the answer's rows before row, as prepare made them, for an
// edit's {{row:N.id}}.
func (s *AskUNIService) earlierDrafts(ctx context.Context, row db.AgentActionProposal) ([]askDraftRow, error) {
	if row.Position <= 1 {
		return nil, nil
	}
	answer, err := s.answerRows(ctx, s.q, row)
	if err != nil {
		return nil, err
	}
	out := make([]askDraftRow, row.Position-1)
	for _, r := range answer {
		if r.Position >= 1 && r.Position < row.Position {
			out[r.Position-1] = draftOfRow(r)
		}
	}
	return out, nil
}

// UndoProposal is Hoàn tác (R14): applied → undoing, the stored inverse runs
// as the asker under the proposal's via, then undone with ai_proposal.undone
// in one transaction. An inverse whose guard finds the object changed puts
// the row back to applied and answers undo_unavailable.
func (s *AskUNIService) UndoProposal(ctx context.Context, userID, proposalID string) (AskProposal, error) {
	row, err := s.proposalOf(ctx, userID, proposalID)
	if err != nil {
		return AskProposal{}, err
	}
	if err := s.askGate(ctx, proposalContext(row), false); err != nil {
		return AskProposal{}, err
	}
	if row.Status != proposalApplied {
		return AskProposal{}, errProposalNotPending
	}
	var inv askInverse
	if !row.Undo.Valid || json.Unmarshal([]byte(row.Undo.String), &inv) != nil || askInverses[inv.Op] == nil {
		return AskProposal{}, errAskUndoUnavailable
	}
	if _, err := s.q.AiClaimProposal(ctx, db.AiClaimProposalParams{ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalApplied, ToStatus: proposalUndoing}); errors.Is(err, pgx.ErrNoRows) {
		return AskProposal{}, errProposalNotPending
	} else if err != nil {
		return AskProposal{}, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), askApplyTimeout)
	defer cancel()
	ctx = audit.WithVia(ctx, audit.Via{Kind: "ask_uni", ProposalID: row.ID})
	if runErr := askInverses[inv.Op](ctx, s, McpPrincipal{UserID: userID, OrganizationID: row.OrganizationID}, inv.Args); runErr != nil {
		// The row goes back to applied; a guard's refusal is kept as its error.
		guarded := codeOf(runErr) == errAskUndoUnavailable.Code
		why := pgtype.Text{}
		if guarded {
			why = strText(errAskUndoUnavailable.Code)
		}
		back, err := s.q.AiSettleProposalUndo(ctx, db.AiSettleProposalUndoParams{
			ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalUndoing, Status: proposalApplied, Error: why,
		})
		if err != nil {
			return AskProposal{}, err
		}
		if guarded {
			return askProposalOf(back, s.now()), errAskUndoUnavailable
		}
		return askProposalOf(back, s.now()), runErr
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AskProposal{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	undone, err := q.AiSettleProposalUndo(ctx, db.AiSettleProposalUndoParams{
		ID: row.ID, OrganizationID: row.OrganizationID, FromStatus: proposalUndoing, Status: proposalUndone, UndoneBy: strText(userID),
	})
	if err != nil {
		return AskProposal{}, err
	}
	if err := auditRecorder.Record(ctx, q, proposalEntry(undone, audit.ActionAIProposalUndone, userID)); err != nil {
		return AskProposal{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AskProposal{}, err
	}
	s.observeAction(row.ActionType, proposalUndone)
	return askProposalOf(undone, s.now()), nil
}
