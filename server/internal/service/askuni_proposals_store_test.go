package service

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestProposalRowRoundTrips(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	msgID := util.NewID()

	row, err := s.q.AiInsertProposal(ctx, db.AiInsertProposalParams{
		ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Source: "ask_uni", RunID: util.NewID(),
		MessageID: pgtype.Text{String: msgID, Valid: true}, Position: 1,
		ActionType: "task.create", TargetKind: "task", Payload: "{}", Preview: "{}",
		RiskLevel: "l1", Mode: "ask", Status: "pending",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedBy: ua.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	claim := db.AiClaimProposalParams{ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: "pending", ToStatus: "applying"}
	got, err := s.q.AiClaimProposal(ctx, claim)
	if err != nil || got.Status != "applying" {
		t.Fatalf("first claim: %+v, %v", got, err)
	}
	if _, err := s.q.AiClaimProposal(ctx, claim); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("second claim: err = %v, want pgx.ErrNoRows", err)
	}
	list, err := s.q.AiListProposalsForMessages(ctx, db.AiListProposalsForMessagesParams{
		OrganizationID: w.OrganizationID, MessageIds: []string{msgID},
	})
	if err != nil || len(list) != 1 || list[0].Position != 1 || list[0].ID != row.ID {
		t.Fatalf("list: %+v, %v", list, err)
	}
}

func TestAuditResourcesOnlyBy(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	ctx := context.Background()
	mk := func(title string) string {
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: title, Priority: "medium"})
		if err != nil {
			t.Fatal(err)
		}
		return task.ID
	}
	edit := func(id, by, title string) {
		if _, err := s.Update(ctx, Human(by), id, UpdateTaskInput{Title: &title}); err != nil {
			t.Fatal(err)
		}
	}
	mine, shared := mk("mine"), mk("shared")
	edit(mine, ua.ID, "mine v2")
	edit(shared, ub.ID, "shared v2")
	unknown := util.NewID() // no task.created row at all

	got, err := s.q.AuditResourcesOnlyBy(ctx, db.AuditResourcesOnlyByParams{
		OrganizationID: w.OrganizationID, ResourceType: "task", CreatedAction: "task.created",
		ActorID: ua.ID, ResourceIds: []string{mine, shared, unknown},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, []string{mine}) {
		t.Fatalf("got %v, want only %s", got, mine)
	}
}

func newPendingProposal(t *testing.T, s *TaskService, orgID, wsID, userID string) db.AgentActionProposal {
	t.Helper()
	row, err := s.q.AiInsertProposal(context.Background(), db.AiInsertProposalParams{
		ID: util.NewID(), OrganizationID: orgID, WorkspaceID: wsID,
		Source: "ask_uni", RunID: util.NewID(),
		MessageID: pgtype.Text{String: util.NewID(), Valid: true}, Position: 1,
		ActionType: "task.create", TargetKind: "task", Payload: "{}", Preview: "{}",
		RiskLevel: "l1", Mode: "ask", Status: "pending",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedBy: userID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func TestProposalSettleKeepsDecisionAndGuardsState(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	txt := func(v string) pgtype.Text { return pgtype.Text{String: v, Valid: true} }
	row := newPendingProposal(t, s, w.OrganizationID, w.ID, ua.ID)
	step := func(from, to string) {
		t.Helper()
		if _, err := s.q.AiClaimProposal(ctx, db.AiClaimProposalParams{ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: from, ToStatus: to}); err != nil {
			t.Fatalf("claim %s->%s: %v", from, to, err)
		}
	}

	// A draft edit is refused once the row is no longer pending.
	step("pending", "applying")
	if _, err := s.q.AiUpdateProposalDraft(ctx, db.AiUpdateProposalDraftParams{
		ID: row.ID, OrganizationID: w.OrganizationID, Payload: "x", Preview: "x", RiskLevel: "l2",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("draft on non-pending: err = %v, want pgx.ErrNoRows", err)
	}

	// Wrong from_status changes nothing.
	if _, err := s.q.AiSettleProposalApply(ctx, db.AiSettleProposalApplyParams{
		ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: "pending", Status: "applied",
		Result: `{"a":1}`, DecidedBy: txt(ub.ID),
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("wrong from_status: err = %v, want pgx.ErrNoRows", err)
	}

	applied, err := s.q.AiSettleProposalApply(ctx, db.AiSettleProposalApplyParams{
		ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: "applying", Status: "applied",
		Result: `{"id":"t1"}`, Undo: txt(`{"op":"delete"}`), Decision: txt("confirmed"), DecidedBy: txt(ua.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if applied.DecidedBy.String != ua.ID || !applied.AppliedAt.Valid || !applied.DecidedAt.Valid || applied.Decision.String != "confirmed" {
		t.Fatalf("apply settle: %+v", applied)
	}

	// Undo rollback (undoing -> applied) keeps applied_at, result and undo.
	step("applied", "undoing")
	back, err := s.q.AiSettleProposalUndo(ctx, db.AiSettleProposalUndoParams{
		ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: "undoing", Status: "applied", Error: txt("undo_unavailable"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if back.Status != "applied" || !back.AppliedAt.Time.Equal(applied.AppliedAt.Time) ||
		back.Undo.String != applied.Undo.String || back.Result != applied.Result || back.UndoneAt.Valid {
		t.Fatalf("rollback changed the row: %+v", back)
	}

	// Undo settle (undoing -> undone) keeps the deciding person and sets undone_by.
	step("applied", "undoing")
	undone, err := s.q.AiSettleProposalUndo(ctx, db.AiSettleProposalUndoParams{
		ID: row.ID, OrganizationID: w.OrganizationID, FromStatus: "undoing", Status: "undone", UndoneBy: txt(ub.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	if undone.DecidedBy.String != ua.ID || undone.UndoneBy.String != ub.ID || !undone.UndoneAt.Valid ||
		!undone.AppliedAt.Time.Equal(applied.AppliedAt.Time) || undone.Result != applied.Result || undone.Undo.String != applied.Undo.String {
		t.Fatalf("undo settle: %+v", undone)
	}
}
