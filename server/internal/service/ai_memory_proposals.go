package service

import (
	"context"
	"errors"
	"net/http"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Apply, reject, edit and undo of a memory proposal (P4 R13). Only the asker
// decides; each decision is one transaction that locks the row, checks its
// state, changes the memory and settles the row. None of P3's executor, write
// gate or ask_uni_actions flag is involved, and nothing here runs unasked.

const aiMemorySourceChat = "chat"

var (
	errAiMemoryOff      = CodedError{Code: "ai_memory_off", Status: http.StatusConflict}
	errAiMemoryNotFound = CodedError{Code: "ai_memory_not_found", Status: http.StatusNotFound}
	errAiMemoryChanged  = CodedError{Code: "ai_memory_changed", Status: http.StatusConflict}
)

// ownMemoryProposal reads a row only its asker may decide. Someone else's row
// reads as an id that names nothing, before any membership, flag or state
// check, so a row's existence never leaks (R13). The asker must still be a
// member of the row's workspace, and the flag on in its organization.
func (s *AiMemoryService) ownMemoryProposal(ctx context.Context, userID, id string) (db.AiMemoryProposal, error) {
	row, err := s.q.AiGetMemoryProposal(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.CreatedBy != userID) {
		return db.AiMemoryProposal{}, ErrNotFound
	}
	if err != nil {
		return db.AiMemoryProposal{}, err
	}
	m, err := s.ws.RequireMember(ctx, row.WorkspaceID, userID)
	if err != nil {
		return db.AiMemoryProposal{}, err
	}
	if m.OrganizationID != row.OrganizationID {
		return db.AiMemoryProposal{}, ErrNotFound
	}
	if !s.flagOn(ctx, userID, row.OrganizationID) {
		return db.AiMemoryProposal{}, errAiMemoryDisabled
	}
	return row, nil
}

// decide runs fn on the asker's row, locked, in one transaction. A refusal
// past the gate comes back with the row as it stands, so a card repaints
// from the answer; outcome is counted once the decision commits.
func (s *AiMemoryService) decide(ctx context.Context, userID, id, outcome string, fn func(q *db.Queries, row db.AiMemoryProposal) (db.AiMemoryProposal, error)) (AskMemoryProposal, error) {
	row, err := s.ownMemoryProposal(ctx, userID, id)
	if err != nil {
		return AskMemoryProposal{}, err
	}
	err = s.inTx(ctx, func(q *db.Queries) error {
		locked, err := q.AiLockMemoryProposal(ctx, db.AiLockMemoryProposalParams{ID: row.ID, OrganizationID: row.OrganizationID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound // its conversation was deleted since the read
		}
		if err != nil {
			return err
		}
		row = locked
		changed, err := fn(q, locked)
		if err != nil {
			return err
		}
		row = changed
		return nil
	})
	var ce CodedError
	switch {
	case err == nil:
		s.observe(outcome)
	case errors.As(err, &ce):
		if ce.Code == errProposalExpired.Code {
			s.observe("expired")
		}
	default:
		return AskMemoryProposal{}, err
	}
	return askMemoryProposalOf(row, s.now()), err
}

// observe counts outcome (R19); an edit counts nothing.
func (s *AiMemoryService) observe(outcome string) {
	if s.metrics != nil && outcome != "" {
		s.metrics.ObserveAskMemory(outcome)
	}
}

// pendingNow refuses a row that is no longer pending or is past its expiry.
func (s *AiMemoryService) pendingNow(row db.AiMemoryProposal) error {
	switch askMemoryProposalOf(row, s.now()).Status {
	case proposalPending:
		return nil
	case "expired":
		return errProposalExpired
	}
	return errProposalNotPending
}

func (s *AiMemoryService) settle(ctx context.Context, q *db.Queries, row db.AiMemoryProposal, status, memoryID string) (db.AiMemoryProposal, error) {
	return q.AiSetMemoryProposalStatus(ctx, db.AiSetMemoryProposalStatusParams{
		ID: row.ID, OrganizationID: row.OrganizationID, Status: status, MemoryID: strText(memoryID),
	})
}

// viaProposal marks the ai_memory.* audit rows a decision writes as Ask UNI's,
// with the memory proposal's id (R14).
func viaProposal(ctx context.Context, row db.AiMemoryProposal) context.Context {
	return audit.WithVia(ctx, audit.Via{Kind: "ask_uni", ProposalID: row.ID})
}

// ApplyProposal is Nhớ / Lưu / Quên: the entry is created, changed or deleted
// as the row says, and the row settles applied. The asker's own switch must
// be on; an entry an update or forget names that is gone is
// ai_memory_not_found, and one that no longer reads as the card showed it is
// ai_memory_changed.
func (s *AiMemoryService) ApplyProposal(ctx context.Context, userID, id string) (AskMemoryProposal, error) {
	return s.decide(ctx, userID, id, proposalApplied, func(q *db.Queries, row db.AiMemoryProposal) (db.AiMemoryProposal, error) {
		if err := s.pendingNow(row); err != nil {
			return row, err
		}
		off, err := q.GetUserAskUniMemoryOff(ctx, userID)
		if err != nil {
			return row, err
		}
		if off {
			return row, errAiMemoryOff
		}
		vctx, org := viaProposal(ctx, row), row.OrganizationID
		var made string
		switch row.Action {
		case "remember":
			var m db.AiMemory
			m, err = s.createQ(vctx, q, org, userID, row.Kind.String, row.Body.String, aiMemorySourceChat, row.ID)
			made = m.ID
		case "update":
			if err := entryAsProposed(ctx, q, row, userID); err != nil {
				return row, err
			}
			kind, body := row.Kind.String, row.Body.String
			_, err = s.updateQ(vctx, q, org, userID, row.MemoryID.String, &kind, &body)
		case "forget":
			if err := entryAsProposed(ctx, q, row, userID); err != nil {
				return row, err
			}
			err = s.deleteQ(vctx, q, org, userID, row.MemoryID.String)
		default:
			return row, errors.New("ai memory: unknown proposal action " + row.Action)
		}
		if errors.Is(err, ErrNotFound) {
			return row, errAiMemoryNotFound
		}
		if err != nil {
			return row, err
		}
		return s.settle(ctx, q, row, proposalApplied, made)
	})
}

// entryAsProposed refuses an update or forget whose entry is gone
// (ai_memory_not_found) or whose kind or text is no longer the row's before
// (ai_memory_changed): applying it would overwrite or delete an edit the
// person never saw on the card. The owner lock keeps an edit from landing
// between this check and the change.
func entryAsProposed(ctx context.Context, q *db.Queries, row db.AiMemoryProposal, userID string) error {
	if err := q.AiLockMemoryOwner(ctx, db.AiLockMemoryOwnerParams{OrganizationID: row.OrganizationID, UserID: userID}); err != nil {
		return err
	}
	cur, err := q.AiGetMemory(ctx, db.AiGetMemoryParams{ID: row.MemoryID.String, OrganizationID: row.OrganizationID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return errAiMemoryNotFound
	}
	if err != nil {
		return err
	}
	if cur.Kind != row.BeforeKind.String || cur.Body != row.BeforeBody.String {
		return errAiMemoryChanged
	}
	return nil
}

// RejectProposal is Bỏ qua: pending → rejected, audited without the text. A
// row past its expiry may still be rejected, as P3's rejectRow allows.
func (s *AiMemoryService) RejectProposal(ctx context.Context, userID, id string) (AskMemoryProposal, error) {
	return s.decide(ctx, userID, id, proposalRejected, func(q *db.Queries, row db.AiMemoryProposal) (db.AiMemoryProposal, error) {
		if row.Status != proposalPending {
			return row, errProposalNotPending
		}
		rejected, err := s.settle(ctx, q, row, proposalRejected, "")
		if err != nil {
			return row, err
		}
		return rejected, auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: audit.User(userID),
			Action: audit.ActionAIMemoryProposalRejected, ResourceType: "ai_memory_proposal", ResourceID: row.ID,
			Metadata: map[string]any{"action": row.Action, "kind": row.Kind.String, "chars": utf8.RuneCountInString(row.Body.String), "message_id": row.MessageID},
		})
	})
}

// EditProposal is Sửa on a pending remember or update: the kind and/or text
// change, checked as new input; a field left nil stays. No audit: the row is
// AI bookkeeping until it is applied.
func (s *AiMemoryService) EditProposal(ctx context.Context, userID, id string, kind, text *string) (AskMemoryProposal, error) {
	return s.decide(ctx, userID, id, "", func(q *db.Queries, row db.AiMemoryProposal) (db.AiMemoryProposal, error) {
		if err := s.pendingNow(row); err != nil {
			return row, err
		}
		if row.Action == "forget" {
			return row, Invalid("a forget proposal has no text to edit")
		}
		k, body := row.Kind.String, row.Body.String
		if kind != nil {
			if err := validMemoryKind(*kind); err != nil {
				return row, err
			}
			k = *kind
		}
		if text != nil {
			var err error
			if body, err = validMemoryText(*text); err != nil {
				return row, err
			}
			rows, err := q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: row.OrganizationID, UserID: userID})
			if err != nil {
				return row, err
			}
			if aiMemoryTaken(rows, row.MemoryID.String, body) {
				return row, errAiMemoryDuplicate
			}
		}
		return q.AiEditMemoryProposal(ctx, db.AiEditMemoryProposalParams{
			ID: row.ID, OrganizationID: row.OrganizationID, Kind: strText(k), Body: strText(body),
		})
	})
}

