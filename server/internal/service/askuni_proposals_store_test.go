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
