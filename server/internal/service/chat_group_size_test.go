package service

import (
	"context"
	"fmt"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// H18: the group dedupe key was the whole member id list in a unique btree,
// so a group of ~99 people overflowed the index row and failed with a 500.
func TestLargeGroupIsCreatedAndStillDeduplicated(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	members := make([]string, 0, 120)
	for i := range 120 {
		u, err := q.CreateUser(ctx, db.CreateUserParams{
			ID: util.NewID(), Email: fmt.Sprintf("big-group-%d@example.com", i), DisplayName: fmt.Sprintf("U%d", i), Locale: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		addOrgMember(t, q, w.OrganizationID, u.ID)
		members = append(members, u.ID)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "All hands", MemberUserIDs: members})
	if err != nil {
		t.Fatalf("create 121-person group: %v", err)
	}
	again, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "All hands", MemberUserIDs: members})
	if err != nil || again.ID != group.ID {
		t.Fatalf("same members should resolve the same group: err=%v first=%s again=%s", err, group.ID, again.ID)
	}
}

func TestGroupSizeIsCapped(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	tooMany := make([]string, maxChatGroupMembers)
	for i := range tooMany {
		tooMany[i] = util.NewID()
	}
	_, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: tooMany})
	requireValidationError(t, err, "create past the cap")

	addOrgMember(t, q, w.OrganizationID, ub.ID)
	uc, err := q.CreateUser(ctx, db.CreateUserParams{ID: util.NewID(), Email: "group-cap-c@example.com", DisplayName: "C", Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, tooMany[:maxChatGroupMembers-2])
	requireValidationError(t, err, "invite past the cap")
}