// UndoProposal is Hoàn tác, once, on an applied row: remember deletes the
// entry it made, update writes back the entry as it was, forget creates it
// again (a new id, through the cap and duplicate checks). An entry changed
// since the apply (updated_at after decided_at, both the database wall clock)
// or gone is undo_unavailable, and the row stays applied.
func (s *AiMemoryService) UndoProposal(ctx context.Context, userID, id string) (AskMemoryProposal, error) {
	return s.decide(ctx, userID, id, proposalUndone, func(q *db.Queries, row db.AiMemoryProposal) (db.AiMemoryProposal, error) {
		if row.Status != proposalApplied {
			return row, errProposalNotPending
		}
		vctx, org := viaProposal(ctx, row), row.OrganizationID
		if row.Action != "forget" {
			// The owner lock first, so an edit cannot land between the guard
			// and the inverse. A manual Delete or Clear takes no owner lock and
			// still can: the inverse then finds no entry, read below as
			// undo_unavailable too.
			if err := q.AiLockMemoryOwner(ctx, db.AiLockMemoryOwnerParams{OrganizationID: org, UserID: userID}); err != nil {
				return row, err
			}
			cur, err := q.AiGetMemory(ctx, db.AiGetMemoryParams{ID: row.MemoryID.String, OrganizationID: org, UserID: userID})
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && cur.UpdatedAt.Time.After(row.DecidedAt.Time)) {
				return row, errAskUndoUnavailable
			}
			if err != nil {
				return row, err
			}
		}
		var err error
		switch row.Action {
		case "remember":
			err = s.deleteQ(vctx, q, org, userID, row.MemoryID.String)
		case "update":
			kind, body := row.BeforeKind.String, row.BeforeBody.String
			_, err = s.updateQ(vctx, q, org, userID, row.MemoryID.String, &kind, &body)
		case "forget":
			_, err = s.createQ(vctx, q, org, userID, row.BeforeKind.String, row.BeforeBody.String, aiMemorySourceChat, row.ID)
		}
		if row.Action != "forget" && (errors.Is(err, ErrNotFound) || errors.Is(err, pgx.ErrNoRows)) {
			return row, errAskUndoUnavailable
		}
		if err != nil {
			return row, err
		}
		return s.settle(ctx, q, row, proposalUndone, "")
	})
}
