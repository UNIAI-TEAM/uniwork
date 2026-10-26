package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func seedMemories(t *testing.T, f *orgMembersFixture, orgID, userID string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if _, err := f.q.AiInsertMemory(f.ctx, db.AiInsertMemoryParams{
			ID: util.NewID(), OrganizationID: orgID, UserID: userID,
			Kind: "fact", Body: "m" + util.NewID(), Source: "manual",
			CreatedBy: userID, CreatedByKind: "human",
		}); err != nil {
			t.Fatal(err)
		}
	}
}

func countMemories(t *testing.T, f *orgMembersFixture, orgID, userID string) int64 {
	t.Helper()
	n, err := f.q.AiCountMemories(f.ctx, db.AiCountMemoriesParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLeaveDeletesMemoryInThatOrganizationOnly(t *testing.T) {
	f := newOrgMembersFixture(t)
	owner2 := registerVerified(t, f.q, f.auth, "owner2@example.com", "Owner2")
	orgB, err := f.orgs.Create(f.ctx, owner2.ID, "Other Org", "other-org")
	if err != nil {
		t.Fatal(err)
	}
	// A second active membership is inserted directly: no API creates one (ADR 0032).
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: orgB.ID, UserID: f.member.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	seedMemories(t, f, f.org.ID, f.member.ID, 2)
	seedMemories(t, f, orgB.ID, f.member.ID, 1)

	if err := f.svc.Leave(f.ctx, f.member.ID, f.org.ID); err != nil {
		t.Fatal(err)
	}
	if a, b := countMemories(t, f, f.org.ID, f.member.ID), countMemories(t, f, orgB.ID, f.member.ID); a != 0 || b != 1 {
		t.Fatalf("after leave: org A = %d, org B = %d, want 0 and 1", a, b)
	}
	rows, err := f.q.ListAuditEvents(f.ctx, db.ListAuditEventsParams{OrganizationID: f.org.ID, LimitN: 200})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.Action != "member.left" {
			continue
		}
		var meta map[string]any
		if err := json.Unmarshal([]byte(r.Metadata), &meta); err != nil {
			t.Fatal(err)
		}
		if meta["ask_uni_memories_deleted"] != float64(2) {
			t.Fatalf("member.left metadata = %v", meta)
		}
		return
	}
	t.Fatal("no member.left audit row")
}

func TestDeactivateKeepsMemory(t *testing.T) {
	f := newOrgMembersFixture(t)
	seedMemories(t, f, f.org.ID, f.member.ID, 2)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if n := countMemories(t, f, f.org.ID, f.member.ID); n != 2 {
		t.Fatalf("after deactivate: %d entries, want 2", n)
	}
	if _, err := f.svc.Reactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	m := NewAiMemoryService(f.pool, f.q, f.orgs, f.ws)
	m.SetFlags(memoryFlagFake{on: true})
	l, err := m.List(f.ctx, f.member.ID, f.org.ID)
	if err != nil || len(l.Entries) != 2 {
		t.Fatalf("list after reactivate = %+v, %v", l, err)
	}
}

func TestDeleteAccountDeletesMemoryEverywhere(t *testing.T) {
	f := newOrgMembersFixture(t)
	owner2 := registerVerified(t, f.q, f.auth, "owner3@example.com", "Owner3")
	orgB, err := f.orgs.Create(f.ctx, owner2.ID, "Other Org", "other-org")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: orgB.ID, UserID: f.member.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	seedMemories(t, f, f.org.ID, f.member.ID, 2)
	seedMemories(t, f, orgB.ID, f.member.ID, 1)
	seedMemories(t, f, f.org.ID, f.admin.ID, 1)
	prop, err := f.q.AiInsertMemoryProposal(f.ctx, db.AiInsertMemoryProposalParams{
		ID: util.NewID(), OrganizationID: f.org.ID, WorkspaceID: util.NewID(),
		ConversationID: util.NewID(), MessageID: util.NewID(), Action: "remember",
		Kind: pgtype.Text{String: "fact", Valid: true}, Body: pgtype.Text{String: "x", Valid: true},
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedBy: f.member.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := f.auth.DeleteAccount(f.ctx, f.member.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}
	if a, b := countMemories(t, f, f.org.ID, f.member.ID), countMemories(t, f, orgB.ID, f.member.ID); a != 0 || b != 0 {
		t.Fatalf("after delete: %d and %d entries, want 0", a, b)
	}
	if n := countMemories(t, f, f.org.ID, f.admin.ID); n != 1 {
		t.Fatalf("another person's memory = %d, want 1", n)
	}
	if _, err := f.q.AiGetMemoryProposal(f.ctx, prop.ID); err != nil {
		t.Fatalf("proposal must survive account deletion: %v", err)
	}
}
